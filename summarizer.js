// summarizer.js
// 위키 원문 정제(cleanWikiText) + 호/자 정제(stripMetainfo) + 서문 앵커(Anchor) 고정 요약 모듈
const cache = {};
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
// 2. 메타 정보 및 메타 라벨 안전 정제 함수 (stripMetainfo)
// =========================================================  

export function stripMetainfo(text) {
  if (!text) return "";
  let result = text;

  // 0) 라벨 뒤 한자 괄호 정제: 자(字) -> 자, 호(號) -> 호
  result = result.replace(/(?<![가-힣])(본관|시호|아호|별호|아명|법명|묘호|당호|세례명|일명|호|자)\s*\([^)]+\)/g, "$1");

  // 1) 괄호 안 메타 정보 정제
  result = result.replace(/\(([^()]+)\)/g, (match, inner) => {
    // 👈 [핵심 수정] 생몰년/연도가 들어있는 괄호는 한자까지 포함해서 '원형 그대로(match)' 보존!
    if (/(?:\d{3,4}년|~)/.test(inner)) return match; 
    
    // 연도가 없고 순수 한자나 자/호/본관 메타 정보만 있는 괄호는 통째 삭제
    if (/(?:본관|시호|아호|별호|아명|법명|묘호|호|자|부친|모친|조부|문화어|출처)/.test(inner) || /^[\s\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff,·~-]+$/.test(inner)) {
      return "";
    }
    return match;
  });

  // 2) 자/호/본관 메타 문장/절 정밀 제거
  // 2-1) 독립 메타 문장 통삭제
  result = result.replace(/(?<![가-힣])(?:자|호|본관|시호|아호|별호)\b.*?(?:있다|있었다|전해진다)\.?/g, "");

  // 2-2) 문장 뒤 쉼표(,) 뒤 메타 절 삭제 및 마감 ("...정치인으로, 자는 연하..." -> "...정치인이다.")
  result = result.replace(/,\s*(?<![가-힣])(?:자|호|본관|시호|아호|별호)\s*[:=는은이]?\s*[^.!?]*[본관|시호|아호|별호|호|자|이다|였다]\.?/g, "이다.");

  // 2-3) 단독 메타 구문 제거
  result = result.replace(/(?<![가-힣])(?:본관|시호|아호|별호|아명|법명|묘호|호|자)\s*[:=는은이]\s*[^,;.\n]+/g, "");

  // 3) 잔여 구두점 찌꺼기 정리 및 문장 보정
  result = result
    .replace(/\(\s*\)/g, "")               // 빈 괄호 제거
    .replace(/\(\s*,\s*/g, "(")            // (, 1908년...) 형태 오작동 방지
    .replace(/(?:,\s*)+,/g, ",")          // 다중 쉼표 정돈
    .replace(/,\s*\./g, ".")               // 쉼표+마침표 정돈
    .replace(/^\s*,\s*/, "")               // 문두 쉼표 제거
    .replace(/([가-힣]+)(?:으로|며|이고|이자|이며)\s*\./g, "$1이다.") // 어미 보정
    .replace(/\s+/g, " ")                  // 중복 공백 정돈
    .trim();

  // 4) 불완전 문장 검증
  const words = result.match(/[가-힣a-zA-Z0-9]{2,}/g) || [];
  if (words.length <= 2) return "";

  return result;
}


// ==========================================================
// 3. 범용 핵심어 & 노이즈 사전 (단어 기반 관리)
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
  "자세한 내용은", "참조하십시오", "출처 필요", "각주", "외부 링크", "참고 문헌", "경력", 
  "여담", "기타", "대중 문화", "서브컬처", "패러디", "밈", "스포일러", "오류",
  "차이를 보이고", "별명", "소문", "야사", "미디어에서", "여담으로", "설이 있다", "추측"
];

const ACADEMIC_CONCEPT_REGEX = /[가-힣]{2,}(?:설|론|주의)\b/;

