const cache = {};

// ==========================================================
// 1. 위키 텍스트 전처리 정제 함수
// ==========================================================
export function cleanWikiText(text) {
  if (!text) return "";
  let cleaned = text;

  cleaned = cleaned.replace(/<[^>]+>/g, "");
  cleaned = cleaned.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1");
  cleaned = cleaned.replace(/\[\d+\]/g, "");
  cleaned = cleaned.replace(/\[(?:각주|출처\s*필요|편집|주석)\]/g, "");
  cleaned = cleaned.replace(/\(\s*재위\s*:[^)]+\)/g, "");
  cleaned = cleaned.replace(/(?<=\s|^)\d+\)\s*/g, "");

  return cleaned.replace(/\s+/g, " ").trim();
}

/**
 * ============================================================================
 * 메타 정보 및 가계 TMI 정밀 필터링 파이프라인 (Production Grade)
 * ============================================================================
 * 
 * [모듈 구성]
 * 1. Constants & Lexical Dictionaries (어휘 사전 및 규칙 정의)
 * 2. StackParser (스택 기반 중첩 괄호 & 따옴표 세이프 파서)
 * 3. TextLexer (한글/한자/영문 토크나이저 및 어휘 분석기)
 * 4. ContextAnalyzer (비유적 표현 'X의 Y' 문맥 구조 판별기)
 * 5. ClauseASTBuilder (문장-절 구조 AST 생성기)
 * 6. MetaFilterEngine (메타/가계 절 규칙 필터링)
 * 7. GrammarRestorer (결합 어미 및 종결 표현 복원 엔진)
 * 8. PipelineEvaluator (최종 검증 및 메인 함수)
 */

// ============================================================================
// 1. Constants & Lexical Dictionaries
// ============================================================================

const UNICODE_HANGUL_START = 0xac00;
const UNICODE_HANGUL_END = 0xd7a3;

// 한자 및 기본 유효 문자 정규식 패턴
const HANJA_RANGE_REGEX = /[\u4E00-\u9FFF]/;
const VALID_CHAR_REGEX = /[가-힣\u4E00-\u9FFF A-Za-z0-9]/;
const VALID_WORD_REGEX = /[가-힣\u4E00-\u9FFF A-Za-z0-9]{2,}/g;

// 메타 키워드 세트 (독립 인명/명칭 정보)
const STRICT_META_KEYWORDS = new Set([
  "본관", "본적", "시호", "아호", "별호", "아명", "필명", "태명", "세례명",
  "법명", "묘호", "당호", "자", "호", "묘", "성", "씨", "휘", "개명"
]);

// 가계 키워드 세트 (혈통 및 친족 관계)
const KINSHIP_KEYWORDS = new Set([
  "부친", "모친", "아버지", "어머니", "조부", "증조부", "고조부", 
  "외조부", "외조모", "장인", "처남", "장남", "차남", "장녀", "차녀", 
  "막내", "외가", "손자", "외손자", "친척", "숙부", "백부"
]);

// 관형사격 대명사 (비유 판단시 예외 허용)
const PRONOUN_POSSESSIVE = new Set(["그의", "그녀의", "본인의", "자의"]);

// 종결 어미 패턴
const ENDING_VERBS = new Set([
  "이다", "이었다", "였다", "임", "등이다", "등이었다", "이고", "이며", "이자"
]);

// ============================================================================
// 2. StackParser (스택 기반 중첩 괄호 & 따옴표 파서)
// ============================================================================

class StackParser {
  constructor() {
    this.tokens = [];
    this.maskMap = new Map();
    this.counter = 0;
  }

  /**
   * 큰따옴표, 작은따옴표, 중첩 괄호를 안전하게 토큰화하여 보호
   */
  maskProtectedContexts(input) {
    let result = "";
    let i = 0;
    const len = input.length;

    while (i < len) {
      const char = input[i];

      // 1. 따옴표 마스킹
      if (char === '"' || char === "'") {
        const quoteChar = char;
        let start = i;
        i++;
        while (i < len && input[i] !== quoteChar) {
          if (input[i] === "\\") i++; // 이스케이프 스킵
          i++;
        }
        i++; // 닫는 따옴표 포함
        const originalText = input.slice(start, i);
        const maskKey = `__QUOTE_MASK_${this.counter++}__`;
        this.maskMap.set(maskKey, originalText);
        result += maskKey;
        continue;
      }

      // 2. 중첩 괄호 마스킹 및 메타 검사 준비
      if (char === "(") {
        let depth = 1;
        let start = i;
        i++;
        while (i < len && depth > 0) {
          if (input[i] === "(") depth++;
          else if (input[i] === ")") depth--;
          i++;
        }
        const originalBracket = input.slice(start, i);
        
        // 괄호 내부 가계/메타 포함 여부 판별
        if (this._containsMetaKeyword(originalBracket)) {
          // 메타 정보 포함 괄호는 삭제 대상 처리 (빈 문자열)
          result += " ";
        } else {
          const maskKey = `__BRACKET_MASK_${this.counter++}__`;
          this.maskMap.set(maskKey, originalBracket);
          result += maskKey;
        }
        continue;
      }

      result += char;
      i++;
    }

    return result;
  }

