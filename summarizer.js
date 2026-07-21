const IMPORTANT_KEYWORDS = [
    "태어났다", "출생", "사망", "활동", "노력", "독점", "정벌", "발표", "창시", "발명",
    "발견", "폐지", "수상", "노벨", "대표", "저서", "작품", "전쟁", "독립", "혁명",
    "연구", "증명", "설립", "창립", "개발", "제작", "기록", "영향", "업적", "졸업",
    "임명", "취임", "부정"
];

function normalizeSpace(text = "") {
    return String(text).replace(/\s+/g, " ").trim();
}

function cleanWikiText(text) {
    if (!text) return "";
    return text
        .replace(/\[\s*\*?\s*\]|\[\d+\]|\[출처\s*필요\]|\[각주\]/g, "")
        .replace(/\((첫\vert{}두\vert{}세\vert{}네\vert{}다섯\vert{}\d+)\s*번째\)/g, "")
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
    const nutritionRegex = /(독립|전투|운동|학설|발명|발견|창시|개혁|통일|건국|재위|집권|해방|혁명|사상|학파|저서|대표작|노벨상|원소|정리|공식|전쟁|함락|승리|패배|결성|폐지|창립|설립)/;
    if (nutritionRegex.test(sentence)) score += 20;

    IMPORTANT_KEYWORDS.forEach(kw => {
        if (sentence.includes(kw)) score += 5;
    });
    return score;
}

/**
 * 본문에서 알짜 문장을 추출.
 * 💡 알짜 문장(15점 이상)이 단 하나도 없는 토막글/족보 문서라면 "" (빈값) 반환!
 */
export function extractImportantSentences(bodyText, count = 2) {
    if (!bodyText || typeof bodyText !== "string") return "";

    const rawSentences = splitSentences(bodyText);
    const cleanedSentences = [];

    // 1. 단순 족보/가족관계 나열 전용 감지 정규식
    const genealogyRegex = /(의\s*(아들|딸|손자|손녀|부인|아내|남편|부친|모친|차남|장남|차녀|장녀)(이다|이었다|이며|이고|\s|\.))|(슬하에)|(결혼하(여|였|고))|(출생하|태어났)/;

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

    // 2. 문장별 점수 계산
    const candidates = cleanedSentences.map(({ original, index }) => {
        let score = calculateBasicNutritionScore(original);

        // 단순 가족나열/족보 문장은 감점 (-100)
        const hasNutrition = /(독립|전투|운동|학설|발명|발견|창시|개혁|통일|건국|재위|집권|해방|혁명|사상|학파|저서|대표작|노벨상|원소|정리|공식|전쟁|함락|승리|패배|결성|폐지|창립|설립)/.test(original);
        if (!hasNutrition && genealogyRegex.test(original)) {
            score -= 100;
        }

        if (original.length >= 25 && original.length <= 120) score += 5;

        return { sentence: original, index, score };
    });

    // 3. 유효 점수(0점 초과) 문장 필터링
    const validCandidates = candidates.filter(item => item.score > 0);

    // 🌟 핵심 검증: 알짜 정보(15점 이상)를 담은 문장이 '최소 1개'도 없다면 이 본문은 문제 출제 불가능(탈락) 처리!
    const highQualityCandidates = validCandidates.filter(item => item.score >= 15);
    if (highQualityCandidates.length === 0) {
        return ""; // 출제 불가 (스킵)
    }

    validCandidates.sort((a, b) => b.score - a.score);

    const selected = validCandidates.slice(0, count);
    selected.sort((a, b) => a.index - b.index);

    return selected.map(item => item.sentence).join(" ");
}

/**
 * 최종 지문 구성 함수
 * 💡 문제 출제에 적합하지 않은 토막글/가족 나열글이면 "" (빈값) 반환!
 */
export function buildDescription(
    introText,
    bodyText,
    aliases = [],
    extraCount = 3,
    introThreshold = 150,
    maxLength = 1100
) {
    let intro = cleanWikiText(firstSentence);

    // 서두 개요 청소
    if (intro && aliases.length > 0) {
        intro = filterOtherPersonDeath(intro, aliases);
    }

    // 본문에서 알짜 문장 추출
    const extra = extractImportantSentences(bodyText, bodySentencesCount);

    // 🌟 최종 탈락 판정:
    // 본문에서 알짜 문장이 전혀 추출되지 않았고(extra === ""), 서두 역시 주요 업적 키워드가 없거나 지나치게 짧다면
    // 문제 출제 지문으로서 '탈락' 처리하여 빈 문자열("")을 반환합니다.
    const introHasNutrition = /(독립|전투|운동|학설|발명|발견|창시|개혁|통일|건국|재위|집권|해방|혁명|사상|학파|저서|대표작|노벨상|원소|정리|공식|전쟁|함락|승리|패배|결성|폐지|창립|설립)/.test(intro);
    
    if (!extra && !introHasNutrition) {
        return ""; // ❌ 문제 생성 대상에서 탈락!
    }

    const combined = [intro, extra].filter(Boolean).join(" ");
    return cleanWikiText(combined);
}
