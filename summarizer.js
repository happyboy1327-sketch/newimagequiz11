// summarizer.js
// 위키 원문 정제(cleanWikiText) + 호/자 정제(stripMetainfo) + 서문 앵커(Anchor) 고정 요약 모듈

// ==========================================================
// 1. 위키 텍스트 전처리 정제 함수 (cleanWikiText)
// ==========================================================

export function cleanWikiText(text) {
  if (!text) return "";
  let cleaned = text;

  // 1) HTML 태그 제거
  cleaned = cleaned.replace(/<[^>]+>/g, "");

  // 2) 위키 대괄호 링크 정제 ([[고구려|고구려국]] -> 고구려국, [[백제]] -> 백제)
  cleaned = cleaned.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1");

  // 3) 각주 및 위키 마크업 제거 ([1], [2], [각주], [출처 필요], [편집] 등)
  cleaned = cleaned.replace(/\[\d+\]/g, "");
  cleaned = cleaned.replace(/\[(?:각주|출처\s*필요|편집|주석)\]/g, "");

  // 4) 재위 기간 등 괄호 안 잡다한 연표 메타 정제
  cleaned = cleaned.replace(/\(\s*재위\s*:[^)]+\)/g, "");

  // 5) 문장 내 항목 번호 노이즈 제거 ("1) 왕대수 또는 2) 혈연상..." -> "왕대수 또는 혈연상...")
  cleaned = cleaned.replace(/(?<=\s|^)\d+\)\s*/g, "");

  // 6) 중복 공백 정리
  return cleaned.replace(/\s+/g, " ").trim();
}


// ==========================================================
// 2. 메타 정보, 족보 TMI, 잡다한 서술절 통합 정제 함수 (위치 2)
// ==========================================================

// ==========================================================
// 2. 메타 정보, 족보 TMI, 잡다한 서술절 통합 정제 함수
// ==========================================================

export function stripMetainfo(text) {
  if (!text) return "";
  let result = text;

  // 1) 괄호 안 족보 TMI 도려내기
  result = result.replace(/\([^)]*(?:부친|모친|조부|증조부|고조부|외가|손자|처남|장인|남씨|윤씨|씨)[^)]*\)/g, "");

  // 2) 출생절 및 파손 조각 완전 제거
  result = result.replace(
    /(?:(?:의\s*)?(?:첫|둘째|셋째|넷째|다섯째|막내)?\s*(?:번째|째)?\s*(?:아들|딸|남|녀|장남|차남|삼남|사남|오남|장녀|차녀|삼녀|사녀|외아들|외딸)?(?:로|으로)?\s*태어났(?:다|으며|고)|(?:의\s*로\s*태어났(?:다|으며|고)))/g,
    ""
  );

  // 3) 족보/보계/시조/세손/후손 문장절 도려내기
  result = result.replace(/[^,.!?\n]{1,50}?(?:\d+세손|\d+대손|시조|후손)(?:이다|이며|이고|이었다|였다)[,;\s]*/g, "");

  // 4) 혼인/처가/시댁 거주 관련 절 도려내기
  result = result.replace(
    /(?:(?:[가-힣]+(?:와|과)\s*)?(?:결혼|혼인|성혼|재혼|이혼|파혼)(?:했|하였|되었|됐|하|하고|이후|이후엔)?(?:다|으며|고|자|음|나|엔)?[,;\s]*)/g,
    ""
  );
  result = result.replace(/(?:(?:처가|시댁)(?:인|에서|의)?\s*[^,.!?\n]{1,30}?(?:지냈다|살았다|거주했다)[,;\s]*)/g, "");

  // 5) 자녀 명명/형제 이름 나열 절 도려내기
  result = result.replace(/[^,.!?\n]{1,50}?(?:아들|딸|자녀)(?:에게|들의|의)\s*[^,.!?\n]{1,50}?(?:이름|이름자)[^,.!?\n]{1,30}?(?:지었다|붙였다)[,;\s]*/g, "");

  // 6) 메타 라벨(본관, 호, 자 등) 도려내기 (생몰년 날짜 괄호 보호)
  const metaLabelPattern = "(?:(?:본관|시호|아호|별호|아명|태명|세례명|법명|묘호|당호|호|자|묘)(?:는|은|\\s*[:=]))";

  const innerMetaRegex = new RegExp(`${metaLabelPattern}\\s*[^,;)]+(?:\\([^)]*\\))?`, "g");
  result = result.replace(/\(([^()]+(?:\([^()]*\)[^()]*)*)\)/g, (match, inner) => {
    if (/(?:\d{3,4}년|~)/.test(inner)) return match;
    let cleanedInner = inner.replace(innerMetaRegex, "").trim();
    cleanedInner = cleanedInner.replace(/^[\s,;]+|[\s,;]+$/g, "").replace(/[\s,;]{2,}/g, ", ");
    return cleanedInner ? `(${cleanedInner})` : "";
  });

  const standaloneMetaRegex = new RegExp(
    `(?:(?<=[,.\\s]|^))${metaLabelPattern}\\s*[^,;.\\n()]*\\s*(?:\\([^()]*\\)[^,;.\\n()]*)*\\s*(?:이다|였다|이었다|이며|이고|이자|으로|임)?(?:,\\s*|\\.\\s*|\\s+|$)`,
    "g"
  );
  result = result.replace(standaloneMetaRegex, "");

  // 7) 구두점 및 다중 공백 정리 (체이닝 중간 세미콜론 주의)
  result = result
    .replace(/,\s*,/g, ",")
    .replace(/^\s*,\s*/, "")
    .replace(/\s*,\s*$/, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+\./g, ".")
    .replace(/\s+/g, " ")
    .trim();

  // 8) 서술어가 잘린 불완전한 문장(유령 문장) 폐기
  const words = result.match(/[가-힣a-zA-Z0-9]{2,}/g) || [];
  if (words.length <= 2) return "";

  if (/(?:[인과의는은를을에서로으로임함]\s*\.?$|[A-Z]\.\s*$)/i.test(result)) {
    return "";
  }

  return result;
}

