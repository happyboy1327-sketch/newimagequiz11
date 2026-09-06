// summarizer.js

const cache = {};

// ==========================================================
// 1. 범용 노이즈 규칙 Engine (Hard Guardrail) & 중요 키워드
// ==========================================================

const UNIVERSAL_NOISE_RULES = [
  // 1) 단절·오염 어미 (숫자/단위/조사/연결어미 직후 '이다' 결합)
  /(?:\d+|월|년|일|점|명|개|원)\s*이다\.?$/,
  /(?:며|는데|으나|하고|이고|고|지만|면서|이며|이자)이다\.?$/,
  /[은는이가을를에의와과으로로에서]\s*이다\.?$/,

  // 2) 가계·혈연·인척 정보 및 관직 연속 나열 가계도 패턴
  /(?:아버지는|어머니는|부친|모친|조부|증조부|고조부|후손|대손|가계도|손자|처남|장인|배우자|장남|차남|장녀|차녀|\d남|\d녀)/,
  /(?:(?:지낸|벼슬|임명된|지내고)\s*[가-힣]{2,6},?\s*){2,}|(?:선조|조상|문중|가문)\b/,

  // 3) 메타/유래/출처/추측성 부연 서술
  /(?:필명|아호|별호|아명|따왔다는|설도 있|설이 있|검열을 피하기|지면을 채워|뽑을 것이라는|전문지|차지했다|자세한 내용은|참조하십시오|출처 필요)/,
  /(?:추측해 본다|추측된다|명확히 기술되지|알 수 없다|여담으로|설이 있다|태어난|지점이다)/,

  // 4) 단순 단답형/이력 마감 구문
  /(?:활동|졸업|조직|출신|입학|결혼)\s*이다\.?$/
];

const ACHIEVEMENT_VERB_REGEX = /(?:저술|집필|설계|고안|집대성|제시|편찬|주창|발명|창안|개혁|건축|축조|간행|통찰|창작|창시|정리|도입|확립|반영|기여|주도|설립|격퇴|정벌|연구|지휘|승리|격파|격침|건조|수호|통제|구원|평정|혁신|창설|발견)/;

const MAJOR_HISTORICAL_EVENT_REGEX = /(?:[가-힣]{2,3}[란난]|해전|대첩|승첩|전투|의거|혁명|박해|정변)/;
const ACADEMIC_CONCEPT_REGEX = /[가-힣]{2,}(?:설|론|주의|학|법)\b/;

// ==========================================================
// 2. 위키 원문 정제 및 메타 정제 함수
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

  // 1) 괄호 및 내부 메타 정보 제거 (생몰년/연도 보존)
  result = result.replace(/\(([^()]+)\)/g, (match, inner) => {
    if (/(?:\d{3,4}년|~|음력)/.test(inner)) {
      const cleaned = inner.replace(/^\s*,\s*/, "").trim();
      return `(${cleaned})`;
    }
    if (/(?:본관|시호|아호|별호|아명|태명|법명|묘호|호|자|부친|모친|조부|출처)/.test(inner)) {
      return "";
    }
    return match;
  });

  // 잔여 공백 및 빈 괄호 정돈
  result = result
    .replace(/,\s*\(\s*\)/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\(\s*,\s*/g, "(");

  // 2) 범용 메타 서술절 제거
  result = result
    .replace(/(?<![가-힣])(?:자|호|본관|시호|아호|별호|태명|아명)\b.*?(?:있다|있었다|전해진다)\.?/g, "")
    .replace(/(?<![가-힣])(?:본관|시호|아호|별호|아명|법명|묘호|호|자)\s*[:=는은이]\s*[^,;.\n]+/g, "");

  // 3) [어미 자동 치환] 불완전/단절 어미를 완전한 서술어로 강제 변환
  result = result
    .replace(/([가-힣]+)(?:했으며|하였으며|했으나|하였으나|했고|하였고|했지만)\s*\.?\s*$/g, "$1했다.")
    .replace(/([가-힣]+)(?:되었으며|되었으나|되었고|되었지만)\s*\.?\s*$/g, "$1되었다.")
    .replace(/([가-힣]+)(?:이었으며|이었으나|이었고|이었지만)\s*\.?\s*$/g, "$1이었다.")
    .replace(/([가-힣]+)(?:이라는|라는|인|이고|이며|이자|이라|이나|인데|이지만)\s*\.?\s*$/g, "$1이다.")
    .replace(/([가-힣]+)(?:하며|하고|하나|하지만)\s*\.?\s*$/g, "$1한다.")
    .replace(/([가-힣]+)(?:의|과|와|및|에서|에게|으로|로|을|를|은|는|이|가)\s*\.?\s*$/g, "$1이다.");

  // 4) 구두점 및 공백 정돈
  result = result
    .replace(/(?:,\s*)+,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/^\s*,\s*/, "")
    .replace(/\s*\.+\s*(?:\.+\s*)+/g, ".")
    .replace(/\s+/g, " ")
    .trim();

  // 5) 기초 구조 검증
  if (result.length < 20) return "";

  const openParen = (result.match(/\(/g) || []).length;
  const closeParen = (result.match(/\)/g) || []).length;
  if (openParen !== closeParen) return "";

  if (typeof UNIVERSAL_NOISE_RULES !== "undefined" && UNIVERSAL_NOISE_RULES.some((rule) => rule.test(result))) {
    return "";
  }

  // 6) 종결어미 검증 및 '이다.' 강제 치환
  const VALID_DECLARATIVE_ENDING = /(?:다|함|임|됨|음|였음|했음|있음|없음)\.?$/;

  if (!VALID_DECLARATIVE_ENDING.test(result)) {
    result = result.replace(/[^가-힣a-zA-Z0-9]+$/g, "") + "이다.";
  } else if (!/[.!?]$/.test(result)) {
    result += ".";
  }

  return result;
}

