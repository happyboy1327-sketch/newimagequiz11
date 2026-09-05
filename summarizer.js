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

const RE_QUOTE = /(['"])(.*?)\1/g;
const RE_SPACE = /\s+/g;
const RE_PAREN_META = /\([^)]*(?:부친|모친|조부|증조부|고조부|외가|장인|처남|자|호|본관|시호|아명|태명|법명)\s*:[^)]*\)/g;

// 마침표 뒤에 괄호가 붙어있거나 한자가 오는 경우 문장 분할 방지
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

    // 잘림 방지: 문장 전체가 날아가지 않도록 검증 완화
    return words.length >= 1 ? finalContent : text;
  } catch (err) {
    return text.replace(RE_SPACE, " ").trim();
  }
}  

  
// ==========================================================
// 2. 키워드 및 업적·생애 전용 표적 벡터(Target Vector) 설정
// ==========================================================
const CORE_SIGNIFICANCE_KEYWORDS = [
  "원리", "구조", "기능", "작용", "현상", "이론", "연구", "발견", "규명", "증명", "설명", "기록", "저서", 
  "분석", "기반", "시스템", "메커니즘", "특징", "성질", "분류", "상태", "상호작용", "개척", "출판", "저술", 
  "제도", "정책", "사회", "경제", "체계", "관계", "변화", "전개", "성장", "효과", "수립", "조직", 
  "원인", "결과", "분포", "개혁", "조약", "협정", "시장", "구조적", "통일", "통합", "정합", 
  "양식", "사상", "문화", "작품", "기법", "전통", "유형", "형성", "창작", "유산", "완화", 
  "대표", "영향", "의의", "기여", "발전", "역사", "중심", "주요", "핵심", "주요한", "발전", 
  "지정", "설립", "주도", "구성", "기록", "도입", "확립", "공격", "격퇴", "정벌", "함락",
  "독립운동", "의병", "하얼빈", "저격", "사살", "의거", "단지동맹", "동양평화론",
  "국채보상운동", "구국", "대한의군", "유묵", "도량형", "만리장성", "천하통일"
];

// 백터 유사도 산출 시 기준점이 되는 업적/생애 중심 표적 백터
const ACHIEVEMENT_TARGET_TOKENS = [
  "업적", "기여", "주도", "설립", "창시", "개혁", "통일", "저술", "집필", "건축", "격퇴", "창제", 
  "발견", "발명", "구국", "독립운동", "의거", "혁명", "수립", "제정", "창작", "연구", "규명",
  "단행", "확립", "창설", "지휘", "승리", "제작", "편찬", "주창", "통제", "구원", "노벨상", "승리"
];

const UNIVERSAL_NOISE_KEYWORDS = [
  "자세한 내용은", "참조하십시오", "출처 필요", "각주", "외부 링크", "참고 문헌", "경력", "위키미디어 공용에", 
  "여담", "기타", "대중 문화", "서브컬처", "패러디", "밈", "스포일러", "오류",
  "차이를 보이고", "별명", "소문", "야사", "미디어에서", "여담으로", "설이 있다", "추측", "보고 있다", "미디어 분류가 있습니다."
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
      score += keywordMatches.length * 0.42;
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
