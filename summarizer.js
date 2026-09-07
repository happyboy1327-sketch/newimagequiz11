// summarizer.js

const cache = {};

// ==========================================================
// 1. 범용 노이즈 규칙 Engine (Hard Guardrail)
// ==========================================================

const UNIVERSAL_NOISE_RULES = [
  /(?:며|는데|으나|하고|(?<!이)고|고|지만|면서|이며|이자)이다\.?$/,
  /(?:은|는|을|를|에|의|와|과|(?<!으)로|으로|에서)\s*이다\.?$/,
  /(?:필명|아호|별호|아명|따왔다는|설도 있|설이 있|검열을 피하기|지면을 채워|자세한 내용은|이르렀다|참조하십시오|출처 필요|차지했다|순위|잡지|지면|월간지)/,
  /(?:추측해 본다|추측된다|명확히 기술되지|알 수 없다|여담으로|설이 있다)/
];

const BAD_WIKI_SENTENCE_REGEX =
  /\d{4}-\d{1,2}-\d{1,2}|웨이백\s*머신|보관됨|\d{4}년\s*\d{1,2}월\s*\d{1,2}일자\s*기사/;

const CORE_SIGNIFICANCE_KEYWORDS = [
  "원리", "구조", "기능", "작용", "현상", "이론", "연구", "발견", "발명", "규명", "증명", 
  "분석", "기반", "시스템", "메커니즘", "특징", "성질", "분류", "상태", "상호작용", "개척",
  "제도", "정책", "사회", "경제", "체계", "관계", "변화", "전개", "성장", "효과", 
  "원인", "결과", "분포", "개혁", "조약", "협정", "시장", "구조적", "통일", "통합", "정합", 
  "양식", "사상", "문화", "작품", "기법", "전통", "유형", "형성", "창작", "유산", "완화", 
  "대표", "영향", "의의", "기여", "발전", "역사", "중심", "주요", "핵심", "주요한",
  "지정", "설립", "주도", "구성", "기록", "도입", "확립", "공격", "격퇴", "정벌", "함락"
];

const ACHIEVEMENT_VERB_REGEX = /(?:저술|집필|설계|고안|집대성|제시|편찬|주창|발명|창안|개혁|건축|축조|간행|통찰|창작|창시|정리|도입|확립|반영|기여|주도|설립|격퇴|정벌|연구|지휘|승리|격파|격침|건조|수호|통제|구원|평정|혁신|창설|발견)/;
const MAJOR_HISTORICAL_EVENT_REGEX = /(?:[가-힣]{2,3}[란난]|해전|대첩|승첩|전투|의거|혁명|박해|정변|운동)/;
const ACADEMIC_CONCEPT_REGEX = /[가-힣]{2,}(?:설|론|주의|학|법)\b/;

const CORE_SIGNIFICANCE_REGEX = new RegExp(CORE_SIGNIFICANCE_KEYWORDS.join("|"), "g");