// ==========================================================
// 3. 범용 핵심어 & 노이즈 사전
// ==========================================================

const CORE_SIGNIFICANCE_KEYWORDS = [
  "원리", "구조", "기능", "작용", "현상", "이론", "연구", "발견", "규명", "증명", 
  "분석", "기반", "시스템", "메커니즘", "특징", "성질", "분류", "상태", "상호작용", "개척",
  "제도", "정책", "사회", "경제", "체계", "관계", "변화", "전개", "성장", "효과", 
  "원인", "결과", "분포", "개혁", "조약", "협정", "시장", "구조적", "통일", "통합", "정합", 
  "양식", "사상", "문화", "작품", "기법", "전통", "유형", "형성", "창작", "유산", "완화", 
  "대표", "영향", "의의", "기여", "발전", "역사", "중심", "주요", "핵심", "주요한",
  "지정", "설립", "주도", "구성", "기록", "도입", "확립", "공격", "격퇴", "정벌", "함락"
];

const UNIVERSAL_NOISE_KEYWORDS = [
  "자세한 내용은", "참조하십시오", "출처 필요", "각주", "외부 링크", "참고 문헌",
  "여담", "기타", "대중 문화", "서브컬처", "패러디", "밈", "스포일러", "오류",
  "차이를 보이고", "별명", "소문", "야사", "미디어에서", "여담으로", "설이 있다"
];

const CORE_SIGNIFICANCE_REGEX = new RegExp(CORE_SIGNIFICANCE_KEYWORDS.join("|"));
const UNIVERSAL_NOISE_REGEX = new RegExp(UNIVERSAL_NOISE_KEYWORDS.join("|"));
// 업적 관련 핵심 어간/동사 패턴 (컴파일 타임 정규식 리터럴)
const ACHIEVEMENT_VERB_REGEX = /(저술|집필|설계|고안|집대성|제시|편찬|주창|발명|창안|개혁|건축|축조|간행|통찰|창작|창시|정리|도입|확립|반영|기여|주도|설립|격퇴|정벌|연구|지휘|승리|격파|격침|건조|수호|통제|구원|평정|혁신|창설)/;

// 수동적 배경/지형 서술 패턴 (감점 대상)
const PASSIVE_BG_REGEX = /((?:지점|시대|무렵|해|곳)이다|위치해\s*있다|일이\s*벌어졌다|상황이었다|태어났다)/;
// 요약문 추출 시 감점 판단용 (결혼, 이혼, 배우자 추가)
const FAMILY_NOISE_REGEX = /(부친|모친|조부|증조부|고조부|외가|오대손녀|첫\s*부인|둘째\s*부인|가계도|손자|처남|장인|결혼|이혼|혼인|재혼|파혼|배우자|남편|아내|며느리|사위)/;
// ==========================================================
// 4. 헬퍼 함수
// ==========================================================

const REGEX_LEADING_CONNECTORS = /^(그러나|하지만|그런데|한편|따라서|게다가|반면|이에|이후|결국|그\s*후|또한|그리고),?\s*/;
function cleanLeadingConnectors(sentence) {
  return sentence ? sentence.replace(REGEX_LEADING_CONNECTORS, "").trim() : "";
}

