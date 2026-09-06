const cache = {};

// ==========================================================
// 1. 위키 텍스트 정제 함수
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

const RE_QUOTE = /(['"])(.*?)\1/g;
const RE_SPACE = /\s+/g;
const RE_PAREN_META = /\([^)]*(?:부친|모친|조부|증조부|고조부|외가|장인|처남|자|호|본관|시호|아명|태명|법명)\s*:[^)]*\)/g;
const RE_SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[가-힣A-Za-z0-9"'(])/;

const RE_PURE_META = /^(?:그의|그녀의|본)?\s*(?:본관|본적|시호|아호|별호|아명|태명|세례명|법명|묘호|당호|자|호|휘)\s*(?:은|는|:)\s+.+$/;
const RE_META_CLAUSE = /(?:^|(?<=[,;]\s*))(?:본관|본적|시호|아호|별호|아명|태명|세례명|법명|묘호|당호|자|호|휘)\s*(?:은|는|:)\s+[가-힣\u4E00-\u9FFF\s(·)]+?(?:등이다|등이었다|이며|이고|이자|이었다|였다|이다|임)(?:,\s*)?/g;
const RE_FAMILY_CLAUSE = /(?:^|(?<=[,;]\s*))(?:(?:그의|그녀의)?\s*(?:부친|모친|조부|증조부|고조부|외조부|외조모|장인|처남|장남|차남|장녀|차녀|막내)|(?:(?<![가-힣\u4E00-\u9FFF]의\s*)(?:아버지|어머니)))\s*(?:은|는|이|가)\s+[가-힣\u4E00-\u9FFF]{2,5}(?:이고|이며|이자|이었다|였다|이다|임)(?:,\s*)?/g;

const RE_PUNCT_CLEAN = /,\s*,+/g;
const RE_DOT_CLEAN = /,\s*\./g;
const RE_LEADING_COMMA = /^\s*,\s*/;
const RE_EMPTY_PAREN = /\(\s*\)/g;
const RE_TAIL_VERB = /(?:으로|로|이며|이고|이자)\s*\.$/;
const RE_HEAD_VERB = /^(?:으로|로|이고|이며|이자)\s*,?\s*/;
const RE_VALID_CHAR = /[가-힣\u4E00-\u9FFF A-Za-z0-9]/;
const RE_VALID_WORDS = /[가-힣\u4E00-\u9FFF A-Za-z0-9]{2,}/g;

export function stripMetainfo(text) {
  if (!text || typeof text !== "string") return "";

  try {
    const quotes = [];
    let masked = text.replace(RE_QUOTE, (match) => {
      quotes.push(match);
      return `__Q_${quotes.length - 1}__`;
    });

    masked = masked.replace(RE_PAREN_META, "").replace(RE_SPACE, " ").trim();
    const sentences = masked.split(RE_SENTENCE_SPLIT);
    const result = [];

    for (let i = 0; i < sentences.length; i++) {
      let s = sentences[i].trim();
      if (!s) continue;
      if (RE_PURE_META.test(s)) continue;

      s = s.replace(RE_META_CLAUSE, "").replace(RE_FAMILY_CLAUSE, "");
      s = s
        .replace(RE_PUNCT_CLEAN, ",")
        .replace(RE_DOT_CLEAN, ".")
        .replace(RE_LEADING_COMMA, "")
        .replace(RE_EMPTY_PAREN, "")
        .replace(RE_SPACE, " ")
        .trim();

      s = s.replace(RE_TAIL_VERB, "이다.").replace(RE_HEAD_VERB, "");

      if (s.length >= 3 && RE_VALID_CHAR.test(s)) {
        if (!/[.!?]$/.test(s)) s += ".";
        result.push(s);
      }
    }

    let finalContent = result.join(" ");
    if (quotes.length > 0) {
      for (let i = 0; i < quotes.length; i++) {
        finalContent = finalContent.replace(`__Q_${i}__`, quotes[i]);
      }
    }

    finalContent = finalContent.replace(RE_SPACE, " ").trim();
    const words = finalContent.match(RE_VALID_WORDS) || [];
    return words.length >= 1 ? finalContent : text;
  } catch (err) {
    return text.replace(RE_SPACE, " ").trim();
  }
}

// ==========================================================
// 2. 키워드, 배제 필터 및 정규식 정의
// ==========================================================
const CORE_SIGNIFICANCE_KEYWORDS = [
  "원리", "구조", "기능", "작용", "현상", "이론", "연구", "발견", "규명", "증명", "설명", "기록", "저서", 
  "분석", "기반", "시스템", "메커니즘", "특징", "성질", "분류", "상태", "상호작용", "개척", "출판", "저술", 
  "제도", "정책", "사회", "경제", "체계", "관계", "변화", "전개", "성장", "효과", "수립", "조직", 
  "원인", "결과", "분포", "개혁", "조약", "협정", "시장", "구조적", "통일", "통합", "정합", 
  "양식", "사상", "문화", "작품", "기법", "전통", "유형", "형성", "창작", "유산", "완화", 
  "대표", "영향", "의의", "기여", "발전", "역사", "중심", "주요", "핵심", "주요한", 
  "지정", "설립", "주도", "구성", "도입", "확립", "공격", "격퇴", "정벌", "함락",
  "독립운동", "의병", "하얼빈", "저격", "사살", "의거", "단지동맹", "동양평화론",
  "국채보상운동", "구국", "대한의군", "유묵", "도량형", "만리장성", "천하통일"
];

const UNIVERSAL_NOISE_KEYWORDS = [
  "자세한 내용은", "참조하십시오", "출처 필요", "각주", "외부 링크", "참고 문헌", "경력", "위키미디어 공용에", 
  "여담", "기타", "대중 문화", "서브컬처", "패러디", "밈", "스포일러", "오류",
  "차이를 보이고", "별명", "소문", "야사", "미디어에서", "여담으로", "설이 있다", "추측", "보고 있다", "미디어 분류가 있습니다."
];

// 배제 대상: "그러나" 및 시간/전환 접속사 시작 문장
const DISQUALIFIED_CONNECTORS_REGEX = /^(?:그러나|하지만|그런데|한편|이후|당시|그\s*후|그\s*뒤|그러던\s*중|이에\s*따라|그\s*당시)/;

// 배제 대상: 본인 아닌 타인/가족 정보 (TMI)
const TMI_NOISE_REGEX = /(?:부친|모친|조부|증조부|고조부|외가|첫\s*부인|둘째\s*부인|가계도|손자|처남|장인|결혼|이혼|혼인|재혼|배우자|남편|아내|딸|아들|처가|시댁|장남|차남|장녀|차녀|외아들|외딸|\d남|\d녀|위인전|출판사|족보|입향시조|후사|종친|문중)/;

const MAJOR_HISTORICAL_EVENT_REGEX = /(?:[가-힣]{2,3}[란난]|해전|대첩|승첩|전투|의거|혁명)/;
const ACADEMIC_CONCEPT_REGEX = /[가-힣]{2,}(?:설|론|주의)\b/;
const ACHIEVEMENT_VERB_REGEX = /(?:저술|집필|설계|고안|집대성|제시|편찬|주창|발명|창안|개혁|건축|축조|간행|통찰|창작|창시|정리|도입|확립|반영|기여|주도|설립|격퇴|정벌|연구|지휘|승리|격파|격침|건조|수호|통제|구원|평정|혁신|창설|발견|노벨상|통일|단행)/g;
const CORE_SIGNIFICANCE_TEST_REGEX = new RegExp(CORE_SIGNIFICANCE_KEYWORDS.join("|"));

// ==========================================================
// 3. 파싱, 지시어 해독 및 맥락 추적
// ==========================================================
export function extractAnnotatedParagraphs(rawText) {
  if (!rawText) return [];

  const paragraphs = rawText.split(/\n\s*\n|\n?==+[^=]+==+\n?/).filter(p => p.trim());
  const structuredParagraphs = [];

  for (const p of paragraphs) {
    const rawSentences = p.split(/(?<=[.!?])\s+(?=[가-힣A-Za-z0-9"'(])/).map(s => s.trim()).filter(s => s.length > 8);
    const parsedSentences = [];

    for (const raw of rawSentences) {
      // 위키 문법 전처리 이전의 볼드/링크 태그 존재 유무 저장
      const hasBold = /'''|<b>|<strong>/.test(raw);
      const hasLink = /\[\[/.test(raw);

      const cleaned = stripMetainfo(cleanWikiText(raw));
      if (cleaned && cleaned.length > 8) {
        parsedSentences.push({
          raw,
          cleaned,
          hasBold,
          hasLink
        });
      }
    }
    if (parsedSentences.length > 0) {
      structuredParagraphs.push(parsedSentences);
    }
  }

  return structuredParagraphs;
}

function resolveAnaphora(sentence, allSentences, originalIndex) {
  let resolved = sentence;

  // 지시 대상(작품, 서적, 연구 등) 맥락 추적
  const demoWorkMatch = resolved.match(/(?:^|[,\s])((?:이|그|해당)\s+(?:작품|빌딩|건축물|그림|조각|서적|책|소설|시|음악|곡|연구|이론|문화재|유물|개혁|사건|지술)(?:은|는|을|를|이|가)?)/);
  if (demoWorkMatch) {
    const targetPhrase = demoWorkMatch[1];
    for (let i = originalIndex - 1; i >= Math.max(0, originalIndex - 3); i--) {
      const prevSentence = allSentences[i]?.cleaned || allSentences[i] || "";
      const titleMatch = prevSentence.match(/[《「"'][^《》「」"']+[》」"']/);
      if (titleMatch) {
        const replaced = targetPhrase.replace(/(?:이|그|해당)\s+(?:작품|빌딩|건축물|그림|조각|서적|책|소설|시|음악|곡|연구|이론|문화재|유물|개혁|사건|지술)/, titleMatch[0]);
        resolved = resolved.replace(targetPhrase, replaced);
        break;
      }
    }
  }

  // 지시 대명사(그는, 이들은 등) 맥락 추적 및 치환
  const pronounMatch = resolved.match(/^(이들|그들|그는|그녀는)(?:은|는|이|가)?/);
  if (pronounMatch) {
    for (let i = originalIndex - 1; i >= Math.max(0, originalIndex - 3); i--) {
      const prevSentence = allSentences[i]?.cleaned || allSentences[i] || "";
      const subjectMatch = prevSentence.match(/^([가-힣]{2,4})(?:은|는|이|가)/);
      if (subjectMatch) {
        resolved = resolved.replace(pronounMatch[0], subjectMatch[1] + "은");
        break;
      }
    }
  }

  return resolved;
}

// ==========================================================
// 4. 필터링 및 점수 계산
// ==========================================================
function isDisqualifiedSentence(sentence) {
  if (!sentence) return true;
  if (DISQUALIFIED_CONNECTORS_REGEX.test(sentence.trim())) return true;
  if (TMI_NOISE_REGEX.test(sentence)) return true;
  if (UNIVERSAL_NOISE_KEYWORDS.some(kw => sentence.includes(kw))) return true;
  return false;
}

function scoreSentence(item) {
  let score = 1.0;
  const sentence = item.cleaned;

  if (item.hasBold) score += 1.8; // 볼드 표시 가중치 강화
  if (item.hasLink) score += 1.0; // 링크 표시 가중치 강화

  const achievementMatches = sentence.match(ACHIEVEMENT_VERB_REGEX);
  if (achievementMatches) {
    score += achievementMatches.length * 1.8;
  }

  const keywordMatches = sentence.match(CORE_SIGNIFICANCE_TEST_REGEX);
  if (keywordMatches) {
    score += keywordMatches.length * 0.5;
  }

  if (MAJOR_HISTORICAL_EVENT_REGEX.test(sentence)) score += 1.0;
  if (ACADEMIC_CONCEPT_REGEX.test(sentence)) score += 0.8;

  return score;
}

// ==========================================================
// 5. 메인 요약 생성 함수 (buildDescription)
// ==========================================================
export function buildDescription(introText = "", bodyText = "", aliases = [], maxLength = 800) {
  const cacheKey = `${introText}_${bodyText}_${maxLength}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const parsedIntroParagraphs = extractAnnotatedParagraphs(introText);
  const parsedBodyParagraphs = extractAnnotatedParagraphs(bodyText);

  const flatIntroSentences = parsedIntroParagraphs.flat();
  const flatBodySentences = parsedBodyParagraphs.flat();
  const allFlatSentences = [...flatIntroSentences, ...flatBodySentences];

  // 1. 서문 요약 처리 (기본 4줄 Target)
  let introQuota = 4;
  const introAchievementMatches = introText.match(ACHIEVEMENT_VERB_REGEX);
  if (introAchievementMatches && introAchievementMatches.length >= 3) {
    introQuota = 6; // 서문에 업적 어휘가 풍부하면 서문 요약 비율 대폭 증가
  }

  const selectedIntroSentences = [];
  const validIntroSentences = flatIntroSentences.filter(item => !isDisqualifiedSentence(item.cleaned));

  for (let idx = 0; idx < validIntroSentences.length && selectedIntroSentences.length < introQuota; idx++) {
    const item = validIntroSentences[idx];
    const globalIdx = flatIntroSentences.indexOf(item);
    const resolvedSentence = resolveAnaphora(item.cleaned, allFlatSentences, globalIdx);
    selectedIntroSentences.push(resolvedSentence);
  }

  // 2. 문단별(Paragraph) 2줄~3줄 요약 처리 (볼드/링크/업적 키워드 우선)
  const selectedBodySentences = [];

  for (const paragraphSentences of parsedBodyParagraphs) {
    const validParagraphItems = paragraphSentences.filter(item => !isDisqualifiedSentence(item.cleaned));
    if (validParagraphItems.length === 0) continue;

    const scoredItems = validParagraphItems.map((item) => {
      const globalIdx = allFlatSentences.indexOf(item);
      return {
        item,
        score: scoreSentence(item),
        globalIdx
      };
    }).sort((a, b) => b.score - a.score);

    // 문단당 2~3줄 추출
    const countToTake = Math.min(validParagraphItems.length, 3);
    const topParagraphItems = scoredItems.slice(0, countToTake).sort((a, b) => a.globalIdx - b.globalIdx);

    for (const scored of topParagraphItems) {
      const resolvedSentence = resolveAnaphora(scored.item.cleaned, allFlatSentences, scored.globalIdx);
      selectedBodySentences.push(resolvedSentence);
    }
  }

  const finalSentences = [...selectedIntroSentences, ...selectedBodySentences];
  const result = finalSentences.join(" ");

  return (cache[cacheKey] = result);
}

export function summarizeText(text) {
  if (!text) {
    return { summary: "", sentenceCount: 0, usedSentences: 0 };
  }

  const paragraphs = text.split(/\n\s*\n|\n?==+[^=]+==+\n?/).filter(p => p.trim());
  const introText = paragraphs[0] || "";
  const bodyText = paragraphs.slice(1).join("\n\n");

  const summary = buildDescription(introText, bodyText);
  const totalSentences = text.split(/(?<=[.!?])\s+/).length;
  const usedSentences = summary.split(/(?<=[.!?])\s+/).length;

  return {
    summary,
    sentenceCount: totalSentences,
    usedSentences: usedSentences,
  };
}
