// summarizer.js

const cache = Object.create(null);

// ==========================================================
// 1. 범용 노이즈 / 중요도 규칙
// ==========================================================

const UNIVERSAL_NOISE_RULES = [
  /(?:필명|아호|별호|아명|태명|세례명|법명|묘호)\s*(?:은|는|이|가|으로|로)?\s*[^.!?]{0,80}(?:이다|있다|있었다|전해진다)/,
  /(?:검열을 피하기|지면을 채우기|지면을 채워|자세한 내용은|참조하십시오|출처 필요|보완 필요)/,
  /(?:추측해 본다|추측된다|명확히 기술되지|알 수 없다|여담으로|설이 있다|설도 있다)/,
  /(?:웨이백\s*머신|보관됨|문서의 출처|편집 이력)/,
  /(?:순위|잡지|월간지|주간지).{0,30}(?:차지했다|게재됐다|실렸다)/
];

const BAD_WIKI_SENTENCE_REGEX =
  /\d{4}-\d{1,2}-\d{1,2}|웨이백\s*머신|보관됨|\d{4}년\s*\d{1,2}월\s*\d{1,2}일자\s*기사/;

const CORE_SIGNIFICANCE_KEYWORDS = [
  "원리", "구조", "기능", "작용", "현상", "이론",
  "연구", "발견", "발명", "규명", "증명", "분석",
  "기반", "시스템", "메커니즘", "특징", "성질",
  "분류", "상태", "상호작용", "개척",
  "제도", "정책", "사회", "경제", "체계", "관계",
  "변화", "전개", "성장", "효과", "원인", "결과",
  "분포", "개혁", "조약", "협정", "시장",
  "통일", "통합", "양식", "사상", "문화", "작품",
  "기법", "전통", "유형", "형성", "창작", "유산",
  "대표", "영향", "의의", "기여", "발전", "역사",
  "중심", "주요", "핵심", "지정", "설립", "주도",
  "구성", "기록", "도입", "확립",
  "공격", "격퇴", "정벌", "함락"
];

const ACHIEVEMENT_VERB_REGEX =
  /(?:저술|집필|설계|고안|집대성|제시|편찬|주창|발명|창안|개혁|건축|축조|간행|통찰|창작|창시|정리|도입|확립|반영|기여|주도|설립|격퇴|정벌|연구|지휘|승리|격파|격침|건조|수호|통제|구원|평정|혁신|창설|발견)/;

const MAJOR_HISTORICAL_EVENT_REGEX =
  /(?:[가-힣]{2,4}(?:란|난)|해전|대첩|승첩|전투|의거|혁명|박해|정변|운동)/;

const ACADEMIC_CONCEPT_REGEX =
  /[가-힣]{2,}(?:설|론|주의|학|법)(?![가-힣])/;

const CORE_SIGNIFICANCE_REGEX =
  new RegExp(CORE_SIGNIFICANCE_KEYWORDS.join("|"), "g");


// ==========================================================
// 2. 위키 원문 정제
// ==========================================================

export function cleanWikiText(text) {
  if (!text) return "";

  let result = String(text);

  // ref / blockquote는 일반 HTML 태그 제거보다 먼저 제거해야
  // 내부 출처 문장이 살아남지 않는다.
  result = result
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<ref\b[^>]*\/>/gi, "")
    .replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, "")
    .replace(/\{\{인용문\s*\|[\s\S]*?\}\}/gi, "");

  // ruby 태그
  result = result
    .replace(/<rt[^>]*>[\s\S]*?<\/rt>/gi, "")
    .replace(/<rp[^>]*>[\s\S]*?<\/rp>/gi, "");

  // 남은 HTML 태그
  result = result.replace(/<[^>]+>/g, "");

  // 각주
  result = result
    .replace(/\[\d+\]/g, "")
    .replace(/\[(?:각주|출처\s*필요|편집|주석)\]/gi, "");

  // 기본적인 위키 링크 정리
  // [[문서명|표시명]] -> 표시명
  // [[문서명]] -> 문서명
  result = result
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1");

  // 외부 링크
  result = result.replace(
    /\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g,
    "$1"
  );

  // 숫자 목록 찌꺼기
  result = result.replace(/(?<=\s|^)\d+\)\s*/g, "");

  // 공백
  result = result
    .replace(/\s+/g, " ")
    .trim();

  return result;
}


