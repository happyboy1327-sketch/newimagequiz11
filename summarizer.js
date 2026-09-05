// summarizer.js
const cache = {};

// ==========================================================
// 1. 위키 텍스트 전처리 정제 함수 (cleanWikiText)
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

// ==========================================================
// 2. 메타 정보 및 메타 라벨 안전 정제 함수 (stripMetainfo) -- 현재 문제 있음 고도로 수정할것,
// ==========================================================
export function stripMetainfo(text) {
  if (!text) return "";
  let result = text;

  result = result.replace(/(?<![가-힣])(본관|시호|아호|별호|아명|법명|묘호|당호|세례명|일명|호|자)\s*\([^)]+\)/g, "$1");
  result = result.replace(/\(([^()]+)\)/g, (match, inner) => {
    if (/(?:\d{3,4}년|~)/.test(inner)) return match;
    if (/(?:본관|시호|아호|별호|아명|법명|묘호|세례명|호|자|부친|모친|조부|문화어|출처)/.test(inner) || /^[\s\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff,·~-]+$/.test(inner)) {
      return "";
    }
    return match;
  });

  result = result.replace(/(?<![가-힣])(?:자\(字\)|호|본관|시호|세례명|태명|일명|아호|별호)\b.*?(?:있다|있었다|전해진다)\.?/g, "");
  result = result.replace(/,\s*(?<![가-힣])(?:자\(字\)|호|본관|시호|세례명|태명|일명|아호|별호)\s*[:=는은이]?\s*[^.!?]*[본관|시호|아호|별호|호|자|이다|였다]\.?/g, "이다.");
  result = result.replace(
  /(?<![가-힣])(?:본관|시호|아호|별호|아명|세례명|태명|일명|법명|묘호|호|자\(字\))\s*(?:[:=]\s*|(?:은|는|이|가)\s+)[^.!?\n]*?(?:이며|이고|이자)\s*/g,
  ""
);


  result = result
    .replace(/\(\s*\)/g, "")
    .replace(/\(\s*,\s*/g, "(")
    .replace(/(?:,\s*)+,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/(?:\.\s*){2,}/g, ".")
    .replace(/\s+\./g, ".")
    .replace(/^\s*\.\s*/, "")
    .replace(/([가-힣]+)(?:으로|며|이고|이자|이며)(?:이다)?\s*\./g, "$1이다.")
    .replace(/\s+/g, " ")
    .trim();
  
  const words = result.match(/[가-힣a-zA-Z0-9]{2,}/g) || [];
  if (words.length <= 2) return "";

  return result;
}

// ==========================================================
// 3. 범용 핵심어 & 노이즈 사전
// ==========================================================
const CORE_SIGNIFICANCE_KEYWORDS = [
  "원리", "구조", "기능", "작용", "현상", "이론", "연구", "발견", "규명", "증명", "설명", 
  "분석", "기반", "시스템", "메커니즘", "특징", "성질", "분류", "상태", "상호작용", "개척",
  "제도", "정책", "사회", "경제", "체계", "관계", "변화", "전개", "성장", "효과", 
  "원인", "결과", "분포", "개혁", "조약", "협정", "시장", "구조적", "통일", "통합", "정합", 
  "양식", "사상", "문화", "작품", "기법", "전통", "유형", "형성", "창작", "유산", "완화", 
  "대표", "영향", "의의", "기여", "발전", "역사", "중심", "주요", "핵심", "주요한",
  "지정", "설립", "주도", "구성", "기록", "도입", "확립", "공격", "격퇴", "정벌", "함락",
  "독립운동", "의병", "하얼빈", "저격", "사살", "의거", "단지동맹", "동양평화론",
  "국채보상운동", "삼흥학교", "구국", "대한의군", "뤼순", "유묵", "참모중장"
];

const UNIVERSAL_NOISE_KEYWORDS = [
  "자세한 내용은", "참조하십시오", "출처 필요", "각주", "외부 링크", "참고 문헌", "경력", "위키미디어 공용에", 
  "여담", "기타", "대중 문화", "서브컬처", "패러디", "밈", "스포일러", "오류",
  "차이를 보이고", "별명", "소문", "야사", "미디어에서", "여담으로", "설이 있다", "추측", "미디어 분류가 있습니다."
];