// 분야별 업적 동사 가산 정규식
const ACHIEVEMENT_VERB_REGEX = /(?:저술|집필|설계|고안|집대성|제시|편찬|주창|발명|창안|개혁|건축|축조|간행|통찰|창작|창시|정리|도입|확립|반영|기여|주도|설립|격퇴|정벌|연구|지휘|승리|격파|격침|건조|수호|통제|구원|평정|혁신|창설|발견|노벨상)/;

// 수동적 배경/지형 서술 패턴 (감점 대상)
const PASSIVE_BG_REGEX = /(?:(?:지점|시대|무렵|해|곳)이다|위치해\s*있다|일이\s*벌어졌다|상황이었다|태어났다)/;

// TMI 노이즈 패턴 (가족, 출생 순서, 혼인, 위인전 일화 소스 통합 감점)
const TMI_NOISE_REGEX = /(?:부친|모친|조부|증조부|고조부|외가|오대손녀|첫\s*부인|둘째\s*부인|가계도|손자|처남|장인|결혼|이혼|혼인|재혼|파혼|배우자|남편|아내|며느리|사위|처가|시댁|장남|차남|장녀|차녀|외아들|외딸|\d남|\d녀|가정교사|야학|위인전|그림위인전기|계몽사|출판사|소설가|에\s*따르면|에\s*의하면)/;

// ==========================================================
// Cultural Heritage Context Patch
// ==========================================================

// 문화재/지정 관련 문장 정규식
const HERITAGE_ORBOOK_DESIGNATION_REGEX = /(?:(?:보물|국보|사적|천연기념물|유형문화재)\s*(?:제?\d+호)?\s*(?:로|에)\s*(?:지정|등록)|(?:책|저서|작품)\s*(?:을|를|으로|로|에)?\s*(?:저술|집필|간행|출판|발간|남김|대표|지정|등록))/;
/**
 * 문장에 명확한 주어가 빠져있는지 확인 (단락/소제목 보완 필요 여부)
 */
function isSubjectMissing(sentence) {
  // 문장 시작부에 명사+조사(이/가/은/는) 형태의 주어가 존재하는지 검사
  const hasSubjectPattern = /^[가-힣A-Za-z0-9\s]{1,15}(?:은|는|이|가)\b/;
  return !hasSubjectPattern.test(sentence.trim());
}

/**
 * 요약문 추출 후 주어가 빠진 문화재 문장에 소제목/맥락 주어를 보강해주는 함수
 */