// ==========================================================
// 3. 메타 정보 제거 + 문장 무결성 보정
// ==========================================================

export function stripMetainfo(text) {
  if (!text) return "";

  let result = String(text)
    .replace(/^[\s.,;:)>]+/, "")
    .replace(/(?<!\d)\.1운동/g, "3.1운동")
    .replace(/\s+/g, " ")
    .trim();

  // --------------------------------------------------------
  // 괄호 처리
  // 생몰년/연도 정보는 보존
  // 인물 메타정보는 제거
  // 나머지는 보존
  // --------------------------------------------------------

  result = result.replace(/\(([^()]*)\)/g, (match, inner) => {
    const value = inner.trim();

    if (/(?:\d{3,4}년|~|음력)/.test(value)) {
      return `(${value.replace(/^\s*,\s*/, "")})`;
    }

    if (
      /(?:본관|시호|아호|별호|아명|태명|세례명|일명|법명|묘호|부친|모친|조부|출처)/.test(
        value
      )
    ) {
      return "";
    }

    return match;
  });

  result = result
    .replace(/,\s*\(\s*\)/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // --------------------------------------------------------
  // 문두 메타정보
  // 너무 공격적으로 문장 전체를 삭제하지 않도록 제한
  // --------------------------------------------------------

  result = result
    .replace(
      /^(?:본관|시호|아호|별호|아명|태명|세례명|일명|법명|묘호)\s*[:=]\s*[^.!?]{1,80}[.!?]\s*/g,
      ""
    )
    .trim();

  // --------------------------------------------------------
  // 문장 끝이 명백한 연결어미로 끝나는 경우만 안전하게 보정
  //
  // 중요:
  // 일반적인 조사(은/는/을/를/이/가)를 무조건 "이다."로
  // 바꾸지 않는다.
  // --------------------------------------------------------

  result = result
    .replace(
      /(?:했으며|하였으며|했으나|하였으나|했고|하였고|했지만)\s*\.?\s*$/g,
      "했다."
    )
    .replace(
      /(?:되었으며|되었으나|되었고|되었지만)\s*\.?\s*$/g,
      "되었다."
    )
    .replace(
      /(?:이었으며|이었으나|이었고|이었지만)\s*\.?\s*$/g,
      "이었다."
    )
    .replace(
      /(?:하며|하나|하지만)\s*\.?\s*$/g,
      "한다."
    );

  // "이고", "이며", "이자" 등은 앞 명사가 명확할 때만
  // 최소한으로 처리한다.
  result = result
    .replace(
      /([가-힣]{2,})(?:이고|이며|이자)\s*\.?\s*$/g,
      "$1이다."
    )
    .replace(
      /([가-힣]{2,})(?:이라는|라는)\s*\.?\s*$/g,
      "$1이라는."
    );

  result = result
    .replace(/,\s*\./g, ".")
    .replace(/(?:\.\s*){2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim();

  // --------------------------------------------------------
  // 기본 무결성 검사
  // --------------------------------------------------------

  if (result.length < 15) return "";

  const openParen = (result.match(/\(/g) || []).length;
  const closeParen = (result.match(/\)/g) || []).length;

  if (openParen !== closeParen) return "";

  if (BAD_WIKI_SENTENCE_REGEX.test(result)) {
    return "";
  }

  if (UNIVERSAL_NOISE_RULES.some((rule) => rule.test(result))) {
    return "";
  }

  // 정상적인 종결문만 허용
  const VALID_ENDING =
    /(?:다|함|임|됨|음|였음|했음|있음|없음)[.!?]?$/;

  if (!VALID_ENDING.test(result)) {
    return "";
  }

  if (!/[.!?]$/.test(result)) {
    result += ".";
  }

  return result;
}


// ==========================================================
// 4. 문장 분리
// ==========================================================

export function splitSentences(text) {
  if (!text) return [];

  const normalized = cleanWikiText(text);

  if (!normalized) return [];

  return normalized
    .split(
      /(?<=[.!?])\s+(?=[가-힣A-Za-z0-9"'(])/
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
}


// ==========================================================
// 5. 문장 구조 검사
// ==========================================================

function isValidSentenceStructure(sentence) {
  if (!sentence) return false;

  const trimmed = sentence.trim();

  if (trimmed.length < 15) return false;

  const openParen =
    (trimmed.match(/\(/g) || []).length;

  const closeParen =
    (trimmed.match(/\)/g) || []).length;

  if (openParen !== closeParen) return false;

  if (BAD_WIKI_SENTENCE_REGEX.test(trimmed)) {
    return false;
  }

  if (UNIVERSAL_NOISE_RULES.some((rule) => rule.test(trimmed))) {
    return false;
  }

  return /(?:다|함|임|됨|음|였음|했음|있음|없음)[.!?]?$/.test(
    trimmed
  );
}


// ==========================================================
// 6. 타인 주어 판별
// ==========================================================

function normalizeName(name) {
  return String(name || "")
    .replace(/\s+/g, "")
    .replace(/[·ㆍ]/g, "")
    .trim()
    .toLowerCase();
}

function extractLeadingSubject(sentence) {
  if (!sentence) return "";

  let text = sentence.trim();

  // 시간/장소/전후 관계 부사구 제거
  text = text.replace(
    /^(?:\d{1,4}년(?:\s*\d{1,2}월(?:\s*\d{1,2}일)?)?|[가-힣]{1,12}(?:에서|에게|으로|로|부터|까지|당시|이후|이전))\s+/,
    ""
  );

  // 인물 이름 + 조사
  const match = text.match(
    /^([가-힣]{2,6})(?:은|는|이|가)(?:\s|,|$)/
  );

  return match ? match[1] : "";
}

function isOtherSubject(sentence, docTitle) {
  if (!docTitle || !sentence) return false;

  const title = normalizeName(docTitle);

  if (!title) return false;

  const subject = normalizeName(
    extractLeadingSubject(sentence)
  );

  if (!subject) return false;

  // 지칭 대명사 / 관계 주어는 허용
  const ALLOWED_SUBJECTS = new Set([
    "그",
    "그녀",
    "그들",
    "이들",
    "왕",
    "황제",
    "아버지",
    "어머니",
    "부친",
    "모친",
    "조부",
    "스승",
    "동료",
    "제자",
    "정부",
    "군",
    "군대",
    "연합군",
    "국회",
    "정부군"
  ]);

  if (ALLOWED_SUBJECTS.has(subject)) {
    return false;
  }

  // 제목과 정확히 일치
  if (subject === title) {
    return false;
  }

  // 제목에 성명이 포함되는 경우
  if (title.includes(subject) || subject.includes(title)) {
    return false;
  }

  // aliases는 이 함수 외부에서 처리하므로
  // 여기서는 명백한 다른 인물만 제외
  return true;
}


// ==========================================================
// 7. TF-IDF
// ==========================================================

function tokenize(text) {
  return (
    String(text || "")
      .toLowerCase()
      .match(/[가-힣a-zA-Z0-9]+/g) || []
  ).filter((w) => w.length >= 2);
}

function computeTF(tokens) {
  const tf = {};

  if (!tokens.length) {
    return tf;
  }

  for (const token of tokens) {
    tf[token] = (tf[token] || 0) + 1;
  }

  for (const token of Object.keys(tf)) {
    tf[token] /= tokens.length;
  }

  return tf;
}

function computeIDF(sentenceTokensList) {
  const idf = {};

  const N = sentenceTokensList.length;

  if (!N) {
    return idf;
  }

  const documentFrequency = {};

  for (const tokens of sentenceTokensList) {
    const uniqueTokens = new Set(tokens);

    for (const token of uniqueTokens) {
      documentFrequency[token] =
        (documentFrequency[token] || 0) + 1;
    }
  }

  for (const token of Object.keys(documentFrequency)) {
    idf[token] =
      Math.log(
        (N + 1) /
        (documentFrequency[token] + 1)
      ) + 1;
  }

  return idf;
}

function computeTFIDF(tf, idf) {
  const vector = {};

  for (const token of Object.keys(tf)) {
    vector[token] =
      tf[token] * (idf[token] || 0);
  }

  return vector;
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  const keys = new Set([
    ...Object.keys(vecA),
    ...Object.keys(vecB)
  ]);

  for (const key of keys) {
    const a = vecA[key] || 0;
    const b = vecB[key] || 0;

    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return (
    dot /
    (Math.sqrt(normA) * Math.sqrt(normB))
  );
}


// ==========================================================
// 8. 문장 중요도 보조 점수
// ==========================================================

function countMatches(sentence, regex) {
  const matches = sentence.match(regex);
  return matches ? matches.length : 0;
}

function aliasMatchScore(sentence, aliases) {
  if (!Array.isArray(aliases) || !aliases.length) {
    return 0;
  }

  const normalizedSentence =
    normalizeName(sentence);

  for (const alias of aliases) {
    const normalizedAlias =
      normalizeName(alias);

    if (
      normalizedAlias &&
      normalizedSentence.includes(normalizedAlias)
    ) {
      return 1;
    }
  }

  return 0;
}

function getImportanceScore(
  sentence,
  similarityScore,
  index,
  total,
  aliases,
  docTitle
) {
  let score = similarityScore * 4.0;

  // --------------------------------------------------------
  // 핵심 의미 키워드
  // 너무 강한 가중치가 되지 않도록 제한
  // --------------------------------------------------------

  const keywordCount = countMatches(
    sentence,
    CORE_SIGNIFICANCE_REGEX
  );

  score += Math.min(keywordCount, 4) * 0.7;

  // --------------------------------------------------------
  // 업적 / 활동
  // --------------------------------------------------------

  if (ACHIEVEMENT_VERB_REGEX.test(sentence)) {
    score += 2.2;
  }

  // --------------------------------------------------------
  // 주요 역사적 사건
  // --------------------------------------------------------

  if (MAJOR_HISTORICAL_EVENT_REGEX.test(sentence)) {
    score += 1.8;
  }

  // --------------------------------------------------------
  // 학술 / 사상 / 개념
  // --------------------------------------------------------

  if (ACADEMIC_CONCEPT_REGEX.test(sentence)) {
    score += 1.4;
  }

  // --------------------------------------------------------
  // 인물명 / 별칭 등장
  // --------------------------------------------------------

  if (aliasMatchScore(sentence, aliases)) {
    score += 0.8;
  }

  // 제목 자체가 문장에 등장하면 약간의 보너스
  const normalizedTitle =
    normalizeName(docTitle);

  if (
    normalizedTitle &&
    normalizeName(sentence).includes(normalizedTitle)
  ) {
    score += 0.8;
  }

  // --------------------------------------------------------
  // 문서 앞부분을 약간 우대
  // 단, 앵커처럼 강제로 선택하지는 않는다.
  // --------------------------------------------------------

  if (total > 1) {
    const positionRatio =
      index / (total - 1);

    score +=
      (1 - positionRatio) * 0.8;
  }

  // 너무 짧은 문장은 의미가 부족할 가능성이 높음
  if (sentence.length < 30) {
    score -= 0.5;
  }

  // 지나치게 긴 문장은 여러 정보를 섞었을 가능성이 있음
  if (sentence.length > 240) {
    score -= 0.35;
  }

  return Math.max(score, 0);
}


// ==========================================================
// 9. 문장 중복 / 내용 유사도
// ==========================================================

function lexicalSimilarity(sentenceA, sentenceB) {
  const a = new Set(tokenize(sentenceA));
  const b = new Set(tokenize(sentenceB));

  if (!a.size || !b.size) {
    return 0;
  }

  let intersection = 0;

  for (const token of a) {
    if (b.has(token)) {
      intersection++;
    }
  }

  const union = new Set([...a, ...b]).size;

  return union ? intersection / union : 0;
}

function isRedundantSentence(
  sentence,
  selectedSentences,
  threshold = 0.48
) {
  for (const selected of selectedSentences) {
    if (
      lexicalSimilarity(sentence, selected) >=
      threshold
    ) {
      return true;
    }
  }

  return false;
}


// ==========================================================
// 10. 메인 요약 생성 엔진
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
  const safeAliases =
    Array.isArray(aliases)
      ? aliases.filter(Boolean)
      : [];

  const safeExtraCount =
    Math.max(0, Number(extraCount) || 0);

  const safeAnchorCount =
    Math.max(0, Number(anchorCount) || 0);

  const safeMaxLength =
    Math.max(100, Number(maxLength) || 660);

  const cacheKey = [
    introText,
    bodyText,
    safeAliases.join("|"),
    safeExtraCount,
    safeAnchorCount,
    safeMaxLength,
    sectionTitle,
    docTitle
  ].join("||");

  if (cache[cacheKey]) {
    return cache[cacheKey];
  }

  // --------------------------------------------------------
  // 원문 문장 추출
  // --------------------------------------------------------

  const rawIntro =
    splitSentences(introText);

  const rawBody =
    splitSentences(bodyText);

  // --------------------------------------------------------
  // 서문
  //
  // 첫 문장도 이제 최소한의 무결성 검사를 거친다.
  // 단, 생몰년/직업/대표 활동이 들어있는 첫 문장을
  // 지나치게 공격적으로 제거하지 않는다.
  // --------------------------------------------------------

  const introSentences = rawIntro
    .map((sentence, index) => {
      if (index === 0) {
        const cleaned =
          cleanWikiText(sentence)
            .replace(/\s+/g, " ")
            .trim();

        return cleaned;
      }

      return stripMetainfo(sentence);
    })
    .filter(Boolean)
    .filter(
      (sentence) =>
        !BAD_WIKI_SENTENCE_REGEX.test(sentence)
    )
    .filter((sentence) => {
      if (sentence.length < 15) {
        return false;
      }

      return !UNIVERSAL_NOISE_RULES.some(
        (rule) => rule.test(sentence)
      );
    });

  // --------------------------------------------------------
  // 본문
  // --------------------------------------------------------

  const bodySentences = rawBody
    .map(stripMetainfo)
    .filter(Boolean)
    .filter(
      (sentence) =>
        !BAD_WIKI_SENTENCE_REGEX.test(sentence)
    )
    .filter(isValidSentenceStructure);

  // --------------------------------------------------------
  // 후보 구성
  //
  // 기존의
  // 앞 25 + 가운데 11 + 뒤 11
  // 제한을 제거한다.
  //
  // 긴 문서에서도 중요한 문장이 뒤쪽에 있으면
  // 평가 대상에서 빠지지 않게 한다.
  // --------------------------------------------------------

  let anchorSentences = [];
  let candidateSentences = [];

  if (introSentences.length > 0) {
    anchorSentences =
      introSentences.slice(
        0,
        safeAnchorCount
      );

    candidateSentences = [
      ...introSentences.slice(safeAnchorCount),
      ...bodySentences
    ];
  } else {
    anchorSentences =
      bodySentences.slice(
        0,
        safeAnchorCount
      );

    candidateSentences =
      bodySentences.slice(safeAnchorCount);
  }

  // 전체 문장 중복 제거
  const seen = new Set();

  candidateSentences =
    candidateSentences.filter((sentence) => {
      const key = sentence
        .replace(/\s+/g, " ")
        .trim();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });

  if (
    anchorSentences.length === 0 &&
    candidateSentences.length === 0
  ) {
    return "";
  }

  // --------------------------------------------------------
  // TF-IDF
  //
  // 후보 문장 자체를 포함한 전체 문장 집합으로
  // 중심 벡터를 만든다.
  // --------------------------------------------------------

  const allSentences = [
    ...anchorSentences,
    ...candidateSentences
  ];

  const tokenLists =
    allSentences.map(tokenize);

  const idf =
    computeIDF(tokenLists);

  const documentTokens =
    allSentences.flatMap(tokenize);

  const documentTF =
    computeTF(documentTokens);

  const documentVector =
    computeTFIDF(
      documentTF,
      idf
    );

  // --------------------------------------------------------
  // 후보 점수 계산
  // --------------------------------------------------------

  const scoredCandidates =
    candidateSentences.map(
      (sentence, index) => {
        // 타인 주어 판별
        if (
          docTitle &&
          isOtherSubject(
            sentence,
            docTitle
          )
        ) {
          return {
            sentence,
            score: 0,
            index,
            rejected: true
          };
        }

        const tokens =
          tokenize(sentence);

        if (!tokens.length) {
          return {
            sentence,
            score: 0,
            index,
            rejected: true
          };
        }

        const tf =
          computeTF(tokens);

        const vector =
          computeTFIDF(
            tf,
            idf
          );

        const similarity =
          cosineSimilarity(
            vector,
            documentVector
          );

        const score =
          getImportanceScore(
            sentence,
            similarity,
            index,
            candidateSentences.length,
            safeAliases,
            docTitle
          );

        return {
          sentence,
          score,
          index,
          rejected: false
        };
      }
    );

  // --------------------------------------------------------
  // 기본 점수 순위
  // --------------------------------------------------------

  const ranked =
    scoredCandidates
      .filter(
        (item) =>
          !item.rejected &&
          item.score > 0
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );

  // --------------------------------------------------------
  // 앵커는 유지하되,
  // 추가 문장은 MMR 방식으로 선택
  //
  // 목적:
  // 높은 점수만 보고 같은 내용을 반복하는 것을 방지.
  // --------------------------------------------------------

  const selectedAdditional = [];
  const selectedForSimilarity = [
    ...anchorSentences
  ];

  const targetExtra =
    safeExtraCount;

  while (
    selectedAdditional.length <
      targetExtra &&
    ranked.length > 0
  ) {
    let best = null;
    let bestScore = -Infinity;
    let bestIndex = -1;

    for (
      let i = 0;
      i < ranked.length;
      i++
    ) {
      const candidate =
        ranked[i];

      // 이미 선택한 문장과 중복되면 제외
      if (
        selectedAdditional.some(
          (item) =>
            item.sentence ===
            candidate.sentence
        )
      ) {
        continue;
      }

      // 내용 중복도
      let maxSimilarity = 0;

      for (
        const selected
        of selectedForSimilarity
      ) {
        maxSimilarity =
          Math.max(
            maxSimilarity,
            lexicalSimilarity(
              candidate.sentence,
              selected
            )
          );
      }

      // MMR
      const mmrScore =
        candidate.score -
        maxSimilarity * 3.0;

      // 동점이면 원문 앞쪽 우선
      const tieBreaker =
        candidate.index * 0.0001;

      const finalScore =
        mmrScore - tieBreaker;

      if (
        finalScore >
        bestScore
      ) {
        bestScore = finalScore;
        best = candidate;
        bestIndex = i;
      }
    }

    if (!best) {
      break;
    }

    selectedAdditional.push(best);
    selectedForSimilarity.push(
      best.sentence
    );

    ranked.splice(
      bestIndex,
      1
    );
  }

  // --------------------------------------------------------
  // 최종 문장 순서는 원문 순서
  // --------------------------------------------------------

  const selectedExtras =
    selectedAdditional
      .sort(
        (a, b) =>
          a.index - b.index
      );

  let resultParts = [
    ...anchorSentences
  ];

  for (
    const item
    of selectedExtras
  ) {
    if (
      !resultParts.includes(
        item.sentence
      )
    ) {
      resultParts.push(
        item.sentence
      );
    }
  }

  // --------------------------------------------------------
  // maxLength에 맞춰 문장 선택
  //
  // 기존 방식은 앞 문장이 길면 이후의 좋은 문장을
  // 전부 버렸다.
  //
  // 여기서는 앵커를 우선 유지하고,
  // 추가 문장은 실제 길이에 맞춰 선택한다.
  // --------------------------------------------------------

  let finalParts = [];

  // 앵커 먼저
  for (
    const anchor
    of anchorSentences
  ) {
    const candidate =
      [...finalParts, anchor]
        .join(" ")
        .trim();

    if (
      candidate.length <=
      safeMaxLength
    ) {
      finalParts.push(anchor);
    }
  }

  // 추가 문장
  for (
    const item
    of selectedExtras
  ) {
    if (
      finalParts.includes(
        item.sentence
      )
    ) {
      continue;
    }

    const candidate =
      [...finalParts, item.sentence]
        .join(" ")
        .trim();

    if (
      candidate.length <=
      safeMaxLength
    ) {
      finalParts.push(
        item.sentence
      );
    }
  }

  // --------------------------------------------------------
  // 앵커 하나 자체가 너무 긴 경우에만 최후의 수단으로
  // 자른다.
  // --------------------------------------------------------

  if (
    finalParts.length === 0 &&
    anchorSentences.length > 0
  ) {
    finalParts = [
      anchorSentences[0]
        .slice(0, safeMaxLength)
        .trim()
    ];
  }

  const result =
    finalParts
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

  cache[cacheKey] = result;

  return result;
}


// ==========================================================
// 11. 간단한 summarizeText API
// ==========================================================

export function summarizeText(
  text,
  topN = 3,
  docTitle = ""
) {
  const safeTopN =
    Math.max(
      1,
      Number(topN) || 3
    );

  // topN이 실제 최대 문장 수가 되도록 계산
  const anchorCount =
    Math.min(
      2,
      safeTopN
    );

  const extraCount =
    Math.max(
      0,
      safeTopN -
        anchorCount
    );

  const summary =
    buildDescription(
      text,
      "",
      [],
      extraCount,
      anchorCount,
      660,
      "",
      docTitle
    );

  const actualSentenceCount =
    splitSentences(summary).length;

  return {
    summary,
    sentenceCount:
      splitSentences(text).length,
    usedSentences:
      actualSentenceCount
  };
}
```