const MAJOR_HISTORICAL_EVENT_REGEX = /(?:[가-힣]{2,3}[란난]|해전|대첩|승첩|전투|의거|혁명)/;
const ACADEMIC_CONCEPT_REGEX = /[가-힣]{2,}(?:설|론|주의)\b/;
const ACHIEVEMENT_VERB_REGEX = /(?:저술|집필|설계|고안|집대성|제시|편찬|주창|발명|창안|개혁|건축|축조|간행|통찰|창작|창시|정리|도입|확립|반영|기여|주도|설립|격퇴|정벌|연구|지휘|승리|격파|격침|건조|수호|통제|구원|평정|혁신|창설|발견|노벨상)/;
const PASSIVE_BG_REGEX = /(?:(?:지점|시대|무렵|해|곳)이다|위치해\s*있다|일이\s*벌어졌다|상황이었다|태어났다|결혼했다|결혼하였다)/;
const TMI_NOISE_REGEX = /(?:부친|모친|조부|증조부|고조부|외가|오대손녀|첫\s*부인|둘째\s*부인|가계도|손자|처남|장인|결혼|이혼|혼인|재혼|파혼|배우자|남편|아내|며느리|사위|처가|딸|아들|시댁|장남|차남|장녀|차녀|외아들|외딸|\d남|\d녀|가정교사|야학|위인전|그림위인전기|계몽사|출판사|소설가|에\s*따르면|에\s*의하면|족보|족보소|\d+대조|입향시조|후사|종친|문중|항렬)/;
const DEMONSTRATIVE_REF_REGEX = /^(?:이들|그들)(?:은|는|이|가)?|^(?:이|그|해당)\s*(?:작품|빌딩|건축물|그림|조각|서적|책|소설|시|음악|곡|연구|이론|분야|문화재|유물|병|질병|질환|사건|전쟁|조약|운동|개혁|현상|사람|인물|학자|원원|멤버|단체|조직|부대)(?:은|는|이|가|으로|에서|에)?/;
const HERITAGE_ORBOOK_DESIGNATION_REGEX = /(?:(?:보물|국보|사적|천연기념물|유형문화재)\s*(?:제?\d+호)?\s*(?:로|에)\s*(?:지정|등록)|(?:책|저서|작품)\s*(?:을|를|으로|로|에)?\s*(?:저술|집필|간행|출판|발간|남김|대표|지정|등록))/;

// 🔴 [미선언 변수 추가] 관직 나열 감지 정규식
const RANK_LISTING_REGEX = /(?:종\d품|정\d품|권관|봉사|만호|참군|주부|현감|절도사|통제사).*(?:거쳐|이르렀다)/;

// 🔴 [비-전역 정규식 생성] lastIndex 오염 방지용
const CORE_SIGNIFICANCE_TEST_REGEX = new RegExp(CORE_SIGNIFICANCE_KEYWORDS.join("|"));

function isSubjectMissing(sentence) {
  const hasSubjectPattern = /^[가-힣A-Za-z0-9\s]{1,15}(?:은|는|이|가)\b/;
  return !hasSubjectPattern.test(sentence.trim());
}

export function restoreMissingSubject(sentence, currentSectionTitle = "") {
  // 🔴 [변수명 수정] HERITAGE_DESIGNATION_REGEX -> HERITAGE_ORBOOK_DESIGNATION_REGEX
  if (HERITAGE_ORBOOK_DESIGNATION_REGEX.test(sentence) && isSubjectMissing(sentence)) {
    if (currentSectionTitle && currentSectionTitle !== "개요" && currentSectionTitle !== "역사") {
      return `${currentSectionTitle}는 ${sentence}`;
    }
  }
  return sentence;
}

// ==========================================================
// 4. 헬퍼 함수
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
  // 🔴 [수정] 문장 맨 앞뿐만 아니라 중간(주어 뒤 등)에 나오는 지시어까지 폭넓게 탐지
  const demoMatch = sentence.match(/(?:^|[,\s])((?:이|그)\s+(?:작품|빌딩|건축물|그림|조각|서적|책|소설|시|음악|곡|연구|이론|문화재|유물)(?:은|는|을|를|이|가)?)/);
  if (!demoMatch) return sentence;

  const targetPhrase = demoMatch[1]; // 예: "이 작품을"

  // 바로 앞 문장들을 거슬러 올라가며 《...》 형태의 작품명/유물명 탐색
  for (let i = originalIndex - 1; i >= Math.max(0, originalIndex - 3); i--) {
    const prevSentence = allSentences[i];
    if (!prevSentence) continue;

    const titleMatch = prevSentence.match(/[《「"'][^《》「」"']+[》」"']/);
    if (titleMatch) {
      // "이 작품을" -> "《피에타》를" 형태로 안전하게 교체
      const replacedPhrase = targetPhrase.replace(/(?:이|그)\s+(?:작품|빌딩|건축물|그림|조각|서적|책|소설|시|음악|곡|연구|이론|문화재|유물)/, titleMatch[0]);
      return sentence.replace(targetPhrase, replacedPhrase);
    }

    const specificNounMatch = prevSentence.match(/([가-힣]{2,}(?:상|탑|비|관|전|국|서|집))/);
    if (specificNounMatch) {
      const replacedPhrase = targetPhrase.replace(/(?:이|그)\s+(?:작품|빌딩|건축물|그림|조각|서적|책|소설|시|음악|곡|연구|이론|문화재|유물)/, specificNounMatch[1]);
      return sentence.replace(targetPhrase, replacedPhrase);
    }
  }

  return sentence;
}