function splitSentences(text) {
  if (!text) return [];
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned
    .split(/(?<=[.!?])\s+(?=[가-힣A-Za-z0-9"'(])/)
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

// ==========================================================
// 5. 주제어 분석 및 TextRank 알고리즘
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

// ==========================================================
// 6. 완벽 문장 조립 (서문 앵커 우선 배치 + TextRank 보완)
// ==========================================================

function assembleCompleteSentences(anchorSentences, rankedCandidates, maxLength = 630) {
  let summaryParts = [];
  let currentLength = 0;

  // 1) 서문 앵커 문장 우선 배치 (글자 수 한도 내)
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

  // 2) 남은 후보 문장들 추가 (TextRank 점수순)
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

// ==========================================================
// 7. 메인 요약 함수: buildDescription
// ==========================================================

export function buildDescription(
  introText = "",
  bodyText = "",
  aliases = [],
  extraCount = 3,
  anchorCount = 3, // 서문 앵커 고정 문장 개수 (기본 2개, 2~3개 자유 설정 가능)
  maxLength = 630
) {
  // 1) cleanWikiText -> stripMetainfo 파이프라인
  const rawCleanIntro = cleanWikiText(introText);
  const rawCleanBody = cleanWikiText(bodyText);

  const cleanIntro = stripMetainfo(rawCleanIntro);
  const cleanBody = stripMetainfo(rawCleanBody);

  const introSentences = splitSentences(cleanIntro);
  const bodySentences = splitSentences(cleanBody);

  if (introSentences.length === 0 && bodySentences.length === 0) return "";

  // 2) 앵커 문장(서문 첫 2~3문장) 및 후보 분석 문장 분리
  let anchorSentences = [];
  let candidateSentences = [];

  if (introSentences.length > 0) {
    anchorSentences = introSentences.slice(0, anchorCount);
    candidateSentences = [...introSentences.slice(anchorCount), ...bodySentences];
  } else {
    anchorSentences = bodySentences.slice(0, anchorCount);
    candidateSentences = bodySentences.slice(anchorCount);
  }

  if (candidateSentences.length === 0) {
    return assembleCompleteSentences(anchorSentences, [], maxLength);
  }

  // 3) 주제어 추출 및 TextRank 계산 (점수 정규화 추가)
  const topKeywords = getTopDocumentKeywords([...anchorSentences, ...candidateSentences], 10);
  const matrix = buildSimilarityMatrix(candidateSentences);
  const baseScores = pageRank(matrix);

  // [개선] TextRank 점수 정규화 (0.0 ~ 1.0 스케일 맞춤)
  const maxBaseScore = Math.max(...baseScores, 0.001);

  // 4) 가중치 계산 (극단적 배수 완화 + 소프트 스케일링)
  const finalCandidates = candidateSentences.map((sentence, index) => {
    let score = baseScores[index] / maxBaseScore; // 정규화된 기본 점수

    // 위치 가중치: 상단 문장 완만하게 우대
    const positionFactor = 1.0 / (1 + index * 0.06);
    score *= positionFactor;

    // 키워드 매칭 (최대 +45% 상한선 설정으로 점수 튀기 방지)
    const tokens = tokenize(sentence);
    let matchCount = 0;
    for (const token of tokens) {
      if (topKeywords.includes(token)) matchCount++;
    }
    score *= (1 + Math.min(matchCount, 3) * 0.15);

    // [개선] 업적 동사 우대 (2.5배 -> 1.5배로 완화하여 문맥 파괴 방지)
    if (ACHIEVEMENT_VERB_REGEX.test(sentence)) {
      score *= 1.5;
    }

    // [개선] 수동적 배경 및 노이즈 감점 (완화된 페널티)
    if (PASSIVE_BG_REGEX.test(sentence)) {
      score *= 0.4;
    }
    if (FAMILY_NOISE_REGEX.test(sentence)) {
      score *= 0.1;
    }

    // [개선] 문맥 단절 유발 접속사 시작 문장 페널티 ("또한", "이후", "한편" 등 독립 추출 시 부자연스러움 방지)
    if (/^(?:또한|이후|한편|그뒤|그후|그리고|그러나|하지만)\s*/.test(sentence)) {
      score *= 0.7;
    }

    return { sentence, score, index };
  });

  // 5) 상위 후보 추출 및 문맥 정렬
  const ranked = finalCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, extraCount)
    .sort((a, b) => a.index - b.index);

  // 6) 완벽한 문장 조립 (앵커 고정 + TextRank 보완)
  return assembleCompleteSentences(anchorSentences, ranked, maxLength);
}

export function summarizeText(text, topN = 3) {
  return {
    summary: buildDescription(text, "", [], topN - 1, 2),
    sentenceCount: splitSentences(text).length,
    usedSentences: topN,
  };
}
