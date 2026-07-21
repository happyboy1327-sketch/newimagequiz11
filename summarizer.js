const IMPORTANT_KEYWORDS = [
    "태어났다", "출생", "사망", "활동", "노력", "독점", "정벌", "발표", "창시", "발명",
    "발견", "폐지", "수상", "노벨", "대표", "저서", "작품", "전쟁", "독립", "혁명",
    "연구", "증명", "설립", "창립", "개발", "제작", "기록", "영향", "업적", "졸업",
    "임명", "취임", "부정"
];

// 단순 족보/가족관계 나열 전용 감지 정규식
const GENEALOGY_REGEX = /(의\s*(아들|딸|손자|손녀|부인|아내|남편|부친|모친|차남|장남|차녀|장녀)(이다|이었다|이며|이고|\s|\.))|(슬하에)|(결혼하(여|였|고))|(출생하|태어났)/;

// 영양가(업적/사건 등) 감지 정규식
const NUTRITION_REGEX = /(독립|전투|운동|학설|발명|발견|창시|개혁|통일|건국|재위|집권|해방|혁명|사상|학파|저서|대표작|노벨상|원소|정리|공식|전쟁|함락|승리|패배|결성|폐지|창립|설립|의병|관찰사|벼슬|임진왜란)/;

function normalizeSpace(text = "") {
    return String(text).replace(/\s+/g, " ").trim();
}

function cleanWikiText(text) {
    if (!text) return "";
    return text
        .replace(/\[\s*\*?\s*\]|\[\d+\]|\[출처\s*필요\]|\[각주\]/g, "")
        .replace(/\((첫|두|세|네|다섯|\d+)\s*번째\)/g, "")
        .replace(/\(\s*\)/g, "")
        .replace(/\s+/g, " ")
        .replace(/\s+\./g, ".")
        .trim();
}

function isIncompleteSentence(sentence) {
    if (!sentence) return true;
    const text = sentence.trim();
    const validEndingRegex = /(다|냐|까|요|죠|자|라|며|음|임|함|됨|성|상|위|중)\.?$/;
    return !validEndingRegex.test(text);
}

function findPrecedingTitle(sentences, currentIndex) {
    for (let i = currentIndex - 1; i >= Math.max(0, currentIndex - 3); i--) {
        const prevText = sentences[i];
        if (!prevText) continue;
        const titleMatch = prevText.match(/《([^》]+)》|<([^>]+)>|〈([^〉]+)〉|“([^”]+)”|"([^"]+)"|'([^']+)'/);
        if (titleMatch) {
            return titleMatch[0];
        }
    }
    return null;
}

function resolveVagueReference(sentence, foundTitle) {
    if (!foundTitle) return sentence;
    let text = sentence.trim();

    if (/^(이|그)\s*중\b/.test(text)) {
        return text.replace(/^(이|그)\s*중\b/, `${foundTitle} 중`);
    }
    return `${foundTitle}의 ${text}`;
}

function filterOtherPersonDeath(text, aliases = []) {
    if (!text) return "";
    const sentences = text.split(/(?<=[.!?])\s+/);
    const cleanSentences = sentences.filter(sentence => {
        const match = sentence.match(/([가-힣\s]{2,12})(?:이|가|은|는).*?(?:사망|별세|서거|타계|전사|시해|사사|병사|처형|살해|숨졌|목숨을\s*잃)/);
        if (match) {
            const subjectName = match[1].trim();
            const isSelf = aliases.some(alias => {
                if (!alias) return false;
                const cleanAlias = alias.replace(/[\s\_\-]/g, "");
                const cleanSubject = subjectName.replace(/[\s\_\-]/g, "");
                return cleanSubject.includes(cleanAlias) || cleanAlias.includes(cleanSubject);
            });
            if (!isSelf) return false;
        }

        const possessiveDeathRegex = /(아버지|부친|어머니|모친|아내|부인|남편|아들|딸|형|동생|스승|친구|동료|통역가)의\s*(사망|별세|서거|타계|처형|죽음)/;
        if (possessiveDeathRegex.test(sentence)) return false;

        return true;
    });
    return cleanSentences.join(" ");
}

function splitSentences(text) {
    const normalized = normalizeSpace(text).replace(/\n+/g, " ");
    return normalized
        .split(/(?<!\b[a-zA-Z])([.!?。])(?=\s+|$)/)
        .reduce((acc, curr, index, array) => {
            if (index % 2 === 0) {
                const punctuation = array[index + 1] || "";
                const sentence = (curr + punctuation).trim();
                if (sentence) acc.push(sentence);
            }
            return acc;
        }, []);
}

function normalizeTitleCandidate(title) {
    if (!title) return "";
    return title.replace(/\([^)]*\)/g, "").replace(/[\s\_\-]/g, "").trim();
}

function matchesAlias(word, alias) {
    if (!word || !alias) return false;
    const cleanWord = word.replace(/[\s\_\-]/g, "");
    const cleanAlias = normalizeTitleCandidate(alias);
    if (!cleanWord || !cleanAlias) return false;
    return cleanWord.includes(cleanAlias) || cleanAlias.includes(cleanWord);
}

function calculateBasicNutritionScore(sentence) {
    let score = 0;
    if (NUTRITION_REGEX.test(sentence)) score += 20;

    IMPORTANT_KEYWORDS.forEach(kw => {
        if (sentence.includes(kw)) score += 5;
    });
    return score;
}

