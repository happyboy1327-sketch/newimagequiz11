// TextRank 알고리즘 + 위키 메타 정제(생몰년/외국어명 보존) + 정의문 최우선 보존 융합 모듈

/**
 * 1. 괄호 메타정보 정제 (생몰년, 외국어/한자 표기는 '유지'하고 호/자/본관 등만 제거)
 * 예: "곽재우(郭再祐, 1552년~1617년, 자는 계묵, 호는 망우당)"
 *     -> "곽재우(郭再祐, 1552년~1617년)"
 */
function stripMetaInfo(text) {
  if (!text) return "";
  let result = text;

  // 불필요한 메타 키워드 패턴 (자, 호, 본관, 시호, 아명 등)
  const unwantedPattern = /^(?:\s*)(?:자는|호는|시호는|본관은|별호는|아호는|아명은|태명은|세례명은|일명은|당호는|법명은|묘호는|자|호|시호|본관|별호|아호|아명|태명|세례명|일명|당호|법명|묘호)(?:\s*[:=]|\s+|$)/;

  // 괄호 내부 항목별(쉼표 기준) 검사 후 호/자/본관 항목만 필터링
  result = result.replace(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, (match, inner) => {
    const parts = inner.split(/[,;]/);
    const filteredParts = parts.filter((part) => !unwantedPattern.test(part.trim()));

    if (filteredParts.length === 0) return "";
    return `(${filteredParts.join(", ").trim()})`;
  });

  // 빈 괄호 () 정리
  result = result.replace(/\(\s*\)/g, "");

  // 괄호 외부의 독립 메타 문장 정제 ("자는 계묵, 호는 망우당이다." 등)
  const standaloneMetaPattern = /(?<![가-힣a-zA-Z0-9])(?:자는|호는|시호는|본관은|별호는|아호는|아명은|태명은|세례명은|일명은|당호는|법명은|묘호는)\s+[^,;.\n)]+(?:이다|였다|이었다|이며|이고|이자|으로)?(?=[,;.\n]|$)/g;
  result = result.replace(standaloneMetaPattern, "");

  return result
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 독립된 순수 메타 문장 여부 검사
 */
function isPureMetaSentence(sentence) {
  if (!sentence) return false;
  const clean = sentence.trim();
  return /^(?:자|호|시호|본관|아명|법명)는\s+/.test(clean) ||
         /^(?:자는|호는|시호는|본관은)\s+[^.]+?(?:이다|였다|이었다)\.?$/.test(clean);
}

/** 접속어 정제 */
const REGEX_LEADING_CONNECTORS = /^(그러나|하지만|그런데|한편|따라서|게다가|반면|이에|이후|결국|그\s*후|또한|그리고),?\s*/;
function cleanLeadingConnectors(sentence) {
  return sentence ? sentence.replace(REGEX_LEADING_CONNECTORS, "").trim() : "";
}

/** 공백 및 글자 수 자르기 헬퍼 */
function cleanSlice(text, maxLength = 630) {
  if (!text || text.length <= maxLength) return text;
  const sliced = text.slice(0, maxLength);
  const lastPeriod = sliced.lastIndexOf(".");
  if (lastPeriod > maxLength * 0.5) {
    return sliced.slice(0, lastPeriod + 1).trim();
  }
  return sliced;
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
    .filter((w) => w.length > 0);
}

/** 문장 간 Jaccard 유사도 */
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

/** 유사도 행렬 생성 */
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

/** PageRank 계산 */
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
// 기존 API 호환 메인 함수: buildDescription
// ==========================================================
export function buildDescription(
  introText = "",
  bodyText = "",
  aliases = [],
  extraCount = 3,
  introThreshold = 150,
  maxLength = 630
) {
  // 1. 원문 정제 (한자명/생몰년 보존 및 잡다한 메타정보 제거)
  const cleanIntro = stripMetaInfo(introText);
  const cleanBody = stripMetaInfo(bodyText);

  const introSentences = splitSentences(cleanIntro);
  const bodySentences = splitSentences(cleanBody);

  if (introSentences.length === 0 && bodySentences.length === 0) return "";

  // 2. 첫 문장(인물/개념 정의문) 강제 보존
  let firstSentence = "";
  let candidateSentences = [];

  if (introSentences.length > 0) {
    firstSentence = introSentences[0];
    candidateSentences = [...introSentences.slice(1), ...bodySentences];
  } else {
    firstSentence = bodySentences[0];
    candidateSentences = bodySentences.slice(1);
  }

  // 독립된 메타 문장 노이즈 제거
  candidateSentences = candidateSentences.filter((s) => !isPureMetaSentence(s));

  if (candidateSentences.length === 0) {
    return cleanSlice(firstSentence, maxLength);
  }

  // 3. 남은 문장들에 대해 TextRank 계산
  const matrix = buildSimilarityMatrix(candidateSentences);
  const scores = pageRank(matrix);

  const ranked = candidateSentences
    .map((sentence, index) => ({ sentence, score: scores[index], index }))
    .sort((a, b) => b.score - a.score)
    .slice(0, extraCount)
    .sort((a, b) => a.index - b.index);

  const extraText = ranked
    .map((item) => cleanLeadingConnectors(item.sentence))
    .join(" ");

  // 4. [첫 문장 + TextRank 추출문] 결합 및 반환
  const finalResult = [firstSentence, extraText].filter(Boolean).join(" ");
  return cleanSlice(finalResult, maxLength);
}

// ==========================================================
// 단일 텍스트 요약 함수 (기존 summarizeText 호환용)
// ==========================================================
export function summarizeText(text, topN = 5) {
  return {
    summary: buildDescription(text, "", [], topN - 1),
    sentenceCount: splitSentences(text).length,
    usedSentences: topN,
  };
}