export function restoreMissingSubject(sentence, currentSectionTitle = "") {
  if (HERITAGE_DESIGNATION_REGEX.test(sentence) && isSubjectMissing(sentence)) {
    // 소제목(예: "앙부일구")이 존재하는 경우 문두에 맥락 주어 추가
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

function resolveAnaphora(sentence, allSentences, originalIndex) {
  // "이 작품은", "그 조각은" 등으로 시작하는지 검사
  const demoMatch = sentence.match(/^(?:이|그)\s+(작품|빌딩|건축물|그림|조각|서적|책|소설|시|음악|곡|연구|이론|문화재|유물)(?:은|는|이|가)?/);
  if (!demoMatch) return sentence;

  // 바로 앞 문장들(최대 3개 이전까지)을 거슬러 올라가며 고유명사/제목 탐색
  for (let i = originalIndex - 1; i >= Math.max(0, originalIndex - 3); i--) {
    const prevSentence = allSentences[i];
    if (!prevSentence) continue;

    // 1) 《...》, 「...」 형태의 작품명/유물명 탐색
    const titleMatch = prevSentence.match(/[《「"'][^《》「」"']+[》」"']/);
    if (titleMatch) {
      return sentence.replace(/^(?:이|그)\s+(?:작품|빌딩|건축물|그림|조각|서적|책|소설|시|음악|곡|연구|이론|문화재|유물)(?:은|는|이|가)?/, `${titleMatch[0]}은`);
    }

    // 2) 문장 내 명시된 구체적 명칭(예: 피에타상, 다비드 등) 탐색
    const specificNounMatch = prevSentence.match(/([가-힣]{2,}(?:상|탑|비|관|전|국|서|집))/);
    if (specificNounMatch) {
      return sentence.replace(/^(?:이|그)\s+(?:작품|빌딩|건축물|그림|조각|서적|책|소설|시|음악|곡|연구|이론|문화재|유물)(?:은|는|이|가)?/, `${specificNounMatch[1]}은`);
    }
  }

  return sentence;
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

    // 사전용 정규식 (성능 향상을 위해 전역 1회 생성)
const CORE_SIGNIFICANCE_REGEX = new RegExp(CORE_SIGNIFICANCE_KEYWORDS.join("|"), "g");

export function buildDescription(
  introText = "",
  bodyText = "",
  aliases = [],
  extraCount = 3,
  anchorCount = 3,
  maxLength = 630,
  sectionTitle = "" // 👈 [수정 1] sectionTitle 매개변수 추가 (ReferenceError 방지)
) {
  const cacheKey = introText + bodyText;
  if (cache[cacheKey]) return cache[cacheKey];

  // 1) cleanWikiText -> stripMetainfo 파이프라인
  const rawCleanIntro = cleanWikiText(introText);
  const rawCleanBody = cleanWikiText(bodyText);

  const cleanIntro = stripMetainfo(rawCleanIntro);
  const cleanBody = stripMetainfo(rawCleanBody);

  const introSentences = splitSentences(cleanIntro);
  const bodySentences = splitSentences(cleanBody);
  const allSentences = [...introSentences, ...bodySentences];
  
  if (introSentences.length === 0 && bodySentences.length === 0) return "";

  // 2) 앵커 문장 및 후보 분석 문장 분리
  let anchorSentences = [];
  let candidateSentences = [];

  if (introSentences.length > 0) {
    anchorSentences = introSentences.slice(0, anchorCount);
    candidateSentences = [...introSentences.slice(anchorCount), ...bodySentences];
  } else {
    anchorSentences = bodySentences.slice(0, anchorCount);
    candidateSentences = bodySentences.slice(anchorCount);
  }

  // 👈 [수정 2] 후보 문장을 상위 20개로 제한하여 PageRank 연산 속도 30배 이상 향상
  if (candidateSentences.length > 20) {
    candidateSentences = candidateSentences.slice(0, 20);
  }

  if (candidateSentences.length === 0) {
    const defaultResult = assembleCompleteSentences(anchorSentences, [], maxLength);
    return (cache[cacheKey] = defaultResult);
  }

  // 3) 주제어 추출 및 TextRank 계산
  const topKeywords = getTopDocumentKeywords([...anchorSentences, ...candidateSentences], 10);
  const matrix = buildSimilarityMatrix(candidateSentences);
  const baseScores = pageRank(matrix);

  const maxBaseScore = Math.max(...baseScores, 0.001);

  // 4) 가중치 계산
  const finalCandidates = candidateSentences.map((sentence, index) => {
    let score = baseScores[index] / maxBaseScore;

    if (/(?:[인과의는은를을에서로으로임함중]\s*\.?$|[A-Z]\.\s*$)/i.test(sentence.trim())) {
      return { sentence, score: 0, index };
    }

    const positionFactor = 1.0 / (1 + index * 0.06);
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

    // 👈 [수정 3] filter 전수조사를 정규식 매칭으로 변경하여 연산량 절감
    const keywordMatches = sentence.match(CORE_SIGNIFICANCE_REGEX);
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

    const originalGlobalIndex = introSentences.length + anchorCount + index;
    const resolvedSentence = resolveAnaphora(sentence, allSentences, originalGlobalIndex);

    return { sentence: resolvedSentence, score, index };
  });

  // 5) 상위 후보 추출 및 문맥 정렬
  const ranked = finalCandidates
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, extraCount)
    .sort((a, b) => a.index - b.index);

  // 👈 [수정 4] result 변수 생성 로직 복구 및 캐시 저장 반환
  const result = assembleCompleteSentences(anchorSentences, ranked, maxLength);
  return (cache[cacheKey] = result);
}


export function summarizeText(text, topN = 3) {
  return {
    summary: buildDescription(text, "", [], topN - 1, 2),
    sentenceCount: splitSentences(text).length,
    usedSentences: topN,
  };
}
