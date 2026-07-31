// summarizer.js
// 위키 원문 정제(cleanWikiText) + 범용 요약(TextRank + 주제어 감지) 모듈

// ==========================================================
// 1. 위키 텍스트 전처리 정제 함수 (cleanWikiText)
// ==========================================================

/**
 * 위키 원문의 각주, HTML 태그, 링크 마크업, 재위 기간, 항목 번호 등을 정제
 * (단, 한자/외국어명 및 생몰년은 보존)
 */
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
// 2. 범용 핵심어 & 노이즈 사전
// ==========================================================

const CORE_SIGNIFICANCE_KEYWORDS = [
  "원리", "구조", "기능", "작용", "현상", "이론", "연구", "발견", "규명", "증명", 
  "분석", "기반", "시스템", "메커니즘", "특징", "성질", "분류", "상태", "상호작용",
  "제도", "정책", "사회", "경제", "체계", "관계", "변화", "전개", "성장", "효과", 
  "원인", "결과", "분포", "개혁", "조약", "협정", "시장", "구조적",
  "양식", "사상", "문화", "작품", "기법", "전통", "유형", "형성", "창작", "유산",
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

// ==========================================================
// 3. 메타 정보 정제 (자/호/본관 등 제거, 생몰년/외국어명 유지)
// ==========================================================

function stripMetaInfo(text) {
  if (!text) return "";
  let result = text;

  const unwantedPattern = /^(?:\s*)(?:자는|호는|시호는|본관은|별호는|아호는|아명은|태명은|세례명은|일명은|당호는|법명은|묘호는|자|호|시호|본관|별호|아호|아명|태명|세례명|일명|당호|법명|묘호)(?:\s*[:=]|\s+|$)/;

  result = result.replace(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, (match, inner) => {
    const parts = inner.split(/[,;]/);
    const filteredParts = parts.filter((part) => !unwantedPattern.test(part.trim()));

    if (filteredParts.length === 0) return "";
    return `(${filteredParts.join(", ").trim()})`;
  });

  result = result.replace(/\(\s*\)/g, "");

  const standaloneMetaPattern = /(?<![가-힣a-zA-Z0-9])(?:자는|호는|시호는|본관은|별호는|아호는|아명은|태명은|세례명은|일명은|당호는|법명은|묘호는)\s+[^,;.\n)]+(?:이다|였다|이었다|이며|이고|이자|으로)?(?=[,;.\n]|$)/g;
  result = result.replace(standaloneMetaPattern, "");

  return result
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** 접속어 정제 */
const REGEX_LEADING_CONNECTORS = /^(그러나|하지만|그런데|한편|따라서|게다가|반면|이에|이후|결국|그\s*후|또한|그리고),?\s*/;
function cleanLeadingConnectors(sentence) {
  return sentence ? sentence.replace(REGEX_LEADING_CONNECTORS, "").trim() : "";
}

/** 문장 분리 */
function splitSentences(text) {
  if (!text) return [];
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned
    .split(/(?<=[.!?])\s+(?=[가-힣A-Za-z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
}

/** 토큰화 */
function tokenize(sentence) {
  return sentence
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

// ==========================================================
// 4. 주제어 분석 및 TextRank 알고리즘
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
// 5. 완벽 문장 조립 (문장 잘림 방지)
// ==========================================================

function assembleCompleteSentences(firstSentence, rankedCandidates, maxLength = 630) {
  let summaryParts = [];
  let currentLength = 0;

  if (firstSentence) {
    let cleanFirst = firstSentence.trim();
    if (!/[.!?]$/.test(cleanFirst)) cleanFirst += ".";
    summaryParts.push(cleanFirst);
    currentLength += cleanFirst.length;
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

// ==========================================================
// 6. 메인 요약 함수: buildDescription
// ==========================================================

export function buildDescription(
  introText = "",
  bodyText = "",
  aliases = [],
  extraCount = 3,
  introThreshold = 150,
  maxLength = 630
) {
  // 1. 위키 텍스트 노이즈 정제 (cleanWikiText) -> 메타 정제 (stripMetaInfo)
  const rawCleanIntro = cleanWikiText(introText);
  const rawCleanBody = cleanWikiText(bodyText);

  const cleanIntro = stripMetaInfo(rawCleanIntro);
  const cleanBody = stripMetaInfo(rawCleanBody);

  const introSentences = splitSentences(cleanIntro);
  const bodySentences = splitSentences(cleanBody);

  if (introSentences.length === 0 && bodySentences.length === 0) return "";

  // 2. 정의문(첫 문장) 추출
  let firstSentence = "";
  let candidateSentences = [];

  if (introSentences.length > 0) {
    firstSentence = introSentences[0];
    candidateSentences = [...introSentences.slice(1), ...bodySentences];
  } else {
    firstSentence = bodySentences[0];
    candidateSentences = bodySentences.slice(1);
  }

  if (candidateSentences.length === 0) {
    return firstSentence.length <= maxLength 
      ? (firstSentence.endsWith(".") ? firstSentence : firstSentence + ".")
      : firstSentence.slice(0, maxLength);
  }

  // 3. 주제어 추출 및 TextRank 계산
  const topKeywords = getTopDocumentKeywords([firstSentence, ...candidateSentences], 10);
  const matrix = buildSimilarityMatrix(candidateSentences);
  const baseScores = pageRank(matrix);

  // 4. 가중치 적용
  const finalCandidates = candidateSentences.map((sentence, index) => {
    let score = baseScores[index] || 0.1;

    const positionFactor = 1.0 / (1 + index * 0.1);
    score *= positionFactor;

    const tokens = tokenize(sentence);
    let matchCount = 0;
    for (const token of tokens) {
      if (topKeywords.includes(token)) matchCount++;
    }
    score *= (1 + matchCount * 0.25);

    if (CORE_SIGNIFICANCE_REGEX.test(sentence)) {
      score *= 1.5;
    }

    if (UNIVERSAL_NOISE_REGEX.test(sentence)) {
      score *= 0.2;
    }

    return { sentence, score, index };
  });

  // 5. 상위 문장 추출 및 원문 순 정렬
  const ranked = finalCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, extraCount + 2)
    .sort((a, b) => a.index - b.index);

  // 6. 완벽한 문장 단위 조립
  return assembleCompleteSentences(firstSentence, ranked, maxLength);
}

export function summarizeText(text, topN = 3) {
  return {
    summary: buildDescription(text, "", [], topN - 1),
    sentenceCount: splitSentences(text).length,
    usedSentences: topN,
  };
}

