// ==========================================================
// 1. 위키 링크 개념어 초경량 탐침기 (12줄)
// ==========================================================
export function getWikiConceptTerms(rawText, topN = 15) {
    if (!rawText || typeof rawText !== "string") return [];
    const noise = /(\d+(년|월|일|세기)|조선|한국|서울|미국|일본|어머니|아들|딸|씨|황제|선생|대왕|《|『|경부선|호남선|노선|동선|어선)/;
    const concept = /(학|론|설|법칙|원리|현상|효과|반응|구조|체계|역학|에너지|성|화|력|주의|제도|혁명|사상|철학|법|이론|방사선|광선|자외선|적외선|능|소|체|도|률|량|계|점|원|물|상|형)$/;
    const map = new Map();
    for (const [, term] of rawText.matchAll(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g)) {
        const clean = term.trim();
        if (clean.length >= 2 && clean.length <= 12 && !noise.test(clean)) {
            map.set(clean, (map.get(clean) || 0) + (concept.test(clean) ? 3 : 1));
        }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, topN);
}

// ==========================================================
// 2. 키워드 사전 및 필터
// ==========================================================
const RAW_KEYWORDS = [
    "태어났다", "출생", "사망", "활동", "독점", "정벌", "발표", "창시", "발명",
    "발견", "폐지", "수상", "노벨", "대표", "저서", "저자", "작품", "전쟁", "독립", "혁명",
    "연구", "증명", "설립", "창립", "개발", "제작", "기록", "영향", "업적", "졸업", "도입", "주장",
    "임명", "취임", "부정", "일기", "수용소", "유대인", "수필", "순국", "이토", "히로부미",
    "옥사", "고문", "투옥", "역임", "주석", "의병", "교육", "망명", "피살", "저항", "만세",
    "저술", "집대성", "창안", "고안", "편찬", "집필", "창제", "축조", "개혁", "기여",
    "주도", "총괄", "선출", "달성", "남겼", "남기", "평가받", "일컬어", "불린", "이끌",
    "가담", "초석", "기틀", "개선", "전개", "주창", "체계화", "정립", "기여하", "성공", "임시정부",
    "조직", "통일", "멸망", "함락", "정복", "편입", "군현제", "도량형", "만리장성", "분서갱유",
    "황제", "칭호", "제도", "토목", "능묘", "순행", "개량", "설계", "과학", "기술",
    "천문", "의학", "수학", "공학", "관측", "발명품", "이론", "법칙", "원리", "측우기",
    "혼천의", "자격루", "헌신", "보급", "창설", "구제", "지원", "정책", "구호", "봉사",
    "확산", "유학", "사상", "성현", "철학", "사상가", "유학자", "성선설", "인", "의",
    "예", "지", "맹자", "공자", "논어", "대학", "중용", "도덕", "윤리", "경전",
    "성리학", "실학", "경세", "목민", "실용", "실사구시", "이용후생"
];

const IMPORTANT_KEYWORDS = Array.from(new Set(RAW_KEYWORDS)).sort((a, b) => b.length - a.length);
const KEYWORD_REGEX = new RegExp(
    IMPORTANT_KEYWORDS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
);
const HARD_NOISE_REGEX = new RegExp([
    "(?:의\\s*(?:아들|딸|손자|손녀|부인|아내|남편|부친|모친|차남|장남|자녀|후손|부모|친척|사위|숙부|고모))",
    "결혼하", "슬하에", "일화", "여담", "소문", "전해진다", "야사", "전설", "민담",
    "체육관", "유적", "오차가\\s*생긴다", "차이를\\s*보이고", "이설이\\s*있다", "학설", "추정된다",
    "구글", "두들", "기념하여", "생일을", "동상", "도로명", "지하철역", "우표", "드라마", "영화", "배우", "출연",
    "저널", "성명", "지적했", "논란", "시민단체", "기자회견",
    "시대착오", "망신", "언론", "기사", "인터뷰", "전제한\\s*뒤", "거세다", "반발", "캠페인"
].join("|"));