  _containsMetaKeyword(bracketContent) {
    for (const key of KINSHIP_KEYWORDS) {
      if (bracketContent.includes(key)) return true;
    }
    for (const key of STRICT_META_KEYWORDS) {
      if (bracketContent.includes(key)) return true;
    }
    return false;
  }

  /**
   * 마스킹된 토큰 복원
   */
  unmask(text) {
    let result = text;
    for (const [maskKey, original] of this.maskMap.entries()) {
      result = result.split(maskKey).join(original);
    }
    return result;
  }
}

// ============================================================================
// 3. TextLexer (어휘 및 어절 분석기)
// ============================================================================

class TextLexer {
  /**
   * 문장 분할 엔진 (한자 유니코드 및 인용구 보호 연동)
   */
  static splitSentences(text) {
    if (!text) return [];
    
    const normalized = text.replace(/\s+/g, " ").trim();
    // 문장 종결 기호 뒤 공백 및 시작 문자 룩어헤드
    const regex = /(?<=[.!?])\s+(?=[가-힣\u4E00-\u9FFF A-Za-z0-9"'_])/;
    
    return normalized
      .split(regex)
      .map(s => s.trim())
      .filter(Boolean);
  }

  /**
   * 어절 분석 (조사 분리 및 체언 추출)
   */
  static parseWord(word) {
    const cleanWord = word.replace(/^[,\s]+|[,\s]+$/g, "");
    
    // 주어/목적어 조사 분리 패턴
    const particleMatch = cleanWord.match(/^(.*?)(은|는|이|가|의|으로|로|에서|에게|부터|까지|이자|이고|이며|인)$/);
    
    if (particleMatch) {
      return {
        stem: particleMatch[1],
        particle: particleMatch[2],
        raw: cleanWord
      };
    }

    return {
      stem: cleanWord,
      particle: "",
      raw: cleanWord
    };
  }
}

// ============================================================================
// 4. ContextAnalyzer (비유적 표현 문맥 판별기)
// ============================================================================

class ContextAnalyzer {
  /**
   * '아버지/어머니' 등의 단어가 가계 TMI인지 비유적 표현인지 검사
   * 예: '인상주의의 아버지' -> 비유 (보존)
   * 예: '그의 아버지' / '부친은' -> 실제 가계 (제거)
   */
  static isMetaphoricalRelation(clauseText, keywordIndex, keyword) {
    const prefix = clauseText.slice(0, keywordIndex).trim();
    if (!prefix) return false;

    const words = prefix.split(/\s+/);
    const lastWord = words[words.length - 1];

    if (!lastWord) return false;

    // 키워드 바로 앞 단어가 '~의'로 끝나는지 검사
    if (lastWord.endsWith("의")) {
      // '그의', '그녀의' 등 대명사 소유격은 비유가 아닌 실제 가계 표기
      if (PRONOUN_POSSESSIVE.has(lastWord)) {
        return false;
      }
      // '인상주의의', '음악의', '철학의' 등 일반 명사 소유격은 비유적 표현으로 인정
      return true;
    }

    return false;
  }

  /**
   * 뒤이어 오는 서술어가 호칭/칭호 관련인지 검사 ('~로 불리는', '~라 칭하는')
   */
  static hasMetaphoricalPredicate(clauseText) {
    return /(?:로|라)\s*(?:불리는|불리우는|칭하는|일컬어지는|불리며)/.test(clauseText);
  }
}

// ============================================================================
// 5. ClauseASTBuilder (절 단위 구문 분석기)
// ============================================================================

class ClauseASTBuilder {
  /**
   * 단일 문장을 절(Clause) 단위 트리고 분해
   */
  static buildAST(sentence) {
    // 쉼표, 세미콜론 기준으로 절 분할
    const rawClauses = sentence.split(/(?<=[,;])\s+/);
    const clauseNodes = [];

    for (let i = 0; i < rawClauses.length; i++) {
      const clauseText = rawClauses[i].trim();
      if (!clauseText) continue;

      const words = clauseText.split(/\s+/);
      const firstParsed = TextLexer.parseWord(words[0] || "");

      let clauseType = "GENERAL"; // GENERAL, PURE_META, META_CLAUSE, KINSHIP_CLAUSE

      // 메타 키워드 존재 여부 검사
      if (STRICT_META_KEYWORDS.has(firstParsed.stem)) {
        clauseType = "META_CLAUSE";
      } else if (KINSHIP_KEYWORDS.has(firstParsed.stem)) {
        const keyIdx = clauseText.indexOf(firstParsed.stem);
        if (ContextAnalyzer.isMetaphoricalRelation(clauseText, keyIdx, firstParsed.stem) ||
            ContextAnalyzer.hasMetaphoricalPredicate(clauseText)) {
          clauseType = "GENERAL"; // 비유적 표현이므로 일반 절로 보호
        } else {
          clauseType = "KINSHIP_CLAUSE";
        }
      }

      clauseNodes.push({
        id: i,
        rawText: clauseText,
        type: clauseType,
        firstWord: firstParsed,
        isLast: i === rawClauses.length - 1
      });
    }

    return {
      originalSentence: sentence,
      clauses: clauseNodes
    };
  }
}

// ============================================================================
// 6. MetaFilterEngine (절 단위 메타 제거 엔진)
// ============================================================================

class MetaFilterEngine {
  /**
   * 문장 전체가 완전한 단독 메타 정보인지 검사
   */
  static isPureMetaSentence(sentence) {
    const clean = sentence.replace(/^[,\s]+|[,\s]+$/g, "");
    
    // 패턴: [메타키워드]는/은/이/가 [내용]이다/이었다.
    const strictMetaKeysStr = Array.from(STRICT_META_KEYWORDS).join("|");
    const purePattern = new RegExp(
      `^(?:그의|그녀의|본)?\\s*(?:${strictMetaKeysStr})\\s*(?:은|는|:)\\s+[^.!?]+(?:이다|이었다|임|등이다|등이었다)\\.$`
    );

    return purePattern.test(clean);
  }

  /**
   * 절 목록 중 메타/가계 절을 정밀 필터링
   */
  static filterClauses(ast) {
    const validClauses = [];

    for (const clause of ast.clauses) {
      if (clause.type === "META_CLAUSE" || clause.type === "KINSHIP_CLAUSE") {
        // 메타/가계 절 삭제
        continue;
      }

      // 절 내부의 부분 메타 구문 필터링 (정규식 정밀 대치)
      let text = clause.rawText;
      text = MetaFilterEngine._stripPartialMetaRegex(text);

      if (text.trim()) {
        validClauses.push(text.trim());
      }
    }

    return validClauses;
  }

  static _stripPartialMetaRegex(text) {
    const metaKeysStr = Array.from(STRICT_META_KEYWORDS).join("|");
    const kinshipKeysStr = Array.from(KINSHIP_KEYWORDS).join("|");

    // 부분 메타 절 제거
    const metaRegex = new RegExp(
      `(?:^|(?<=[,;]\\s*))(?:${metaKeysStr})\\s*(?:은|는|:)\\s+[가-힣\\u4E00-\\u9FFF\\s(·)]+?(?:등이다|등이었다|이며|이고|이자|이었다|였다|이다|임)(?:\\s*,)?`,
      "g"
    );

    // 부분 가계 절 제거 (비유적 'X의' 보호 부정후방탐색)
    const kinshipRegex = new RegExp(
      `(?:^|(?<=[,;]\\s*))(?:(?:그의|그녀의)?\\s*(?:${kinshipKeysStr})|(?:(?<![가-힣\\u4E00-\\u9FFF]의\\s*)(?:아버지|어머니)))\\s*(?:은|는|이|가)\\s+[가-힣\\u4E00-\\u9FFF]{2,5}(?:이고|이며|이자|이었다|였다|이다|임)(?:\\s*,)?`,
      "g"
    );

    return text.replace(metaRegex, "").replace(kinshipRegex, "");
  }
}

// ============================================================================
// 7. GrammarRestorer (문법 및 종결어미 복원 엔진)
// ============================================================================

class GrammarRestorer {
  /**
   * 메타 절이 지워진 후 남아버린 어색한 연결어미 및 부호 재구성
   */
  static repairSentence(clauses) {
    if (!clauses || clauses.length === 0) return "";

    let joined = clauses.join(" ");

    // 1. 다중 쉼표 및 부호 정돈
    joined = joined
      .replace(/,\s*,+/g, ",")
      .replace(/,\s*\./g, ".")
      .replace(/^\s*,\s*/, "")
      .replace(/\(\s*\)/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // 2. 잘려나간 연결어미의 종결어미 복원 (예: "~독립운동가로." -> "~독립운동가이다.")
    joined = joined.replace(/(?:으로|로)\s*\.$/, "이다.");
    joined = joined.replace(/(?:이며|이고|이자)\s*\.$/, "이다.");
    joined = joined.replace(/(?:하며|되었으며)\s*\.$/, "되었다.");

    // 3. 문장 선두의 불필요한 접속어미 제거
    joined = joined.replace(/^(?:으로|로|이고|이며|이자)\s*,?\s*/, "");

    // 4. 종결 마침표 보장
    if (joined.length >= 3 && !/[.!?]$/.test(joined)) {
      joined += ".";
    }

    return joined;
  }
}

// ============================================================================
// 8. PipelineEvaluator & Main Export
// ============================================================================

export function stripMetainfo(text) {
  if (!text || typeof text !== "string") return "";

  // Step 1: 스택 파서를 통한 따옴표 및 중첩 괄호 보호/마스킹
  const stackParser = new StackParser();
  const maskedText = stackParser.maskProtectedContexts(text);

  // Step 2: 문장 단위 분할
  const rawSentences = TextLexer.splitSentences(maskedText);
  const processedSentences = [];

  for (const rawSentence of rawSentences) {
    // Step 3: 단독 메타 문장 검사 및 필터링
    if (MetaFilterEngine.isPureMetaSentence(rawSentence)) {
      continue;
    }

    // Step 4: 절 단위 AST 생성
    const ast = ClauseASTBuilder.buildAST(rawSentence);

    // Step 5: 메타/가계 절 제거
    const filteredClauses = MetaFilterEngine.filterClauses(ast);

    // Step 6: 문법 복원 및 정돈
    const repairedSentence = GrammarRestorer.repairSentence(filteredClauses);

    if (repairedSentence && repairedSentence.length >= 3) {
      processedSentences.push(repairedSentence);
    }
  }

  // Step 7: 최종 문장 결합 및 마스킹 복원
  let finalText = processedSentences.join(" ");
  finalText = stackParser.unmask(finalText);

  // Step 8: 유효성 검증 (한자 포함 유효 단어 수 검사)
  finalText = finalText.replace(/\s+/g, " ").trim();
  const validWords = finalText.match(VALID_WORD_REGEX) || [];

  // 유효 단어가 2개 미만인 경우 빈 값 반환
  if (validWords.length < 2) {
    return "";
  }

  return finalText;
}

// ============================================================================
// 9. Self-Verification Test Suite (비공개 자체 검증 엔진)
// ============================================================================

function _runInternalTests() {
  const testCases = [
    {
      name: "클로드 모네 비유적 표현 검증",
      input: "클로드 모네는 프랑스의 화가로, '인상주의의 아버지'로 불리는 개척자다.",
      expectedContains: "인상주의의 아버지"
    },
    {
      name: "김구 선생 한자 및 연결어미 복원 검증",
      input: "김구(金九, 1876년~1949년)는 한국의 독립운동가로, 아명은 창암, 호는 백범이다.",
      expectedContains: "독립운동가이다"
    },
    {
      name: "중첩 괄호 및 순수 가계 TMI 제거 검증",
      input: "맹자(본관은 파평, (부친: 맹숙))는 유학자이다.",
      expectedNotContains: "부친"
    }
  ];

  for (const tc of testCases) {
    const res = stripMetainfo(tc.input);
    if (tc.expectedContains && !res.includes(tc.expectedContains)) {
      console.warn(`[Test Failed] ${tc.name}: ${res}`);
    }
    if (tc.expectedNotContains && res.includes(tc.expectedNotContains)) {
      console.warn(`[Test Failed] ${tc.name}: ${res}`);
    }
  }
}

// 실행 환경 검증 실행
if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
  _runInternalTests();
}
  
  
// ==========================================================
// 2. 키워드 및 업적·생애 전용 표적 벡터(Target Vector) 설정
// ==========================================================
const CORE_SIGNIFICANCE_KEYWORDS = [
  "원리", "구조", "기능", "작용", "현상", "이론", "연구", "발견", "규명", "증명", "설명", 
  "분석", "기반", "시스템", "메커니즘", "특징", "성질", "분류", "상태", "상호작용", "개척",
  "제도", "정책", "사회", "경제", "체계", "관계", "변화", "전개", "성장", "효과", "수립", "조직", 
  "원인", "결과", "분포", "개혁", "조약", "협정", "시장", "구조적", "통일", "통합", "정합", 
  "양식", "사상", "문화", "작품", "기법", "전통", "유형", "형성", "창작", "유산", "완화", 
  "대표", "영향", "의의", "기여", "발전", "역사", "중심", "주요", "핵심", "주요한",
  "지정", "설립", "주도", "구성", "기록", "도입", "확립", "공격", "격퇴", "정벌", "함락",
  "독립운동", "의병", "하얼빈", "저격", "사살", "의거", "단지동맹", "동양평화론",
  "국채보상운동", "구국", "대한의군", "유묵", "도량형", "만리장성", "천하통일"
];

// 백터 유사도 산출 시 기준점이 되는 업적/생애 중심 표적 백터
const ACHIEVEMENT_TARGET_TOKENS = [
  "업적", "기여", "주도", "설립", "창시", "개혁", "통일", "저술", "집필", "건축", "격퇴",
  "발견", "발명", "구국", "독립운동", "의거", "혁명", "수립", "제정", "창작", "연구", "규명",
  "단행", "확립", "창설", "지휘", "승리", "제작", "편찬", "주창", "통제", "구원", "노벨상"
];

const UNIVERSAL_NOISE_KEYWORDS = [
  "자세한 내용은", "참조하십시오", "출처 필요", "각주", "외부 링크", "참고 문헌", "경력", "위키미디어 공용에", 
  "여담", "기타", "대중 문화", "서브컬처", "패러디", "밈", "스포일러", "오류",
  "차이를 보이고", "별명", "소문", "야사", "미디어에서", "여담으로", "설이 있다", "추측", "미디어 분류가 있습니다."
];

const MAJOR_HISTORICAL_EVENT_REGEX = /(?:[가-힣]{2,3}[란난]|해전|대첩|승첩|전투|의거|혁명)/;
const ACADEMIC_CONCEPT_REGEX = /[가-힣]{2,}(?:설|론|주의)\b/;
const ACHIEVEMENT_VERB_REGEX = /(?:저술|집필|설계|고안|집대성|제시|편찬|주창|발명|창안|개혁|건축|축조|간행|통찰|창작|창시|정리|도입|확립|반영|기여|주도|설립|격퇴|정벌|연구|지휘|승리|격파|격침|건조|수호|통제|구원|평정|혁신|창설|발견|노벨상|통일|단행)/;
const PASSIVE_BG_REGEX = /(?:(?:지점|시대|무렵|해|곳)이다|위치해\s*있다|일이\s*벌어졌다|상황이었다|태어났다|결혼했다|결혼하였다)/;
const TMI_NOISE_REGEX = /(?:부친|모친|조부|증조부|고조부|외가|첫\s*부인|둘째\s*부인|가계도|손자|처남|장인|결혼|이혼|혼인|재혼|배우자|남편|아내|딸|아들|처가|시댁|장남|차남|장녀|차녀|외아들|외딸|\d남|\d녀|위인전|출판사|족보|입향시조|후사|종친|문중)/;
const DEMONSTRATIVE_REF_REGEX = /^(?:이들|그들)(?:은|는|이|가)?|^(?:이|그|해당)\s*(?:작품|빌딩|건축물|그림|조각|서적|책|소설|시|음악|곡|연구|이론|분야|문화재|유물|사건|전쟁|조약|운동|개혁|현상|사람|인물)(?:은|는|이|가|으로|에서|에)?/;
const HERITAGE_ORBOOK_DESIGNATION_REGEX = /(?:(?:보물|국보|사적|천연기념물|유형문화재)\s*(?:제?\d+호)?\s*(?:로|에)\s*(?:지정|등록)|(?:책|저서|작품)\s*(?:을|를|으로|로|에)?\s*(?:저술|집필|간행|출판|발간|남김|대표|지정|등록))/;
const RANK_LISTING_REGEX = /(?:종\d품|정\d품|권관|봉사|만호|참군|주부|현감|절도사|통제사).*(?:거쳐|이르렀다)/;
const CORE_SIGNIFICANCE_TEST_REGEX = new RegExp(CORE_SIGNIFICANCE_KEYWORDS.join("|"));

// ==========================================================
// 3. 헬퍼 함수 및 지시어 해독
// ==========================================================
const REGEX_LEADING_CONNECTORS = /^(?:그러나|하지만|그런데|한편|따라서|게다가|반면|이에|이후|결국|그\s*후|또한|그리고),?\s*/;
function cleanLeadingConnectors(sentence) {
  return sentence ? sentence.replace(REGEX_LEADING_CONNECTORS, "").trim() : "";
}

function splitSentences(text) {
  if (!text) return [];
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned
    .split(/(?<=[.!?])(?<!\d\.\d+)\s+(?=[가-힣A-Za-z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
}

function tokenize(sentence) {
  return sentence
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function resolveAnaphora(sentence, allSentences, originalIndex) {
  const demoMatch = sentence.match(/(?:^|[,\s])((?:이|그)\s+(?:작품|빌딩|건축물|그림|조각|서적|책|소설|시|음악|곡|연구|이론|문화재|유물)(?:은|는|을|를|이|가)?)/);
  if (!demoMatch) return sentence;

  const targetPhrase = demoMatch[1];

  for (let i = originalIndex - 1; i >= Math.max(0, originalIndex - 3); i--) {
    const prevSentence = allSentences[i];
    if (!prevSentence) continue;

    const titleMatch = prevSentence.match(/[《「"'][^《》「」"']+[》」"']/);
    if (titleMatch) {
      const replacedPhrase = targetPhrase.replace(/(?:이|그)\s+(?:작품|빌딩|건축물|그림|조각|서적|책|소설|시|음악|곡|연구|이론|문화재|유물)/, titleMatch[0]);
      return sentence.replace(targetPhrase, replacedPhrase);
    }
  }
  return sentence;
}

// ==========================================================
// 4. 복합 백터 유사도(Document Centroid + Target Vector Cosine Similarity)
// ==========================================================
function getTopDocumentKeywords(sentences, topK = 10) {
  const freqMap = {};
  for (const sentence of sentences) {
    const tokens = tokenize(sentence);
    for (const token of tokens) {
      freqMap[token] = (freqMap[token] || 0) + 1;
    }
  }

  return Object.entries(freqMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([word]) => word);
}

function sentenceSimilarity(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (setA.size === 0 || setB.size === 0) return 0;

  let common = 0;
  for (const w of setA) if (setB.has(w)) common += 1;
  if (common === 0) return 0;

  const norm = Math.log(setA.size + 1) + Math.log(setB.size + 1);
  return norm === 0 ? 0 : common / norm;
}

function buildSimilarityMatrix(sentences) {
  const tokenized = sentences.map(tokenize);
  const n = sentences.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = sentenceSimilarity(tokenized[i], tokenized[j]);
      matrix[i][j] = sim;
      matrix[j][i] = sim;
    }
  }
  return matrix;
}

function pageRank(matrix, damping = 0.85, iterations = 40, tolerance = 1e-5) {
  const n = matrix.length;
  if (n === 0) return [];

  let scores = new Array(n).fill(1 / n);
  const rowSums = matrix.map((row) => row.reduce((a, b) => a + b, 0));

  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Array(n).fill((1 - damping) / n);
    let diff = 0;

    for (let i = 0; i < n; i++) {
      let incoming = 0;
      for (let j = 0; j < n; j++) {
        if (j !== i && matrix[j][i] > 0 && rowSums[j] > 0) {
          incoming += (matrix[j][i] / rowSums[j]) * scores[j];
        }
      }
      newScores[i] += damping * incoming;
      diff += Math.abs(newScores[i] - scores[i]);
    }

    scores = newScores;
    if (diff < tolerance) break;
  }

  return scores;
}

// 🔴 문서 중심 백터 및 업적/생애 표적 백터와의 코사인 유사도 산출
function calculateDualVectorSimilarity(sentences) {
  if (!sentences || sentences.length === 0) return [];

  const tokenizedDocs = sentences.map(tokenize);
  const N = sentences.length;

  const dfMap = {};
  tokenizedDocs.forEach((tokens) => {
    const uniqueTokens = new Set(tokens);
    uniqueTokens.forEach((token) => {
      dfMap[token] = (dfMap[token] || 0) + 1;
    });
  });

  // TF-IDF 문장 백터화
  const sentenceVectors = tokenizedDocs.map((tokens) => {
    const tfMap = {};
    tokens.forEach((t) => (tfMap[t] = (tfMap[t] || 0) + 1));

    const vector = {};
    for (const [token, count] of Object.entries(tfMap)) {
      const tf = count / Math.max(tokens.length, 1);
      const idf = Math.log((N + 1) / ((dfMap[token] || 0) + 1)) + 1;
      vector[token] = tf * idf;
    }
    return vector;
  });

  // 1) 문서 주제 중심 백터 (Document Centroid Vector)
  const docCentroid = {};
  sentenceVectors.forEach((vec) => {
    for (const [token, val] of Object.entries(vec)) {
      docCentroid[token] = (docCentroid[token] || 0) + val / N;
    }
  });

  // 2) 업적·생애 표적 백터 (Achievement Target Vector)
  const targetVector = {};
  ACHIEVEMENT_TARGET_TOKENS.forEach((token) => {
    targetVector[token] = 1.5;
  });

  const getNorm = (vec) => Math.sqrt(Object.values(vec).reduce((sum, v) => sum + v * v, 0));
  const docNorm = getNorm(docCentroid);
  const targetNorm = getNorm(targetVector);

  return sentenceVectors.map((vec) => {
    let docDot = 0;
    let targetDot = 0;
    let vecNorm = 0;

    for (const [token, val] of Object.entries(vec)) {
      vecNorm += val * val;
      if (docCentroid[token]) docDot += val * docCentroid[token];
      if (targetVector[token]) targetDot += val * targetVector[token];
    }
    vecNorm = Math.sqrt(vecNorm);
    if (vecNorm === 0) return 0;

    const docSim = docNorm === 0 ? 0 : docDot / (vecNorm * docNorm);
    const targetSim = targetNorm === 0 ? 0 : targetDot / (vecNorm * targetNorm);

    // 문서 주제성(40%) + 업적/생애 표적 유사도(60%) 결합
    return docSim * 0.4 + targetSim * 0.6;
  });
}

// ==========================================================
// 5. 문장 조립 및 메인 요약
// ==========================================================
function assembleCompleteSentences(anchorSentences, rankedCandidates, maxLength = 630) {
  let summaryParts = [];
  let currentLength = 0;

  for (const anchor of anchorSentences) {
    let cleanAnchor = anchor.trim();
    if (!cleanAnchor) continue;
    if (!/[.!?]$/.test(cleanAnchor)) cleanAnchor += ".";

    const expectedLength = currentLength + (summaryParts.length > 0 ? 1 : 0) + cleanAnchor.length;
    if (expectedLength <= maxLength) {
      summaryParts.push(cleanAnchor);
      currentLength = expectedLength;
    }
  }

  for (const item of rankedCandidates) {
    let candidate = cleanLeadingConnectors(item.sentence).trim();
    if (!candidate) continue;
    if (!/[.!?]$/.test(candidate)) candidate += ".";

    if (summaryParts.includes(candidate)) continue;

    const expectedLength = currentLength + (summaryParts.length > 0 ? 1 : 0) + candidate.length;

    if (expectedLength <= maxLength) {
      summaryParts.push(candidate);
      currentLength = expectedLength;
    }
  }

  return summaryParts.join(" ");
}

export function buildDescription(
  introText = "",
  bodyText = "",
  aliases = [],
  extraCount = 4,
  anchorCount = 3,
  maxLength = 630,
  sectionTitle = ""
) {
  const cacheKey = `${introText}_${bodyText}_${extraCount}_${anchorCount}_${maxLength}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const rawCleanIntro = cleanWikiText(introText);
  const rawCleanBody = cleanWikiText(bodyText);

  const cleanIntro = stripMetainfo(rawCleanIntro);
  const cleanBody = stripMetainfo(rawCleanBody);

  const introSentences = splitSentences(cleanIntro);
  const bodySentences = splitSentences(cleanBody);
  const allSentences = [...introSentences, ...bodySentences];

  if (introSentences.length === 0 && bodySentences.length === 0) return "";

  let anchorSentences = [];
  let rawCandidatesWithMeta = [];

  if (introSentences.length > 0) {
    const firstSentence = introSentences[0];
    const restIntro = introSentences.slice(1);

    const priorityIntro = restIntro.filter(s => 
      !RANK_LISTING_REGEX.test(s) || MAJOR_HISTORICAL_EVENT_REGEX.test(s)
    );
    const lowPriorityIntro = restIntro.filter(s => !priorityIntro.includes(s));
    const sortedIntro = [firstSentence, ...priorityIntro, ...lowPriorityIntro];

    anchorSentences = sortedIntro.slice(0, anchorCount);
    
    allSentences.forEach((sentence, globalIndex) => {
      if (!anchorSentences.includes(sentence)) {
        rawCandidatesWithMeta.push({ sentence, globalIndex });
      }
    });
  } else {
    anchorSentences = bodySentences.slice(0, anchorCount);
    bodySentences.slice(anchorCount).forEach((sentence, idx) => {
      rawCandidatesWithMeta.push({ sentence, globalIndex: anchorCount + idx });
    });
  }

  const anchorContextText = anchorSentences.join(" ");

  // TMI 노이즈 강력 필터링
  const cleanCandidatesWithMeta = rawCandidatesWithMeta.filter((item) => {
    if (TMI_NOISE_REGEX.test(item.sentence)) return false;
    if (UNIVERSAL_NOISE_KEYWORDS.some((kw) => item.sentence.includes(kw))) return false;
    return true;
  });

  let candidateMetaList = cleanCandidatesWithMeta;
  if (candidateMetaList.length === 0) {
    candidateMetaList = rawCandidatesWithMeta.slice(0, 18);
  }

  const candidateSentences = candidateMetaList.map((item) => item.sentence);

  // 주제어, TextRank 및 복합 백터 점수 산출
  const topKeywords = getTopDocumentKeywords([...anchorSentences, ...candidateSentences], 10);
  const matrix = buildSimilarityMatrix(candidateSentences);
  const baseScores = pageRank(matrix);
  const dualVectorScores = calculateDualVectorSimilarity(candidateSentences);
  const maxBaseScore = Math.max(...baseScores, 0.001);

  const finalCandidates = candidateMetaList.map((item, index) => {
    const sentence = item.sentence;
    let score = baseScores[index] / maxBaseScore;

    // 백터 유사도 가중치 반영 (최대 2배 증폭)
    const vectorSim = dualVectorScores[index] || 0;
    score *= (1 + vectorSim * 1.2);

    const demoMatch = sentence.match(DEMONSTRATIVE_REF_REGEX);
    if (demoMatch) {
      const refNoun = demoMatch[1] || demoMatch[0];
      if (!anchorContextText.includes(refNoun)) score *= 0.1;
    }

    if (/(?:[인과의는은를을에서로으로임함중]\s*\.?$|[A-Z]\.\s*$)/i.test(sentence.trim())) {
      return { sentence, score: 0, index };
    }

    // 업적 동사 가중치 대폭 강화
    if (ACHIEVEMENT_VERB_REGEX.test(sentence)) {
      score *= 2.2;
    }

    const keywordMatches = sentence.match(CORE_SIGNIFICANCE_TEST_REGEX);
    if (keywordMatches) {
      score += keywordMatches.length * 0.25;
    }

    if (ACADEMIC_CONCEPT_REGEX.test(sentence)) score += 0.3;
    if (PASSIVE_BG_REGEX.test(sentence)) score *= 0.3;
    if (TMI_NOISE_REGEX.test(sentence)) score *= 0.01;

    const resolvedSentence = resolveAnaphora(sentence, allSentences, item.globalIndex);
    return { sentence: resolvedSentence, score, index };
  });

  const ranked = finalCandidates
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, extraCount)
    .sort((a, b) => a.index - b.index);

  const result = assembleCompleteSentences(anchorSentences, ranked, maxLength);
  return (cache[cacheKey] = result);
}

export function summarizeText(text, topN = 4) {
  if (!text) {
    return { summary: "", sentenceCount: 0, usedSentences: 0 };
  }

  const cleanedText = stripMetainfo(cleanWikiText(text));
  const totalSentences = splitSentences(cleanedText).length;

  const anchorCount = Math.min(3, topN);
  const extraCount = Math.max(0, topN - anchorCount);

  const summary = buildDescription(text, "", [], extraCount, anchorCount);
  const actualUsedSentences = splitSentences(summary).length;

  return {
    summary,
    sentenceCount: totalSentences,
    usedSentences: actualUsedSentences,
  };
}