const RE_SENTENCE_SPLIT = /(?<!\b(?:Op|No|Dr|Mr|Mrs|Ms|Prof|vs|Vol|St|Co|Inc|Ltd|etc)\.)(?<!\d\.)(?<=[.!?])\s+(?=[가-힣A-Za-z0-9"'(])/i;

// ==========================================================
// 2. 위키 원문 정제 & 문장 보정
// ==========================================================

export function cleanWikiText(text) {
  if (!text) return "";
  return text
    .replace(/<rt[^>]*>[\s\S]*?<\/rt>/gi, "")
    .replace(/<rp[^>]*>[\s\S]*?<\/rp>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\[\d+\]|\[(?:각주|출처\s*필요|편집|주석)\]/g, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<ref\b[^>]*\/>/gi, "")
    .replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, "")
    .replace(/\{\{인용문\s*\|[\s\S]*?\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


export function stripMetainfo(text) {
  if (!text) return "";
  let result = text;

  // 1) 문두 찌꺼기 부호 및 `.1운동` 표기 자동 복구
  result = result
    .replace(/^[\s,;:\)\>]+|^\.(?!\d)/, "")


  // 2) 괄호 내부 메타 정보 제거 (연도/생몰년 보존)
  result = result.replace(/\(([^()]+)\)/g, (match, inner) => {
    if (/(?:\d{3,4}년|~|음력)/.test(inner)) {
      return `(${inner.replace(/^\s*,\s*/, "").trim()})`;
    }
    if (/(?:본관|시호|아호|별호|아명|태명|세례명|일명|법명|묘호|호|자|부친|모친|조부|출처)/.test(inner)) {
      return "";
    }
    return match;
  });


  // 3) 범용 메타 서술절 제거
  result = result
    .replace(/(?<![가-힣])(?:자|호|본관|시호|아호|별호|태명|세례명|일명|아명)\b.*?(?:있다|있었다|전해진다)\.?/g, "")
    .replace(/(?<![가-힣])(?:본관|시호|아호|별호|아명|법명|태명|세례명|일명|묘호|호|자)\s*[:=는은이]\s*(?:[^,;.\n]|\.(?=\d))+?(?=이며|이고|이자|,|;|\.(?!\d)|$)/g, "")
    .replace(/^(?:이며|이고|이자)\s*/, "")
  // 4) 불완전 어미 및 단절 조사 서술어 전환
  result = result
    .replace(/([가-힣]+)(?:했으며|하였으며|했으나|하였으나|했고|하였고|했지만)\s*\.?\s*$/g, "$1했다.")
    .replace(/([가-힣]+)(?:되었으며|되었으나|되었고|되었지만)\s*\.?\s*$/g, "$1되었다.")
    .replace(/([가-힣]+)(?:이었으며|이었으나|이었고|이었지만)\s*\.?\s*$/g, "$1이었다.")
    .replace(/([가-힣]+)(?:이라는|라는|인|이고|이며|이자|이라|이나|인데|이지만)\s*\.?\s*$/g, "$1이다.")
    .replace(/([가-힣]+)(?:하며|하고|하나|하지만)\s*\.?\s*$/g, "$1한다.")
    .replace(/([가-힣]+)(?:의|과|와|및|에서|에게|으로|(?<!으)로|을|를|은|는|이|가)\s*\.?\s*$/g, "$1이다.");

  // 5) 구두점 정리
  result = result
    .replace(/(?:,\s*)+,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/^\s*,\s*/, "")
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
    // 6단계 어미 치환 체인이 커버하지 못한 미지의 축약형/연결 어미(예: 였으며, 였고 등)로
    // 끝난 경우, 억지로 "이다."를 이어붙이면 "~였으며이다."처럼 오염된 문장이 만들어진다.
    // 정상적으로 종결시킬 수 없는 문장은 이다를 붙이지 말고 그냥 폐기한다.
    return "";
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
    // 숫자 바로 뒤 마침표(3.1 등) 및 주요 영문 약어 뒤의 마침표 분할 방지
    .split(/(?<!\d)(?<!\b(?:Op|No|Dr|Mr|Mrs|Ms|Prof|vs|Vol|St|Co|Inc|Ltd|etc)\.)(?<=[.!?])\s+(?=[가-힣A-Za-z0-9"'(])/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
}

export function extractAnnotatedParagraphs(rawText) {
  if (!rawText) return [];

  const cleanedGlobalText = cleanWikiText(rawText);
  const paragraphs = cleanedGlobalText.split(/\n+|\n?==+[^=]+==+\n?/).filter(p => p.trim());
  const structuredParagraphs = [];

  for (const p of paragraphs) {
    const rawSentences = p.split(RE_SENTENCE_SPLIT).map(s => s.trim()).filter(Boolean);
    const parsedSentences = [];

    for (let raw of rawSentences) {
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

  // 1. 날짜/장소 부사구 및 문두 접속어(한편, 이후, 당시 등) 제거
  const cleaned = sentence
    .replace(/^[\d\s년월일시분초계절.,\-~가-힣]+(?:에|에서|부터|까지|에도)\s+/, "")
    .replace(/^(?:한편|이후|당시|또한|이때|그후|이어|반면|이에)\s+/, "");

  // 2. 주어 추출 (2~5자 한글 + 조사)
  const match = cleaned.match(/^([가-힣]{2,5})(?:은|는|이|가)\b/);
  if (!match) return false;

  const subject = match[1];
  
  // 허용할 대명사 및 주체(정부/조정 등 추가)
  const ALLOWED = ["그", "그는", "그의", "그녀", "이들은", "왕은", "황제는", "정부는", "조정은", "당국은"];
  if (ALLOWED.includes(subject)) return false;

  // 문서 제목과 불일치하면 타인 주어로 판정 (true 반환하여 제거)
  return !docTitle.includes(subject) && !subject.includes(docTitle.trim());
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
  maxLength = 660,
  sectionTitle = "",
  docTitle = ""
) {
  // aliases는 배열이 아닐 경우에도 안전하게 처리
  const safeAliases = Array.isArray(aliases) ? aliases : [];

  // 캐시 키에 모든 입력값 반영
  const cacheKey = [
    introText,
    bodyText,
    safeAliases.join("|"),
    extraCount,
    anchorCount,
    maxLength,
    sectionTitle,
    docTitle
  ].join("||");

  if (cache[cacheKey]) return cache[cacheKey];

  const rawIntroSentences = splitSentences(cleanWikiText(introText));
  const rawBodySentences = splitSentences(cleanWikiText(bodyText));
  const parsedIntroParagraphs = extractAnnotatedParagraphs(introText);
  const parsedBodyParagraphs = extractAnnotatedParagraphs(bodyText);

  const introSentences = rawIntroSentences
  .map((s, i) => i === 0 ? s : stripMetainfo(s))
  .filter(Boolean)
  .filter((s) => !BAD_WIKI_SENTENCE_REGEX.test(s));

  const bodySentences = rawBodySentences
    .map((s) => stripMetainfo(s))
    .filter(Boolean)
    .filter((s) => !BAD_WIKI_SENTENCE_REGEX.test(s));

  let anchorSentences = [];
  let candidateSentences = [];

  // --- 서문 앵커 문장 ---
  if (introSentences.length > 0) {
  anchorSentences = introSentences.slice(0, anchorCount);

  candidateSentences = [
    ...introSentences.slice(anchorCount),
    ...bodySentences
  ];
} else {
  anchorSentences = bodySentences.slice(0, anchorCount);
  candidateSentences = bodySentences.slice(anchorCount);
}

  const allSentences = [
  ...anchorSentences,
  ...candidateSentences
];

if (allSentences.length === 0) {
  return "";
}

  // --- TF-IDF 계산 ---
  const sentenceTokensList = allSentences.map((s) => tokenize(s));
  const idfDict = computeIDF(sentenceTokensList);

  const docTokens = allSentences.flatMap((s) => tokenize(s));
  const docTF = computeTF(docTokens);
  const docVector = computeTFIDF(docTF, idfDict);

  // --- 후보 문장 스코어링 ---
  const finalCandidates = candidateSentences.map((sentence, index) => {
    // 구조적으로 문제가 있는 문장은 제외
    const isFirstPart =
      index === 0 && anchorSentences.length < 2;

    if (!isValidSentenceStructure(sentence)) {
      return {
        sentence,
        score: 0,
        index
      };
    }

    // candidateSentences 스코어링 루프 내부

const isOther = isOtherSubject(sentence, docTitle);
const hasAchievement = ACHIEVEMENT_VERB_REGEX.test(sentence) || CORE_SIGNIFICANCE_REGEX.test(sentence);

// 문두 접속어/날짜 제거 후 주어 유무 확인
const cleaned = sentence.replace(/^(?:\d{1,4}년(?:\s*\d{1,2}월)?(?:\s*\d{1,2}일)?|당시|이후|한편|또한|이에|이때)\s*/, "");
const hasSubject = /^([가-힣]{2,5})(?:은|는|이|가)\b/.test(cleaned);

// 타인 주어이거나(isOther) OR 주어 없는데 업적만 있는 경우(!hasSubject && hasAchievement) 탈락
if (!isFirstPart && (isOther || (!hasSubject && hasAchievement))) {
  return { sentence, score: 0, index };
}

    // TF-IDF 코사인 유사도
    const tokens = tokenize(sentence);
    const sentenceTF = computeTF(tokens);
    const sentenceVector = computeTFIDF(
      sentenceTF,
      idfDict
    );

    const similarityScore = cosineSimilarity(
      sentenceVector,
      docVector
    );

    // 기본 점수 + 위치 감점
    let score =
      similarityScore *
      (1.0 / (1 + index * 0.005));
    
    const keywordMatches = sentence.match(CORE_SIGNIFICANCE_REGEX);
    if (keywordMatches) {
      score += keywordMatches.length * 0.75;
    }

    // 업적/활동 관련 문장 가산점
    if (ACHIEVEMENT_VERB_REGEX.test(sentence)) {
      score *= 1.5;
    }

    // 학술/개념 관련 문장 가산점
    if (ACADEMIC_CONCEPT_REGEX.test(sentence)) {
      score *= 1.4;
    }

    // 주요 역사적 사건 관련 문장 가산점
    if (MAJOR_HISTORICAL_EVENT_REGEX.test(sentence)) {
      score *= 1.4;
    }

    // aliases에 포함된 인물이 등장하면 약간의 가산점
    if (
      safeAliases.length > 0 &&
      safeAliases.some((alias) => {
        if (!alias) return false;

        const normalizedAlias = String(alias)
          .trim()
          .toLowerCase();

        return (
          normalizedAlias &&
          sentence.toLowerCase().includes(normalizedAlias)
        );
      })
    ) {
      score *= 1.15;
    }

    return {
      sentence,
      score,
      index
    };
  });

  // --- 상위 후보 추출 (구역 균등 분산 + 근접 중복 제거) ---
const scoredCandidates = finalCandidates.filter((item) => item.score > 0);
const totalCount = finalCandidates.length;
const count = extraCount;

const boundary1 = Math.floor(totalCount / 3);
const boundary2 = Math.floor((totalCount * 2) / 3);
const zones = [[], [], []];
scoredCandidates.forEach(item => {
    if (item.index < boundary1) zones[0].push(item);
    else if (item.index < boundary2) zones[1].push(item);
    else zones[2].push(item);
});

// 구역별 점수 내림차순 정렬 (각 구역에서 순서대로 하나씩 뽑기 위함)
zones.forEach(zone => zone.sort((a, b) => b.score - a.score));

// 문장 간 유사도(자카드 유사도)로 근접 중복 판정
function tokenizeForSim(s) {
    return new Set((s.match(/[가-힣a-zA-Z0-9]+/g) || []).filter(w => w.length >= 2));
}
function jaccardSimilarity(a, b) {
    const setA = tokenizeForSim(a);
    const setB = tokenizeForSim(b);
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const tok of setA) if (setB.has(tok)) intersection++;
    return intersection / (setA.size + setB.size - intersection);
}
function isNearDuplicate(sentence, selectedSentences, threshold = 0.25) {
    return selectedSentences.some(s => jaccardSimilarity(sentence, s) >= threshold);
}

const selected = [];
const selectedSentences = [...anchorSentences]; // 앵커 문장도 중복 검사 대상에 포함
const zonePointers = [0, 0, 0];

const zoneVisitOrder = [0, 0, 1, 1, 2];
// 구역을 순환하며 하나씩 뽑는다 (라운드 로빈) -> 자연스럽게 균등 분산
while (selected.length < count) {
    let addedThisRound = false;

    for (const z of zoneVisitOrder)  {
        if (selected.length >= count) break;

        while (zonePointers[z] < zones[z].length) {
            const candidate = zones[z][zonePointers[z]];
            zonePointers[z]++;

            if (isNearDuplicate(candidate.sentence, selectedSentences)) {
                continue; // 근접 중복이면 건너뛰고 같은 구역의 다음 후보로
            }

            selected.push(candidate);
            selectedSentences.push(candidate.sentence);
            addedThisRound = true;
            break;
        }
    }

    if (!addedThisRound) break; // 모든 구역의 후보가 소진됨
}

const ranked = selected.sort((a, b) => a.index - b.index);

  // --- 앵커 + 추가 문장 ---
  let resultParts = [...anchorSentences];

  for (const item of ranked) {
    if (!resultParts.includes(item.sentence)) {
      resultParts.push(item.sentence);
    }
  }

  // --- sectionTitle은 내용 자체에 중복 삽입하지 않고
  // 문장 선택 단계에서 사용할 수 있도록 입력값으로만 유지 ---
  // docTitle 역시 isOtherSubject() 판정에 사용됨.

  // --- 최대 글자 수 제한 ---
  let result = resultParts.join(" ").trim();

  if (result.length > maxLength) {
    let limitedParts = [];

    for (const part of resultParts) {
      const candidate = [...limitedParts, part]
        .join(" ")
        .trim();

      if (candidate.length <= maxLength) {
        limitedParts.push(part);
      } else {
        break;
      }
    }

    result = limitedParts.join(" ").trim();

    // 첫 문장 하나 자체가 maxLength를 초과하는 경우
    if (!result && resultParts.length > 0) {
      result = resultParts[0]
        .slice(0, maxLength)
        .trim();
    }
  }

  cache[cacheKey] = result;
  return result;
}


export function summarizeText(text, topN = 3, docTitle = "") {
  return {
    summary: buildDescription(text, "", [], topN - 1, 2, 660, "", docTitle),
    sentenceCount: splitSentences(text).length,
    usedSentences: topN,
  };
}
