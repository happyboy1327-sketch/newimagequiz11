const cache = {};

export function cleanWikiText(text) {
  if (!text) return "";
  return text
    .replace(/\{\{인용문\s*\|[\s\S]*?\}\}/g, "")
    .replace(/(?:^|\s*)(?:자|호|휘|시호|아명|태명)\s*(?:은|는|:)\s*[^.,\n]{1,15}(?:[.,]|\s*)/g, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<ref\b[^>]*\/>/gi, "")
    .replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<poem\b[^>]*>[\s\S]*?<\/poem>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1")
    .replace(/\[\d+\]/g, "")
    .replace(/\[(?:각주|출처\s*필요|편집|주석)\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const RE_SENTENCE_SPLIT = /(?<!\d\.)(?<!\b(?:Op|No|Dr|Mr|Mrs|Ms|Prof|vs|Vol|St|Co|Inc|Ltd|etc)\.)(?<=[.!?])\s+(?=[가-힣A-Za-z0-9"'(])/i;

//export function stripMetainfo(text) {
const RE_QUOTE = /(['"])(.*?)\1/g;
const RE_SPACE = /\s+/g;
const RE_PAREN_META = /\([^)]*(?:부친|모친|조부|증조부|고조부|외가|장인|처남|자|호|본관|시호|아명|태명|법명)\s*:[^)]*\)/g;


const RE_PURE_META = /^(?:그의|그녀의|본)?\s*(?:본관|본적|시호|아호|별호|아명|태명|세례명|법명|묘호|당호|자|호|휘)\s*(?:은|는|:)\s+.+$/;
const RE_META_CLAUSE = /(?:^|(?<=[,;]\s*))(?:본관|본적|시호|아호|별호|아명|태명|세례명|법명|묘호|당호|자|호|휘)\s*(?:은|는|:)\s+[가-힣\u4E00-\u9FFF\s(·)]+?(?:등이다|등이었다|이며|이고|이자|이었다|였다|이다|임)(?:,\s*)?/g;
const RE_FAMILY_CLAUSE = /(?:^|(?<=[,;]\s*))(?:(?:그의|그녀의)?\s*(?:부친|모친|조부|증조부|고조부|외조부|외조모|장인|처남|장남|차남|장녀|차녀|막내)|(?:(?<![가-힣]의\s*)(?:아버지|어머니)))\s*(?:은|는|이|가)\s+[가-힣\u4E00-\u9FFF]{2,5}(?:이고|이며|이자|이었다|였다|이다|임)(?:,\s*)?/g;

const RE_PUNCT_CLEAN = /,\s*,+/g;
const RE_DOT_CLEAN = /,\s*\./g;
const RE_LEADING_COMMA = /^\s*,\s*/;
const RE_EMPTY_PAREN = /\(\s*\)/g;
const RE_TAIL_VERB = /(?:으로|로|이며|이고|이자)\s*\.$/;
const RE_HEAD_VERB = /^(?:으로|로|이고|이며|이자)\s*,?\s*/;
const RE_VALID_CHAR = /[가-힣A-Za-z0-9]/;
const RE_VALID_WORDS = /[가-힣A-Za-z0-9]{2,}/g;

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

const CORE_SIGNIFICANCE_KEYWORDS = [
  "원리", "구조", "기능", "작용", "현상", "이론", "연구", "발견", "발전", "규명", "증명", "설명", "기록", "저서", 
  "분석", "기반", "시스템", "메커니즘", "특징", "성질", "분류", "상태", "상호작용", "개척", "출판", "저술", "제작", 
  "제도", "정책", "사회", "경제", "체계", "관계", "변화", "전개", "성장", "효과", "수립", "조직", "창단",  
  "원인", "결과", "분포", "개혁", "조약", "협정", "시장", "구조적", "통일", "통합", "정합", "정립", "창립", 
  "양식", "사상", "문화", "작품", "기법", "전통", "유형", "형성", "창작", "유산", "완화", "강화", "개선", 
  "대표", "영향", "의의", "기여", "발전", "역사", "중심", "주요", "핵심", "주요한", 
  "지정", "설립", "주도", "구성", "도입", "확립", "공격", "격퇴", "정벌", "함락",
  "독립운동", "의병", "하얼빈", "저격", "사살", "의거", "단지동맹", "동양평화론",
  "국채보상운동", "구국", "대한의군", "유묵", "도량형", "만리장성", "천하통일", "거중기", "실학", "상대성이론", "양자역학",
  "시인", "작가", "문단", "등단", "체포", "구금", "사상범", "유학자", "왕도정치", "성선설"
];

const UNIVERSAL_NOISE_KEYWORDS = [
  "자세한 내용은", "참조하십시오", "출처 필요", "각주", "외부 링크", "참고 문헌", "경력", "위키미디어 공용에", "전문지", "실렸다", 
  "여담", "기타", "대중 문화", "서브컬처", "패러디", "밈", "스포일러", "오류", "순위", "차지했다", 
  "차이를 보이고", "별명", "소문", "야사", "미디어에서", "여담으로", "설이 있다", "추측", "보고 있다", "미디어 분류가 있습니다."
];

const DISQUALIFIED_CONNECTORS_REGEX = /^(?:그러나|하지만|그런데|한편|이후|당시|그\s*후|그\s*뒤|그러던\s*중|이에\s*따라|그\s*당시|그\s*이후|그러고\s*나서|그때|이때|이듬해|훗날|마침내|이와\s*달리|그러다가|이로써|따라서|결과적으로|이와\s*같이)/;

const TMI_NOISE_REGEX = /(?:부친|모친|조부|조모|증조부|고조부|외가|첫\s*부인|둘째\s*부인|가계도|손자|처남|장인|결혼|이혼|혼인|재혼|배우자|남편|아내|딸|아들|처가|시댁|장남|차남|장녀|차녀|외아들|외딸|\d남|\d녀|위인전|출판사|족보|입향시조|후사|종친|문중|호적|예규|성씨|두음법칙|실질적인\s*기여|동의하지\s*않는다|목격자\s*증언|서한들|할아버지|할머니|아버지|어머니|부모|형제|자매|친척|번지)/;

const MAJOR_HISTORICAL_EVENT_REGEX = /(?:[가-힣]{2,3}[란난]|해전|대첩|승첩|전투|의거|혁명|박해)/;
const ACADEMIC_CONCEPT_REGEX = /[가-힣]{2,}(?:설|론|주의|학|법|식)\b/;
const ACHIEVEMENT_VERB_REGEX = /(?:저술|집필|설계|고안|집대성|제시|편찬|주창|발명|창안|개혁|건축|축조|간행|통찰|창작|창시|정리|도입|확립|반영|기여|주도|설립|격퇴|정벌|연구|지휘|승리|격파|격침|건조|수호|통제|구원|평정|혁신|창설|발견|노벨상|통일|단행|졸업|등단|발표|체포|주창|확립)/g;
const CORE_SIGNIFICANCE_TEST_REGEX = new RegExp(CORE_SIGNIFICANCE_KEYWORDS.join("|"));

function resolveAnaphora(sentence, allSentences, originalIndex) {
  const m = sentence.match(
    /^(이들|그들|그는|그녀는|이는|이것은|그것은|이|그|해당)\s*(작품|빌딩|건축물|그림|조각|서적|책|소설|시|음악|곡|연구|이론|문화재|유물|개혁|사건|기술)?/
  );
  if (!m) return sentence;

  const type = m[2] || "";
  const query = vectorize(sentence.replace(m[0], ""));
  const candidates = [];

  for (let i = Math.max(0, originalIndex - 8); i < originalIndex; i++) {
    const s = allSentences[i]?.cleaned || allSentences[i] || "";
    if (!s) continue;

    const names = [
      ...(s.match(/[《「"'][^《》「」"']+[》」"']/g) || []),
      ...(s.match(/[가-힣A-Za-z0-9·-]{2,20}(?=(?:은|는|이|가|을|를|의|에서))/g) || [])
    ];

    for (const name of [...new Set(names)]) {
      const entity = name.replace(/^《|》$|^「|」$|^"|"$/g, "").trim();
      if (!entity || /^(이것|그것|해당|작품|사람|경우|내용|문제|연구)$/.test(entity))
        continue;

      const sentenceScore = cosine(query, vectorize(s));
      const entityScore = cosine(query, vectorize(entity));

      // 가까운 문장일수록 높은 점수
      const distanceScore = 1 / (1 + (originalIndex - i) * 0.25);

      // "작품/건축물/연구..."와 후보의 의미적 타입 일치
      const typeScore = typeMatch(type, entity, s);

      const score =
        sentenceScore * 0.35 +
        entityScore * 0.30 +
        distanceScore * 0.20 +
        typeScore * 0.15;

      candidates.push({ entity, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < 0.18) return sentence;

  // 조사 보존
  const particle = sentence.match(
    /^(?:이들|그들|그는|그녀는|이는|이것은|그것은|이|그|해당)\s*(?:작품|빌딩|건축물|그림|조각|서적|책|소설|시|음악|곡|연구|이론|문화재|유물|개혁|사건|기술)?(은|는|이|가|을|를)?/
  )?.[1] || "";

  return sentence.replace(m[0], best.entity + particle);
}

function vectorize(text) {
  const v = {};
  const s = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, "");

  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i <= s.length - n; i++) {
      const g = s.slice(i, i + n);
      v[g] = (v[g] || 0) + 1;
    }
  }

  return v;
}

function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const k of keys) {
    const x = a[k] || 0;
    const y = b[k] || 0;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }

  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

function typeMatch(type, entity, sentence) {
  if (!type) return 0;

  const groups = {
    "작품": ["작품", "그림", "소설", "조각", "시", "곡"],
    "빌딩": ["건물", "빌딩", "관", "궁", "전"],
    "건축물": ["건물", "건축", "관", "궁", "전"],
    "그림": ["그림", "회화", "작품"],
    "조각": ["조각", "작품"],
    "책": ["책", "서적", "소설"],
    "소설": ["소설", "책", "서적"],
    "음악": ["음악", "곡", "앨범"],
    "곡": ["곡", "음악"],
    "연구": ["연구", "논문", "분석"],
    "이론": ["이론", "학설", "모델"],
    "문화재": ["문화재", "유물", "궁", "탑", "사"],
    "유물": ["유물", "문화재"]
  };

  const words = groups[type] || [];
  return words.some(w =>
    entity.includes(w) || sentence.includes(w)
  ) ? 1 : 0;
}


function isDisqualifiedSentence(sentence, isFirstIntroSentence = false, deathYear = null) {
  if (!sentence) return true;
  if (DISQUALIFIED_CONNECTORS_REGEX.test(sentence.trim())) return true;
  
  if (!isFirstIntroSentence && TMI_NOISE_REGEX.test(sentence)) return true;
  if (UNIVERSAL_NOISE_KEYWORDS.some(kw => sentence.includes(kw))) return true;

  if (deathYear) {
    const yearMatch = sentence.match(/(\d{4})년/);
    if (yearMatch && parseInt(yearMatch[1], 10) > deathYear) {
      return true;
    }
  }

  return false;
}

function scoreSentence(item) {
  let score = 1.0;
  const sentence = item.cleaned;

  if (item.hasBold) score += 1.8;
  if (item.hasLink) score += 1.0;

  const achievementMatches = sentence.match(ACHIEVEMENT_VERB_REGEX);
  if (achievementMatches) score += achievementMatches.length * 1.8;

  const keywordMatches = sentence.match(CORE_SIGNIFICANCE_TEST_REGEX);
  if (keywordMatches) score += keywordMatches.length * 0.5;

  if (MAJOR_HISTORICAL_EVENT_REGEX.test(sentence)) score += 1.0;
  if (ACADEMIC_CONCEPT_REGEX.test(sentence)) score += 0.8;

  return score;
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


export function buildDescription(introText = "", bodyText = "", aliases = [], maxLength = 800) {
  const cacheKey = `${introText.slice(0, 60)}_${bodyText.slice(0, 60)}_${maxLength}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const deathMatch = introText.match(/~\s*(\d{4})년/);
  const deathYear = deathMatch ? parseInt(deathMatch[1], 10) : null;

  const parsedIntroParagraphs = extractAnnotatedParagraphs(introText);
  const parsedBodyParagraphs = extractAnnotatedParagraphs(bodyText);

  const flatIntroSentences = parsedIntroParagraphs.flat();
  const flatBodySentences = parsedBodyParagraphs.flat();
  const allFlatSentences = [...flatIntroSentences, ...flatBodySentences];

  let currentLength = 0;
  const selectedSentences = [];
  const seenContents = new Set();

  let introQuota = 4;
  const introAchievementMatches = introText.match(ACHIEVEMENT_VERB_REGEX);
  if (introAchievementMatches && introAchievementMatches.length >= 3) {
    introQuota = 7;
  }

  const validIntroSentences = flatIntroSentences.filter((item, idx) => {
    const isFirstIntroSentence = (idx === 0);
    return !isDisqualifiedSentence(item.cleaned, isFirstIntroSentence, deathYear);
  });

  for (let idx = 0; idx < validIntroSentences.length && selectedSentences.length < introQuota; idx++) {
    const item = validIntroSentences[idx];
    const globalIdx = flatIntroSentences.indexOf(item);
    
    const resolved = resolveAnaphora(item.cleaned, allFlatSentences, globalIdx);
    const keyFingerprint = resolved.replace(/[^가-힣0-9]/g, "").slice(0, 15);

    if (!seenContents.has(keyFingerprint) && currentLength + resolved.length + 1 <= maxLength) {
      selectedSentences.push(resolved);
      seenContents.add(keyFingerprint);
      currentLength += resolved.length + 1;
    }
  }

  const candidateBodyItems = [];
  for (const paragraphSentences of parsedBodyParagraphs) {
    const validParagraphItems = paragraphSentences.filter(item => !isDisqualifiedSentence(item.cleaned, false, deathYear));
    if (validParagraphItems.length === 0) continue;

    const scoredItems = validParagraphItems.map((item) => ({
      item,
      score: scoreSentence(item),
      globalIdx: allFlatSentences.indexOf(item)
    })).sort((a, b) => b.score - a.score);

    candidateBodyItems.push(...scoredItems.slice(0, 3));
  }

  candidateBodyItems.sort((a, b) => b.score - a.score);

  const pickedBodyItems = [];
  for (const candidate of candidateBodyItems) {
    const resolved = resolveAnaphora(candidate.item.cleaned, allFlatSentences, candidate.globalIdx);
    const keyFingerprint = resolved.replace(/[^가-힣0-9]/g, "").slice(0, 15);

    if (!seenContents.has(keyFingerprint) && currentLength + resolved.length + 1 <= maxLength) {
      pickedBodyItems.push({ ...candidate, resolved });
      seenContents.add(keyFingerprint);
      currentLength += resolved.length + 1;
    }
  }

  pickedBodyItems.sort((a, b) => a.globalIdx - b.globalIdx);
  for (const item of pickedBodyItems) {
    selectedSentences.push(item.resolved);
  }

  const result = selectedSentences.join(" ");
  return (cache[cacheKey] = result);
}
  
export function summarizeText(text) {
  if (!text) return { summary: "", sentenceCount: 0, usedSentences: 0 };

  const cleanedFullText = cleanWikiText(text);
  const paragraphs = cleanedFullText.split(/\n+|\n?==+[^=]+==+\n?/).filter(p => p.trim());
  const introText = paragraphs[0] || "";
  const bodyText = paragraphs.slice(1).join("\n\n");

  const summary = buildDescription(introText, bodyText);
  const totalSentences = cleanedFullText.split(/(?<=[.!?])\s+/).length;
  const usedSentences = summary ? summary.split(/(?<=[.!?])\s+/).length : 0;

  return { summary, sentenceCount: totalSentences, usedSentences };
}