// ==========================================================
// 3. 문장 분리 & 검증기
// ==========================================================

export function splitSentences(text) {
  if (!text) return [];
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[가-힣A-Za-z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
}

function isValidSentenceStructure(sentence) {
  const trimmed = sentence.trim();
  if (trimmed.length < 20) return false;

  const openParen = (trimmed.match(/\(/g) || []).length;
  const closeParen = (trimmed.match(/\)/g) || []).length;
  if (openParen !== closeParen) return false;

  return true;
}

function isOtherSubject(sentence, docTitle) {
  if (!docTitle) return false;

  // 1. 문장 맨 앞(문두)에 등장하는 첫 주어만 추출
  // 2. (?<!다)가 : '다' 바로 뒤의 '가'는 100% 연결어미(~다가)이므로 주격조사에서 제외
  const firstSubjectMatch = sentence.trim().match(/^[가-힣]{2,4}(?:은|는|이|(?<!다)가)\b/);
  if (!firstSubjectMatch) return false;

  const subject = firstSubjectMatch[0].replace(/(?:은|는|이|가)$/, "");
  const ALLOWED_PRONOUNS = ["그", "그는", "그의", "이들은", "왕은", "황제는", "아버지는", "모친은", "조부는", "스승은"];

  // 추출된 문두 주어가 대명사도 아니고 문서 제목(주인공)도 아닐 때만 타인 주어로 판정
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
// 4. TF-IDF & 코사인 유사도 연산 알고리즘
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
// 5. 메인 요약 및 설명 생성 로직
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

  // 1) 텍스트 기초 정제 후 문장 단위로 분리
  const rawIntroSentences = splitSentences(cleanWikiText(introText));
  const rawBodySentences = splitSentences(cleanWikiText(bodyText));

  // 2) 문장 개별 단위로 stripMetainfo 정제 적용 (통파기 방지)
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

  if (candidateSentences.length > 20) {
    candidateSentences = candidateSentences.slice(0, 20);
  }

  // --- TF-IDF 벡터 연산 준비 ---
  const allSentences = [...anchorSentences, ...candidateSentences];
  if (allSentences.length === 0) return "";

  const sentenceTokensList = allSentences.map((s) => tokenize(s));
  const idfDict = computeIDF(sentenceTokensList);

  const docTokens = allSentences.flatMap((s) => tokenize(s));
  const docTF = computeTF(docTokens);
  const docVector = computeTFIDF(docTF, idfDict);

  // --- 후보 문장 스코어링 ---
  const finalCandidates = candidateSentences.map((sentence, index) => {
    if (!isValidSentenceStructure(sentence) || isOtherSubject(sentence, docTitle)) {
      return { sentence, score: 0, index };
    }

    const tokens = tokenize(sentence);
    const sentenceTF = computeTF(tokens);
    const sentenceVector = computeTFIDF(sentenceTF, idfDict);
    const similarityScore = cosineSimilarity(sentenceVector, docVector);

    let score = similarityScore * (1.0 / (1 + index * 0.05));
    if (ACHIEVEMENT_VERB_REGEX.test(sentence)) {
      score *= 1.5;
    }
    if (ACADEMIC_CONCEPT_REGEX.test(sentence)) {
      score *= 1.4;
    }
    if (MAJOR_HISTORICAL_EVENT_REGEX.test(sentence)) {
      score *= 1.4;
    }

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
