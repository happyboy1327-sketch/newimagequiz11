// summarizer.js

const cache = {};

// ==========================================================
// 1. 범용 노이즈 규칙 Engine (Hard Guardrail)
// ==========================================================

const UNIVERSAL_NOISE_RULES = [
  /(?:며|는데|으나|하고|이고|고|지만|면서|이며|이자)이다\.?$/,
  /[은는이가을를에의와과으로로에서]\s*이다\.?$/,
  /(?:(?:지낸|벼슬|임명된|지내고)\s*[가-힣]{2,6},?\s*){2,}|(?:선조|조상|문중|가문)\b/,
  /(?:필명|아호|별호|아명|따왔다는|설도 있|설이 있|검열을 피하기|지면을 채워|자세한 내용은|참조하십시오|출처 필요)/,
  /(?:추측해 본다|추측된다|명확히 기술되지|알 수 없다|여담으로|설이 있다)/,
  /(?:활동|졸업|조직|출신|입학|결혼)\s*이다\.?$/
];

const ACHIEVEMENT_VERB_REGEX = /(?:저술|집필|설계|고안|집대성|제시|편찬|주창|발명|창안|개혁|건축|축조|간행|통찰|창작|창시|정리|도입|확립|반영|기여|주도|설립|격퇴|정벌|연구|지휘|승리|격파|격침|건조|수호|통제|구원|평정|혁신|창설|발견)/;
const MAJOR_HISTORICAL_EVENT_REGEX = /(?:[가-힣]{2,3}[란난]|해전|대첩|승첩|전투|의거|혁명|박해|정변|운동)/;
const ACADEMIC_CONCEPT_REGEX = /[가-힣]{2,}(?:설|론|주의|학|법)\b/;

// ==========================================================
// 2. 위키 원문 정제 & 문장 보정
// ==========================================================

export function cleanWikiText(text) {
  if (!text) return "";
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1")
    .replace(/\[\d+\]|\[(?:각주|출처\s*필요|편집|주석)\]/g, "")
    .replace(/\(\s*재위\s*:[^)]+\)/g, "")
    .replace(/(?<=\s|^)\d+\)\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripMetainfo(text) {
  if (!text) return "";
  let result = text;

  // 1) 문두 찌꺼기 부호 및 `.1운동` 표기 자동 복구
  result = result
    .replace(/^[\s.,;:\)\>]+/, "")
    .replace(/(?<!\d)\.1운동/g, "3.1운동");

  // 2) 괄호 내부 메타 정보 제거 (연도/생몰년 보존)
  result = result.replace(/\(([^()]+)\)/g, (match, inner) => {
    if (/(?:\d{3,4}년|~|음력)/.test(inner)) {
      return `(${inner.replace(/^\s*,\s*/, "").trim()})`;
    }
    if (/(?:본관|시호|아호|별호|아명|태명|법명|묘호|호|자|부친|모친|조부|출처)/.test(inner)) {
      return "";
    }
    return match;
  });

  result = result
    .replace(/,\s*\(\s*\)/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\(\s*,\s*/g, "(");

  // 3) 범용 메타 서술절 제거
  result = result
    .replace(/(?<![가-힣])(?:자|호|본관|시호|아호|별호|태명|아명)\b.*?(?:있다|있었다|전해진다)\.?/g, "")
    .replace(/(?<![가-힣])(?:본관|시호|아호|별호|아명|법명|묘호|호|자)\s*[:=는은이]\s*[^,;.\n]+/g, "");

  // 4) 불완전 어미 및 단절 조사 서술어 전환
  result = result
    .replace(/([가-힣]+)(?:했으며|하였으며|했으나|하였으나|했고|하였고|했지만)\s*\.?\s*$/g, "$1했다.")
    .replace(/([가-힣]+)(?:되었으며|되었으나|되었고|되었지만)\s*\.?\s*$/g, "$1되었다.")
    .replace(/([가-힣]+)(?:이었으며|이었으나|이었고|이었지만)\s*\.?\s*$/g, "$1이었다.")
    .replace(/([가-힣]+)(?:이라는|라는|인|이고|이며|이자|이라|이나|인데|이지만)\s*\.?\s*$/g, "$1이다.")
    .replace(/([가-힣]+)(?:하며|하고|하나|하지만)\s*\.?\s*$/g, "$1한다.")
    .replace(/([가-힣]+)(?:의|과|와|및|에서|에게|으로|로|을|를|은|는|이|가)\s*\.?\s*$/g, "$1이다.");

  // 5) 구두점 정리
  result = result
    .replace(/(?:,\s*)+,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/^\s*,\s*/, "")
    .replace(/\s*\.+\s*(?:\.+\s*)+/g, ".")
    .replace(/\s+/g, " ")
    .trim();

  if (result.length < 15) return "";

  const openParen = (result.match(/\(/g) || []).length;
  const closeParen = (result.match(/\)/g) || []).length;
  if (openParen !== closeParen) return "";

  if (UNIVERSAL_NOISE_RULES.some((rule) => rule.test(result))) {
    return "";
  }

  const VALID_DECLARATIVE_ENDING = /(?:다|함|임|됨|음|였음|했음|있음|없음)\.?$/;
  if (!VALID_DECLARATIVE_ENDING.test(result)) {
    result = result.replace(/[^가-힣a-zA-Z0-9]+$/g, "") + "이다.";
  } else if (!/[.!?]$/.test(result)) {
    result += ".";
  }

  return result;
}