// ==========================================================
// 3. 헬퍼 함수
// ==========================================================


// 🎯 1. 짝이 안 맞는 ( 또는 ) 기호만 골라내어 완벽 제거하는 스택 함수
// 🎯 O(N) 초고속 짝 없는 괄호 기호 적출 함수

function removeUnpairedParentheses(str) {
    if (!str) return "";
    const stack = [];
    const toRemove = new Set();
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '(') stack.push(i);
        else if (str[i] === ')') stack.length ? stack.pop() : toRemove.add(i);
    }
    stack.forEach(i => toRemove.add(i));
    return str.split('').filter((_, i) => !toRemove.has(i)).join('');
}

export function cleanWikiText(text) {
    if (!text) return "";
    return removeUnpairedParentheses(
        text
            .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1") // [[링크|단어]] -> 단어로 변환
            .replace(/\[\s*\*?\s*\]|\[\d+\]|\[출처\s*필요\]|\[각주\]/g, "")
            .replace(/\((첫|두|세|네|다섯|\d+)\s*번째\)/g, "")
            .replace(/\(\s*\)/g, "")
    )
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

function normalizeSpace(text = "") {
    return String(text)
        .replace(/([.!?。])([가-힣a-zA-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim();
}

const REGEX_LEADING_CONNECTORS = /^(그러나|하지만|그런데|한편|따라서|게다가|반면|이에|이후|결국|그\s*후|또한|그리고),?\s*/;
function cleanLeadingConnectors(sentence) {
    if (!sentence) return "";
    return sentence.replace(REGEX_LEADING_CONNECTORS, "").trim();
}

function removeMetaBySearch(text) {
    if (!text) return "";
    let result = text;

    const hoMetaRegex = /(?<![가-힣])호는\s+[^。.]{1,200}?(?:이다|였다|이었|이며|이고|\.|$)/g;
    result = result.replace(hoMetaRegex, "");

    const keywords = "시호|본관|자|별호|아호|아명|태명|세례명|일명|당호|법명";
    const valToken = `(?:[^\\s,.\\(\\)\\u00B7]+(?:\\([^)]*\\)?)?)`;
    const valPattern = `${valToken}(?:\\s*[·ㆍ]\\s*${valToken})*`;
    
    const keySuffixed = `(?:${keywords})(?:은|는|\\([^)]*\\))`;
    const keyBare = `(?:${keywords})`;
    const singleMeta = `(?<![가-힣])(?:${keySuffixed}\\s*${valPattern}|${keyBare}\\s+${valPattern})`;

    const metaChainRegex = new RegExp(`(?:,\\s*|\\s+)*(?:${singleMeta}(?:,\\s*|\\s+이며|\\s+이고|\\s+)*)+(?:이다|였다|이었다|이며|이고|이자|으로)?`, "g");
    result = result.replace(metaChainRegex, "");

    return result
        .replace(/\(\s*(?:본관|시호|자|아명|일명)[^;)]*;\s*/g, "(")
        .replace(/\.{2,}/g, ".")
        .replace(/\s+\./g, ".")
        .replace(/\s+/g, " ")
        .trim();
}

function isIncompleteOrOpinionSentence(sentence) {
    if (!sentence) return true;
    const cleanEnd = sentence.replace(/[()"'\s.]+$|》/g, "").trim();

    if (/(?:밝혔다|주장했다|전했다|지적했다|비판했다|평가했다)$/.test(cleanEnd)) {
        return true;
    }

    const validEndingRegex = /(?:다|였다|이었다|하였다|됐다|된다|있다|없다|했다|되었다|남겼다|불린다)$/;
    return !validEndingRegex.test(cleanEnd);
}

function splitSentences(text) {
    if (!text || typeof text !== "string") return [];
    const normalized = normalizeSpace(text).replace(/\n+/g, " ");
    return normalized
        .split(/(?<!\b[a-zA-Z]|\d)([.!?。])(?=\s+|$)/)
        .reduce((acc, curr, index, array) => {
            if (index % 2 === 0) {
                const punctuation = array[index + 1] || "";
                const sentence = (curr + punctuation).trim();
                if (sentence) acc.push(sentence);
            }
            return acc;
        }, []);
}

function filterOtherPerson(rawSentences, aliases = []) {
    if (!Array.isArray(rawSentences) || rawSentences.length === 0) return [];

    return rawSentences.filter((sentence, index) => {
        const text = sentence.trim();
        if (!text) return false;
        if (index === 0) return true;

        if (HARD_NOISE_REGEX.test(text)) return false;
        return true;
    });
}

function isTooSimilar(sentence, existingSentences) {
    const getWords = str => new Set(str.match(/[가-힣a-zA-Z0-9]{2,}/g) || []);
    const wordsA = getWords(sentence);
    if (wordsA.size === 0) return false;

    for (const existing of existingSentences) {
        const wordsB = getWords(existing);
        let intersection = 0;
        wordsA.forEach(w => { if (wordsB.has(w)) intersection++; });
        
        const overlapRatio = intersection / Math.min(wordsA.size, wordsB.size);
        if (overlapRatio > 0.5) return true;
    }
    return false;
}

function getDocumentKeywords(text, topN = 12) {
    if (!text) return [];
    const words = text.match(/[가-힣a-zA-Z0-9]{2,}/g) || [];
    const stopWords = new Set([
        "대한", "경우", "관한", "통해", "위해", "따라", "또한", "그리고", "하지만", "이후", 
        "당시", "것이다", "속해", "의해", "있다", "없다", "되어", "하여", "있는", "하는",
        "사람", "하나", "가지", "자신의", "위해", "때문", "관련", "기록", "기록되어", "차이를"
    ]);
    const freqMap = {};
    for (const w of words) {
        if (!stopWords.has(w)) {
            freqMap[w] = (freqMap[w] || 0) + 1;
        }
    }
    return Object.keys(freqMap)
        .sort((a, b) => freqMap[b] - freqMap[a])
        .slice(0, topN);
}

// ==========================================================
// 4. 핵심 추출 및 요약 생성 로직 (인자 순서 교정 완료)
// ==========================================================

export function extractImportantSentences(bodyText, introText = "", wikiTermRegex = null, aliases = [], count = 3) {
    if (!bodyText || typeof bodyText !== "string") return "";

    const cleanedBody = removeMetaBySearch(cleanWikiText(bodyText));
    let rawSentences = splitSentences(cleanedBody);

    if (Array.isArray(aliases) && aliases.length > 0) {
        rawSentences = filterOtherPerson(rawSentences, aliases);
    }

    const totalCount = rawSentences.length;
    if (totalCount === 0) return "";

    const docKeywords = getDocumentKeywords(cleanedBody + " " + introText, 12);
    const scoredCandidates = [];

    for (let index = 0; index < totalCount; index++) {
        let text = rawSentences[index].trim();
        const len = text.length;

        if (len < 10 || len > 350) continue;
        if (isIncompleteOrOpinionSentence(text)) continue;
        if (HARD_NOISE_REGEX.test(text)) continue;

        let score = 10;

        // 🎯 위키 탐침 정규식 가산점 (+50점)
        if (wikiTermRegex && wikiTermRegex.test(text)) {
            score += 50;
        }

        if (KEYWORD_REGEX.test(text)) {
            score += 50;
        }

        let keywordHits = 0;
        docKeywords.forEach(kw => {
            if (text.includes(kw)) keywordHits++;
        });
        score += keywordHits * 8;

        if (len >= 25 && len <= 180) score += 10;

        scoredCandidates.push({
            sentence: text,
            index: index,
            score: score
        });
    }

    if (scoredCandidates.length === 0) return "";

    scoredCandidates.sort((a, b) => b.score - a.score);

    const selected = [];
    for (const candidate of scoredCandidates) {
        if (selected.length >= count) break;
        
        const existingTexts = selected.map(s => s.sentence);
        if (!isTooSimilar(candidate.sentence, existingTexts)) {
            selected.push(candidate);
        }
    }

    selected.sort((a, b) => a.index - b.index);

    return selected
        .map((item, idx) => idx === 0 ? item.sentence : cleanLeadingConnectors(item.sentence))
        .join(" ");
}

export function buildDescription(introText = "", bodyText = "", aliases = [], extraCount = 3, introThreshold = 150, maxLength = 630) { 
    const rawTotal = ((introText || "") + " " + (bodyText || "")).trim();

    // ⛔ [탈락 조건 1] 전체 원본 글자 수가 80자 미만인 토막글은 즉시 철수
    if (rawTotal.length < 80) return "";

    // ⛔ [탈락 조건 2] '태어났다/사망하였다' 단어를 빼고 나면 남는 실질 내용이 30자 미만일 때 탈락
    const substantiveText = cleanWikiText(rawTotal).replace(/(태어났다|사망하였다|출생|사망)/g, "").trim();
    if (substantiveText.length < 30) return "";
    
    // 🎯 1. 대괄호 제거 전 원문에서 위키 개념어 탐침
    const wikiTerms = getWikiConceptTerms((introText || "") + " " + (bodyText || ""));
    const wikiTermRegex = wikiTerms.length ? new RegExp(wikiTerms.join("|")) : null;

    // 🎯 2. 정제 수행
    let introClean = removeMetaBySearch(cleanWikiText(introText));
    let bodyClean = removeMetaBySearch(cleanWikiText(bodyText));

    if (introClean && Array.isArray(aliases) && aliases.length > 0) {
        const introSentences = splitSentences(introClean);
        introClean = filterOtherPerson(introSentences, aliases).join(" ");
    }
    if (bodyClean && Array.isArray(aliases) && aliases.length > 0) {
        const bodySentences = splitSentences(bodyClean);
        bodyClean = filterOtherPerson(bodySentences, aliases).join(" ");
    }

    let intro = normalizeSpace(introClean || "");
    let body = normalizeSpace(bodyClean || "");

    const cleanSlice = (text) => {
        if (text.length <= maxLength) return text;
        const sliced = text.slice(0, maxLength);
        const lastPeriod = sliced.lastIndexOf(".");
        if (lastPeriod > maxLength * 0.5) {
            return sliced.slice(0, lastPeriod + 1).trim();
        }
        return sliced;
    };

    if (!intro && !body) {
        const fallback = normalizeSpace(removeMetaBySearch(cleanWikiText(introText) || cleanWikiText(bodyText)));
        if (!fallback) return "";
        return cleanSlice(fallback);
    }

    const introSentences = splitSentences(intro).filter(Boolean);
    const selectedIntroSentences = [];

    if (introSentences.length > 0) {
        if (!isIncompleteOrOpinionSentence(introSentences[0]) && !HARD_NOISE_REGEX.test(introSentences[0])) {
            selectedIntroSentences.push(introSentences[0]);
        }

        for (let i = 1; i < introSentences.length; i++) {
            const sentence = introSentences[i];
            const currentLen = selectedIntroSentences.join(" ").length;

            if (currentLen >= 250 || selectedIntroSentences.length >= 2) break;

            if (!isIncompleteOrOpinionSentence(sentence) && !HARD_NOISE_REGEX.test(sentence)) {
                if (!isTooSimilar(sentence, selectedIntroSentences)) {
                    selectedIntroSentences.push(cleanLeadingConnectors(sentence));
                }
            }
        }
    }

    const introResultText = selectedIntroSentences.join(" ");
    const remainingIntro = introSentences.slice(selectedIntroSentences.length).filter(Boolean).join(" ");
    const targetBody = normalizeSpace([remainingIntro, body].filter(Boolean).join(" "));

    let extra = "";
    if (targetBody && targetBody.length > 10) {
        // 🎯 3. 올바른 인자 순서로 전달: (bodyText, introText, wikiTermRegex, aliases, count)
        extra = extractImportantSentences(targetBody, introResultText, wikiTermRegex, aliases, extraCount);
    }

    const merged = normalizeSpace([introResultText, extra].filter(Boolean).join(" "));
    return cleanSlice(merged);
}
