// ==========================================================
// 1. 위키 정제 및 파싱 로직
// ==========================================================

// HTML 태그, 각주, 위키 링크만 정제 (괄호 및 내부 메타 정보 100% 보존)
export function cleanWikiText(text) {
  if (!text) return "";
  return text
    .replace(/<[^>]+>/g, "")                         // HTML 태그 제거
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1") // 위키 링크 [[A|B]] -> B
    .replace(/\[\d+\]/g, "")                         // 각주 [1] 제거
    .replace(/\[(?:각주|출처\s*필요|편집|주석)\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 문장 단위 정밀 분리 정규식 (숫자.숫자, 날짜, 영문 약어 분리 완전 방지)
const RE_SENTENCE_SPLIT = /(?<!\d\.)(?<!\b(?:Op|No|Dr|Mr|Mrs|Ms|Prof|vs|Vol|St|Co|Inc|Ltd|etc)\.)(?<=[.!?])\s+(?=[가-힣A-Za-z0-9"'(])/i;

// 부차적 목차 절단 정규식
export const CUT_SECTION_REGEX = /(?:^|\n)\s*={2,}\s*(각주|가족|같이 보기|참고 문헌|참고 자료|기타|외부 링크|주석|여담|갤러리|가계도|계보|[가-힣\s]*작품(?:\s*목록)?|[가-힣\s]*저서|출연작|음반|디스코그래피)\s*={2,}/i;

// 단독 메타 문구 및 문두 파편 정리 (본문 파괴 방지)
export function stripMetainfo(text) {
  if (!text) return "";
  let cleaned = cleanWikiText(text);

  // 문장 시작 부분의 불필요한 단독 메타 서술어만 제한적 정제 (최대 15자)
  cleaned = cleaned.replace(/(?:^|\s*)(?:본관|본적|시호|아호|별호|아명|태명|세례명|법명|묘호|당호|자|호|휘)\s*(?:은|는|:)\s*[^.,\n]{1,15}(?:[.,]|\s*)/g, "");

  // 메타 정제 후 남은 문두 중앙점(·) 및 공백 찌꺼기 제거
  cleaned = cleaned.replace(/^[·\s]+/, "");

  return cleaned
    .replace(/,\s*,+/g, ",")
    .replace(/^\s*,\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ==========================================================
// 2. 키워드, 필터 및 배제 규칙
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
  "국채보상운동", "구국", "대한의군", "유묵", "도량형", "만리장성", "천하통일", "거중기", "실학"
];

const UNIVERSAL_NOISE_KEYWORDS = [
  "자세한 내용은", "참조하십시오", "출처 필요", "각주", "외부 링크", "참고 문헌", "경력", "위키미디어 공용에", 
  "여담", "기타", "대중 문화", "서브컬처", "패러디", "밈", "스포일러", "오류",
  "차이를 보이고", "별명", "소문", "야사", "미디어에서", "여담으로", "설이 있다", "추측", "보고 있다", "미디어 분류가 있습니다."
];

const DISQUALIFIED_CONNECTORS_REGEX = /^(?:그러나|하지만|그런데|한편|이후|당시|그\s*후|그\s*뒤|그러던\s*중|이에\s*따라|그\s*당시|그\s*이후|그러고\s*나서|그때|이때)/;

const TMI_NOISE_REGEX = /(?:부친|모친|조부|증조부|고조부|외가|첫\s*부인|둘째\s*부인|가계도|손자|처남|장인|결혼|이혼|혼인|재혼|배우자|남편|아내|딸|아들|처가|시댁|장남|차남|장녀|차녀|외아들|외딸|\d남|\d녀|위인전|출판사|족보|입향시조|후사|종친|문중|호적|예규|성씨|두음법칙)/;

const MAJOR_HISTORICAL_EVENT_REGEX = /(?:[가-힣]{2,3}[란난]|해전|대첩|승첩|전투|의거|혁명|박해)/;
const ACADEMIC_CONCEPT_REGEX = /[가-힣]{2,}(?:설|론|주의|학)\b/;
const ACHIEVEMENT_VERB_REGEX = /(?:저술|집필|설계|고안|집대성|제시|편찬|주창|발명|창안|개혁|건축|축조|간행|통찰|창작|창시|정리|도입|확립|반영|기여|주도|설립|격퇴|정벌|연구|지휘|승리|격파|격침|건조|수호|통제|구원|평정|혁신|창설|발견|노벨상|통일|단행)/g;
const CORE_SIGNIFICANCE_TEST_REGEX = new RegExp(CORE_SIGNIFICANCE_KEYWORDS.join("|"));

// ==========================================================
// 3. 필터링 및 점수 계산
// ==========================================================

function isDisqualifiedSentence(sentence, isFirstIntroSentence = false) {
  if (!sentence) return true;
  if (DISQUALIFIED_CONNECTORS_REGEX.test(sentence.trim())) return true;
  
  // 서문 맨 첫 문장은 TMI 키워드가 포함되어도 절대 배제하지 않음
  if (!isFirstIntroSentence && TMI_NOISE_REGEX.test(sentence)) return true;
  
  if (UNIVERSAL_NOISE_KEYWORDS.some(kw => sentence.includes(kw))) return true;
  return false;
}

function scoreSentence(item) {
  let score = 1.0;
  const sentence = item.cleaned;

  if (item.hasBold) score += 1.8;
  if (item.hasLink) score += 1.0;

  const achievementMatches = sentence.match(ACHIEVEMENT_VERB_REGEX);
  if (achievementMatches) score += achievementMatches.length * 1.8;

  const keywordMatches = sentence.match(CORE_SIGNIFICANCE_TEST_REGEX);
  if (keywordMatches) score += keywordMatches.length * 0.5;

  if (MAJOR_HISTORICAL_EVENT_REGEX.test(sentence)) score += 1.0;
  if (ACADEMIC_CONCEPT_REGEX.test(sentence)) score += 0.8;

  return score;
}

// ==========================================================
// 4. 문단 파싱 및 안출 로직
// ==========================================================

export function extractAnnotatedParagraphs(rawText) {
  if (!rawText) return [];

  let extractBody = rawText;
  const cutIndex = extractBody.search(CUT_SECTION_REGEX);
  if (cutIndex !== -1) {
    extractBody = extractBody.substring(0, cutIndex);
  }

  const paragraphs = extractBody.split(/\n+|\n?==+[^=]+==+\n?/).filter(p => p.trim());
  const structuredParagraphs = [];

  for (const p of paragraphs) {
    const rawSentences = p.split(RE_SENTENCE_SPLIT).map(s => s.trim()).filter(Boolean);
    const parsedSentences = [];

    for (let raw of rawSentences) {
      // 콜론 및 문두 파편 정리
      raw = raw.replace(/^(\d+년\s*\d+월\s*\d+일)\s*:\s*/, "$1 ").replace(/^[·\s]+/, "");

      const hasBold = /'''|<b>|<strong>/.test(raw);
      const hasLink = /\[\[/.test(raw);

      const cleaned = stripMetainfo(raw);
      const validWordCount = (cleaned.match(/[가-힣A-Za-z0-9]{2,}/g) || []).length;

      if (cleaned && validWordCount >= 2) {
        parsedSentences.push({ raw, cleaned, hasBold, hasLink });
      }
    }

    if (parsedSentences.length > 0) {
      structuredParagraphs.push(parsedSentences);
    }
  }

  return structuredParagraphs;
}

// ==========================================================
// 5. 메인 요약 생성 함수
// ==========================================================

export function buildDescription(introText = "", bodyText = "", aliases = [], maxLength = 800) {
  const parsedIntroParagraphs = extractAnnotatedParagraphs(introText);
  const parsedBodyParagraphs = extractAnnotatedParagraphs(bodyText);

  const flatIntroSentences = parsedIntroParagraphs.flat();
  const flatBodySentences = parsedBodyParagraphs.flat();
  const allFlatSentences = [...flatIntroSentences, ...flatBodySentences];

  let currentLength = 0;
  const selectedSentences = [];
  const seenContents = new Set();

  // 1. 서문 처리 (첫 문장은 isFirstIntroSentence=true 전달하여 TMI 필터 스킵)
  const validIntroSentences = flatIntroSentences.filter((item, idx) => {
    const isFirstIntroSentence = (idx === 0);
    return !isDisqualifiedSentence(item.cleaned, isFirstIntroSentence);
  });

  for (let idx = 0; idx < validIntroSentences.length && selectedSentences.length < 4; idx++) {
    const item = validIntroSentences[idx];
    const resolved = item.cleaned;
    const keyFingerprint = resolved.replace(/[^가-힣0-9]/g, "").slice(0, 15);

    if (!seenContents.has(keyFingerprint) && currentLength + resolved.length + 1 <= maxLength) {
      selectedSentences.push(resolved);
      seenContents.add(keyFingerprint);
      currentLength += resolved.length + 1;
    }
  }

  // 2. 본문 후보 선출
  const candidateBodyItems = [];
  for (const paragraphSentences of parsedBodyParagraphs) {
    const validParagraphItems = paragraphSentences.filter(item => !isDisqualifiedSentence(item.cleaned));
    if (validParagraphItems.length === 0) continue;

    const scoredItems = validParagraphItems.map((item) => ({
      item,
      score: scoreSentence(item),
      globalIdx: allFlatSentences.indexOf(item)
    })).sort((a, b) => b.score - a.score);

    candidateBodyItems.push(...scoredItems.slice(0, 3));
  }

  candidateBodyItems.sort((a, b) => b.score - a.score);

  const pickedBodyItems = [];
  for (const candidate of candidateBodyItems) {
    const resolved = candidate.item.cleaned;
    const keyFingerprint = resolved.replace(/[^가-힣0-9]/g, "").slice(0, 15);

    if (!seenContents.has(keyFingerprint) && currentLength + resolved.length + 1 <= maxLength) {
      pickedBodyItems.push({ ...candidate, resolved });
      seenContents.add(keyFingerprint);
      currentLength += resolved.length + 1;
    }
  }

  pickedBodyItems.sort((a, b) => a.globalIdx - b.globalIdx);
  for (const item of pickedBodyItems) {
    selectedSentences.push(item.resolved);
  }

  return selectedSentences.join(" ");
}

export function summarizeText(text) {
  if (!text) return { summary: "", sentenceCount: 0, usedSentences: 0 };

  const paragraphs = text.split(/\n+|\n?==+[^=]+==+\n?/).filter(p => p.trim());
  const introText = paragraphs[0] || "";
  const bodyText = paragraphs.slice(1).join("\n\n");

  const summary = buildDescription(introText, bodyText);
  const totalSentences = text.split(/(?<=[.!?])\s+/).length;
  const usedSentences = summary ? summary.split(/(?<=[.!?])\s+/).length : 0;

  return { summary, sentenceCount: totalSentences, usedSentences };
}