// ==========================================================
// 5. 주제어 분석, TextRank 및 Centroid 유사도 알고리즘
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

function calculateCentroidSimilarity(sentences) {
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

  const centroidVector = {};
  sentenceVectors.forEach((vec) => {
    for (const [token, val] of Object.entries(vec)) {
      centroidVector[token] = (centroidVector[token] || 0) + val / N;
    }
  });

  let centroidNorm = 0;
  for (const val of Object.values(centroidVector)) {
    centroidNorm += val * val;
  }
  centroidNorm = Math.sqrt(centroidNorm);

  if (centroidNorm === 0) return new Array(N).fill(0);

  return sentenceVectors.map((vec) => {
    let dotProduct = 0;
    let vecNorm = 0;

    for (const [token, val] of Object.entries(vec)) {
      vecNorm += val * val;
      if (centroidVector[token]) {
        dotProduct += val * centroidVector[token];
      }
    }
    vecNorm = Math.sqrt(vecNorm);

    if (vecNorm === 0) return 0;
    return dotProduct / (vecNorm * centroidNorm);
  });
}

// ==========================================================
// 6. 완벽 문장 조립
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

// ==========================================================
// 7. 메인 요약 함수: buildDescription
// ==========================================================
export function buildDescription(
  introText = "",
  bodyText = "",
  aliases = [],
  extraCount = 4,
  anchorCount = 3,
  maxLength = 630,
  sectionTitle = ""
) {
  // 🔴 [캐시 키 보완] 설정 파라미터까지 키에 포함
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
  let rawCandidatesWithMeta = []; // 🔴 [절대 위치 보존] 객체 배열 구조

  if (introSentences.length > 0) {
    const firstSentence = introSentences[0];
    const restIntro = introSentences.slice(1);

    const priorityIntro = restIntro.filter(s => 
      !RANK_LISTING_REGEX.test(s) || MAJOR_HISTORICAL_EVENT_REGEX.test(s)
    );
    const lowPriorityIntro = restIntro.filter(s => !priorityIntro.includes(s));
    const sortedIntro = [firstSentence, ...priorityIntro, ...lowPriorityIntro];

    anchorSentences = sortedIntro.slice(0, anchorCount);
    
    // 원본 전체 문장 배열(allSentences)에서의 정확한 인덱스를 함께 저장
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

  // TMI 필터링
  const cleanCandidatesWithMeta = rawCandidatesWithMeta.filter((item) => {
    if (TMI_NOISE_REGEX.test(item.sentence)) return false;
    if (UNIVERSAL_NOISE_KEYWORDS.some((kw) => item.sentence.includes(kw))) return false;
    return true;
  });

  // 스마트 step 샘플링 (절대 위치 메타 유지)
  let candidateMetaList = [];

  if (cleanCandidatesWithMeta.length > 35) {
    const isVipSentence = (s) => 
      ACHIEVEMENT_VERB_REGEX.test(s) ||
      CORE_SIGNIFICANCE_TEST_REGEX.test(s) || // 🔴 수정된 테스트용 정규식 사용
      MAJOR_HISTORICAL_EVENT_REGEX.test(s) ||
      /[《「"'][^《》「」"']+[》」"']/.test(s) ||
      /(?:노벨상|훈장|의거|독립운동|저격|창설|창시|발견|저술|선언|혁명)/.test(s);

    const vipItems = [];
    const normalItems = [];

    cleanCandidatesWithMeta.forEach((item) => {
      if (isVipSentence(item.sentence)) {
        vipItems.push(item);
      } else {
        normalItems.push(item);
      }
    });

    const targetNormalCount = Math.max(10, 35 - vipItems.length);
    const step = Math.max(1, Math.floor(normalItems.length / targetNormalCount));
    const sampledNormals = [];

    for (let i = 0; i < normalItems.length; i += step) {
      sampledNormals.push(normalItems[i]);
    }

    const candidateSet = new Set([...vipItems, ...sampledNormals]);
    candidateMetaList = cleanCandidatesWithMeta.filter((item) => candidateSet.has(item));
  } else {
    candidateMetaList = cleanCandidatesWithMeta;
  }

  if (candidateMetaList.length === 0) {
    candidateMetaList = rawCandidatesWithMeta.slice(0, 18);
  }

  const candidateSentences = candidateMetaList.map((item) => item.sentence);

  // 주제어 및 알고리즘 계산
  const topKeywords = getTopDocumentKeywords([...anchorSentences, ...candidateSentences], 10);
  const matrix = buildSimilarityMatrix(candidateSentences);
  const baseScores = pageRank(matrix);
  const vectorScores = calculateCentroidSimilarity(candidateSentences);
  const maxBaseScore = Math.max(...baseScores, 0.001);

  // 가중치 산정 및 지시어 해독
  const finalCandidates = candidateMetaList.map((item, index) => {
    const sentence = item.sentence;
    let score = baseScores[index] / maxBaseScore;

    const vectorSim = vectorScores[index] || 0;
    score *= (1 + vectorSim * 0.8);

    const demoMatch = sentence.match(DEMONSTRATIVE_REF_REGEX);
    if (demoMatch) {
      const refNoun = demoMatch[1] || demoMatch[0];
      const isPluralHuman = /^(?:이들|그들|사람|인물|회원|멤버)/.test(refNoun);
      
      const hasAnchorContext = 
        anchorContextText.includes(refNoun) ||
        (refNoun === "병" && /(?:열병|질병|질환|병환|감염)/.test(anchorContextText)) ||
        (refNoun === "사건" && /(?:의거|저격|참사|소요|사태)/.test(anchorContextText)) ||
        (isPluralHuman && /(?:들|단|회|파|군|당|협회|연맹|조직|동지|일행|가족|제자)/.test(anchorContextText));

      if (!hasAnchorContext) {
        score *= 0.1;
      }
    }

    if (/(?:[인과의는은를을에서로으로임함중]\s*\.?$|[A-Z]\.\s*$)/i.test(sentence.trim())) {
      return { sentence, score: 0, index };
    }

    const positionFactor = 1.0 / (1 + index * 0.01);
    score *= positionFactor;

    const tokens = tokenize(sentence);
    let matchCount = 0;
    for (const token of tokens) {
      if (topKeywords.includes(token)) matchCount++;
    }
    score *= (1 + Math.min(matchCount, 3) * 0.15);

    if (ACHIEVEMENT_VERB_REGEX.test(sentence)) {
      score *= 1.8;
    }

    const keywordMatches = sentence.match(new RegExp(CORE_SIGNIFICANCE_KEYWORDS.join("|"), "g"));
    if (keywordMatches) {
      score += keywordMatches.length * 0.2;
    }

    if (ACADEMIC_CONCEPT_REGEX.test(sentence)) {
      score += 0.3;
    }

    if (PASSIVE_BG_REGEX.test(sentence)) {
      score *= 0.4;
    }

    if (TMI_NOISE_REGEX.test(sentence)) {
      score *= 0.05;
    }

    if (UNIVERSAL_NOISE_KEYWORDS.some(keyword => sentence.includes(keyword))) {
      score *= 0.05;
    }

    if (HERITAGE_ORBOOK_DESIGNATION_REGEX.test(sentence)) {
      const hasLocalSubject = /^[가-힣A-Za-z0-9\s]{1,15}(?:은|는|이|가)\b/.test(sentence);
      if (!hasLocalSubject && !sectionTitle) {
        score *= 0.6; 
      } else {
        score *= 1.2; 
      }
    }

    if (/^(?:또한|이후|한편|그뒤|그후|그리고|그러나|하지만)\s*/.test(sentence)) {
      score *= 0.7;
    }

    if (sentence.length > 130 || sentence.length < 15) {
      score *= 0.7;
    }

    // 🔴 [정확한 위치 기반 대명사 해독]
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
  // 1. 함수가 호출되었는지, text가 뭔지 맨 먼저 확인
  console.log("========== summarizeText 시작 ==========");
  console.log("들어온 text 값:", text);

  // text가 비어있으면 여기서 종료됨
  if (!text) {
    console.log("❌ text가 비어있어(null/undefined/빈문자열) 조기 종료됨");
    return { summary: "", sentenceCount: 0, usedSentences: 0 };
  }

  const cleanedText = stripMetainfo(cleanWikiText(text));
  console.log("A 원본:", text);
  console.log("B cleanWikiText:", cleanWikiText(text));
  console.log("C stripMetainfo:", cleanedText);
  
  const totalSentences = splitSentences(cleanedText).length;

  const anchorCount = Math.min(3, topN);
  const extraCount = Math.max(0, topN - anchorCount);

  const summary = buildDescription(text, "", [], extraCount, anchorCount);
  
  console.log("D buildDescription:", summary);
  console.log("E 최종 splitSentences:", splitSentences(summary));

  const actualUsedSentences = splitSentences(summary).length;

  console.log("===================================");

  return {
    summary,
    sentenceCount: totalSentences,
    usedSentences: actualUsedSentences,
  };
}