// ==========================================================
// 3. 문장 분리 (소수점/날짜 보호) & 타인 주어 필터링
// ==========================================================

export function splitSentences(text) {
  if (!text) return [];
  return text
    .replace(/\s+/g, " ")
    .trim()
    // 수치/날짜 소수점(?<!\d\.\d) 및 일반 마침표 구분 처리
    .split(/(?<=[.!?])(?<!\d\.\d?)\s+(?=[가-힣A-Za-z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
}

function isValidSentenceStructure(sentence) {
  const trimmed = sentence.trim();
  if (trimmed.length < 15) return false;

  const openParen = (trimmed.match(/\(/g) || []).length;
  const closeParen = (trimmed.match(/\)/g) || []).length;
  if (openParen !== closeParen) return false;

  return true;
}

function isOtherSubject(sentence, docTitle) {
  if (!docTitle) return false;

  // 문두 첫 주어 추출 (날짜/장소/사건 부사구 제외 후 순수 주어 파악)
  const trimmed = sentence.replace(/^[\d\s년월일시분초계절소속기관명성명등\.,\-~가-힣]+(?:에|에서|부터|까지|에도)\s+/, "");
  const firstSubjectMatch = trimmed.match(/^[가-힣]{2,5}(?:은|는|이|(?<!다)가)\b/);
  
  if (!firstSubjectMatch) return false;

  const subject = firstSubjectMatch[0].replace(/(?:은|는|이|가)$/, "");
  const ALLOWED_PRONOUNS = ["그", "그는", "그의", "그녀", "그녀는", "이들은", "왕은", "황제는", "아버지는", "모친은", "조부는", "스승은", "열사는"];

  if (
    !ALLOWED_PRONOUNS.includes(subject) &&
    !docTitle.includes(subject) &&
    !subject.includes(docTitle.trim())
  ) {
    return true;
  }

  return false;
}

// ==========================================================
// 4. TF-IDF & 코사인 유사도
// ==========================================================

function tokenize(text) {
  return (text.match(/[가-힣a-zA-Z0-9]+/g) || []).filter((w) => w.length >= 2);
}

function computeTF(tokens) {
  const tf = {};
  if (tokens.length === 0) return tf;
  for (const token of tokens) {
    tf[token] = (tf[token] || 0) + 1;
  }
  for (const token in tf) {
    tf[token] = tf[token] / tokens.length;
  }
  return tf;
}

function computeIDF(sentenceTokensList) {
  const idf = {};
  const N = sentenceTokensList.length;
  if (N === 0) return idf;

  const docCount = {};
  for (const tokens of sentenceTokensList) {
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      docCount[token] = (docCount[token] || 0) + 1;
    }
  }

  for (const token in docCount) {
    idf[token] = Math.log((N + 1) / (docCount[token] + 1)) + 1;
  }
  return idf;
}

function computeTFIDF(tf, idf) {
  const tfidf = {};
  for (const token in tf) {
    tfidf[token] = tf[token] * (idf[token] || 0);
  }
  return tfidf;
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  const allKeys = new Set([...Object.keys(vecA), ...Object.keys(vecB)]);

  for (const key of allKeys) {
    const valA = vecA[key] || 0;
    const valB = vecB[key] || 0;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ==========================================================
// 5. 메인 요약 생성 엔진
// ==========================================================

export function buildDescription(
  introText = "",
  bodyText = "",
  aliases = [],
  extraCount = 3,
  anchorCount = 3,
  maxLength = 720,
  sectionTitle = "",
  docTitle = ""
) {
  const cacheKey = introText + bodyText + docTitle;
  if (cache[cacheKey]) return cache[cacheKey];

  const rawIntroSentences = splitSentences(cleanWikiText(introText));
  const rawBodySentences = splitSentences(cleanWikiText(bodyText));

  const introSentences = rawIntroSentences.map((s) => stripMetainfo(s)).filter(Boolean);
  const bodySentences = rawBodySentences.map((s) => stripMetainfo(s)).filter(Boolean);

  let anchorSentences = [];
  let candidateSentences = [];

  if (introSentences.length > 0) {
    anchorSentences = introSentences.slice(0, anchorCount);
    candidateSentences = [...introSentences.slice(anchorCount), ...bodySentences];
  } else {
    anchorSentences = bodySentences.slice(0, anchorCount);
    candidateSentences = bodySentences.slice(anchorCount);
  }

  if (candidateSentences.length > 25) {
    candidateSentences = candidateSentences.slice(0, 25);
  }

  const allSentences = [...anchorSentences, ...candidateSentences];
  if (allSentences.length === 0) return "";

  const sentenceTokensList = allSentences.map((s) => tokenize(s));
  const idfDict = computeIDF(sentenceTokensList);

  const docTokens = allSentences.flatMap((s) => tokenize(s));
  const docTF = computeTF(docTokens);
  const docVector = computeTFIDF(docTF, idfDict);

  // --- 후보 문장 스코어링 ---
  const finalCandidates = candidateSentences.map((sentence, index) => {
    // 1. 앵커 바로 뒤 첫 후보 문장이거나(index === 0), 구조적 결함이 있는 경우만 1차 체크
    // 문서의 핵심인 첫 부분 문장들은 주어 검사(isOtherSubject)를 Bypass
    const isFirstPart = index === 0 && anchorSentences.length < 2;

    if (!isValidSentenceStructure(sentence)) {
      return { sentence, score: 0, index };
    }

    // 첫 문장 영역이 아니고, 확실히 다른 주어일 때만 타인 주어로 판정하여 차단
    if (!isFirstPart && isOtherSubject(sentence, docTitle)) {
      return { sentence, score: 0, index };
    }

    // 2. TF-IDF 코사인 유사도 연산
    const tokens = tokenize(sentence);
    const sentenceTF = computeTF(tokens);
    const sentenceVector = computeTFIDF(sentenceTF, idfDict);
    const similarityScore = cosineSimilarity(sentenceVector, docVector);

    // 3. 가산점 부여
    let score = similarityScore * (1.0 / (1 + index * 0.05));
    if (ACHIEVEMENT_VERB_REGEX.test(sentence)) score *= 1.5;
    if (ACADEMIC_CONCEPT_REGEX.test(sentence)) score *= 1.4;
    if (MAJOR_HISTORICAL_EVENT_REGEX.test(sentence)) score *= 1.4;

    return { sentence, score, index };
  });

  const ranked = finalCandidates
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, extraCount)
    .sort((a, b) => a.index - b.index);

  let resultParts = [...anchorSentences];
  for (const item of ranked) {
    if (!resultParts.includes(item.sentence)) {
      resultParts.push(item.sentence);
    }
  }

  const result = resultParts.join(" ");
  return (cache[cacheKey] = result);
}

export function summarizeText(text, topN = 3, docTitle = "") {
  return {
    summary: buildDescription(text, "", [], topN - 1, 2, 720, "", docTitle),
    sentenceCount: splitSentences(text).length,
    usedSentences: topN,
  };
}