// 🌟 [추가] 문장에서 연도/날짜(예: 1339년, 1903년 12월)를 정밀 파싱하는 함수
function extractChronoTimestamp(text) {
    // 1. "1339년 11월 13일" 혹은 "1339년" 형태 감지
    const yearMatch = text.match(/(\d{3,4})\s*년(?:\s*(\d{1,2})\s*월)?(?:\s*(\d{1,2})\s*일)?/);
    if (yearMatch) {
        const year = parseInt(yearMatch[1], 10);
        const month = yearMatch[2] ? parseInt(yearMatch[2], 10) : 1;
        const day = yearMatch[3] ? parseInt(yearMatch[3], 10) : 1;
        // 비교용 타임스탬프 숫자 생성 (예: 13390000 + 1100 + 13)
        return year * 10000 + month * 100 + day;
    }
    return null; // 연도 언급 없음
}

export function extractImportantSentences(bodyText, count = 2) {
    if (!bodyText || typeof bodyText !== "string") return "";

    const rawSentences = splitSentences(bodyText);
    const cleanedSentences = [];

    rawSentences.forEach((sentence, index) => {
        let text = cleanWikiText(sentence);
        if (!text || isIncompleteSentence(text)) return;

        if (/^[《<〈“"'`].*[》>〉”"'`]$/.test(text)) {
            return;
        }

        if (text.length < 15 || text.length > 200) return;

        let processedText = text;
        if (/^(이|그)\s*중\b/.test(processedText) || !/^[가-힣a-zA-Z0-9\s《<〈“"'\(\)]+(이|가|은|는|을|를|의|에|에서)/.test(processedText)) {
            const foundTitle = findPrecedingTitle(rawSentences, index);
            if (foundTitle) {
                processedText = resolveVagueReference(processedText, foundTitle);
            } else {
                return;
            }
        }

        cleanedSentences.push({ original: processedText, index });
    });

    if (cleanedSentences.length === 0) return "";

    const candidates = cleanedSentences.map(({ original, index }) => {
        let score = calculateBasicNutritionScore(original);

        const hasNutrition = NUTRITION_REGEX.test(original);
        if (!hasNutrition && GENEALOGY_REGEX.test(original)) {
            score -= 100;
        }

        if (original.length >= 25 && original.length <= 120) score += 5;

        // 🌟 [추가] 문장의 연도 정보 파싱
        const chronoTime = extractChronoTimestamp(original);

        return { sentence: original, index, score, chronoTime };
    });

    const validCandidates = candidates.filter(item => item.score > 0);

    const highQualityCandidates = validCandidates.filter(item => item.score >= 15);
    if (highQualityCandidates.length === 0) {
        return "";
    }

    // 1차: 점수 높은 순으로 상위 문장(count) 추출
    validCandidates.sort((a, b) => b.score - a.score);
    const selected = validCandidates.slice(0, count);

    // 🌟 [핵심 변경] 2차: 뽑힌 문장들을 '시간순(연도순)'으로 정렬
    // 연도 정보가 있는 문장끼리는 연도순, 연도 언급이 없는 문장은 원문 순서(index) 기준으로 시간순 배치
    selected.sort((a, b) => {
        if (a.chronoTime !== null && b.chronoTime !== null) {
            if (a.chronoTime !== b.chronoTime) {
                return a.chronoTime - b.chronoTime; // 연도 빠른 순
            }
        } else if (a.chronoTime !== null) {
            // a만 연도가 있는 경우, 연도 비교 후 애매하면 원문 순서
            return -1;
        } else if (b.chronoTime !== null) {
            return 1;
        }
        return a.index - b.index; // 둘 다 연도 표기가 없으면 원문 순서
    });

    return selected.map(item => item.sentence).join(" ");
}

export function buildDescription(
    introText,
    bodyText,
    aliases = [],
    extraCount = 3,
    introThreshold = 150,
    maxLength = 1100
) {
    let intro = cleanWikiText(introText);
    let body = cleanWikiText(bodyText);

    if (intro && aliases.length > 0) {
        intro = filterOtherPersonDeath(intro, aliases);
    }
    if (body && aliases.length > 0) {
        body = filterOtherPersonDeath(body, aliases);
    }

    intro = normalizeSpace(intro || "");
    body = normalizeSpace(body || "");

    if (!intro && !body) return "";

    // 본문에서 알짜 문장 추출
    const extra = extractImportantSentences(body, extraCount);

    const introHasNutrition = NUTRITION_REGEX.test(intro);
    const bodyHasNutrition = NUTRITION_REGEX.test(extra);
    const isGenealogyOnly = GENEALOGY_REGEX.test(intro) && !introHasNutrition;

    // 업적 키워드가 없고 족보만 있는 토막글이면 탈락 ("" 반환)
    if ((!extra || !bodyHasNutrition) && (!introHasNutrition || isGenealogyOnly)) {
        return "";
    }

    let merged = normalizeSpace([intro, extra].filter(Boolean).join(" "));

    if (merged.length > maxLength) {
        merged = merged.slice(0, maxLength);
        const lastPeriod = merged.lastIndexOf(".");
        if (lastPeriod > maxLength * 0.5) {
            merged = merged.slice(0, lastPeriod + 1).trim();
        }
    }

    return merged;
}
