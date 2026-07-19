const IMPORTANT_KEYWORDS = [
    "태어났다",
    "출생",
    "사망",
    "활동",
    "노력",
    "독점",
    "정벌",
    "발표",
    "창시",
    "발명",
    "발견",
    "수상",
    "노벨",
    "대표",
    "저서",
    "작품",
    "전쟁",
    "독립",
    "혁명",
    "연구",
    "증명",
    "설립",
    "창립",
    "개발",
    "제작",
    "기록",
    "영향",
    "업적",
    "졸업",
    "임명",
    "취임",
    "부정"
];

function normalizeSpace(text = "") {
    return String(text).replace(/\s+/g, " ").trim();
}

function splitSentences(text) {
    const normalized = normalizeSpace(text).replace(/\n+/g, " ");
    const sentences = normalized
        .split(/([.!?。！？])\s+/)
        .reduce((acc, part, i, arr) => {
            if (i % 2 === 0 && part.length > 0) {
                const nextPart = arr[i + 1];
                const sentence = nextPart ? part + nextPart : part;
                acc.push(sentence);
            }
            return acc;
        }, [])
        .map(s => s.trim())
        .filter(s => s.length >= 12);
    
    return sentences;
}

function tokenize(text) {
    return normalizeSpace(text)
        .replace(/[^\w가-힣]+/g, " ")
        .split(/\s+/)
        .map(s => s.trim())
        .filter(s => s.length >= 2);
}

/**
 * 본문 전체에서, intro와 겹치지 않는 핵심 문장만 뽑는다.
 * @param {string} bodyText 전체 extract
 * @param {string} introText 기존 exintro
 * @param {string[]} aliases 인물명/별칭 배열
 * @param {number} count 뽑을 문장 수
 * @returns {string}
 */
export function extractImportantSentences(bodyText, introText = "", aliases = [], count = 3) {
    if (!bodyText) return "";

    const sentences = splitSentences(bodyText);
    if (sentences.length === 0) return "";

    const introWords = new Set(tokenize(introText));

    const scored = sentences.map((sentence, index) => {
        let processedSentence = sentence.trim();
        let score = 0;

        // [고영양가 핵심 키워드 점수]
        const nutritionRegex = /(전투|전사|왕위|즉위|폐위|살해|통치|재위|업적|개혁|혁명|조약|발명|발견|창시|수립|기여|작품)/;
        if (nutritionRegex.test(processedSentence)) {
            score += 15; 
        }

        // 지시어 문맥 보정 (이 작품은 -> 《작품명》 작품은)
        const targetRegex = /(이|그)\s+(작품|조각|그림|회화|동상|건축물|벽화|서적|책|화풍|시리즈)/;
        if (targetRegex.test(processedSentence)) {
            let foundTitle = null;
            for (let j = index - 1; j >= 0; j--) {
                const match = sentences[j].match(/《([^》]+)》/) || sentences[j].match(/〈([^〉]+)〉/);
                if (match) {
                    foundTitle = match[0];
                    break;
                }
            }
            if (foundTitle) {
                processedSentence = processedSentence.replace(targetRegex, `${foundTitle} $2`);
            }
        }

        const words = tokenize(processedSentence);
        if (words.length === 0) return { sentence: processedSentence, index, score: -100 };

        let overlap = 0;
        for (const word of words) {
            if (introWords.has(word)) overlap++;
        }
        const overlapRate = overlap / Math.max(words.length, 1);
        if (overlapRate >= 0.75) return { sentence: processedSentence, index, score: -100 };

        for (const alias of aliases) {
            if (alias && processedSentence.includes(alias)) score += 8;
        }

        for (const keyword of IMPORTANT_KEYWORDS) {
            if (processedSentence.includes(keyword)) score += 5;
        }

        if (/\d{3,4}년/.test(processedSentence)) score += 5;

        if (processedSentence.length > 180) score -= 6;
        if (processedSentence.length < 35) score -= 15; 

        return { sentence: processedSentence, index, score };
    });

    const validCandidates = scored.filter(item => item.score > 0 && item.sentence.length >= 25);
    if (validCandidates.length === 0) return "";

    // 데이터가 적을 때는 순수 최고 점수 추출
    if (validCandidates.length <= count) {
        return validCandidates
            .sort((a, b) => b.score - a.score)
            .map(item => item.sentence)
            .join(" ");
    }

    // 데이터가 충분할 때만 구역별 분산 샘플링
    const selectedItems = [];
    const zoneSize = Math.floor(validCandidates.length / count);

    for (let i = 0; i < count; i++) {
        const startIdx = i * zoneSize;
        const endIdx = (i === count - 1) ? validCandidates.length : (i + 1) * zoneSize;
        const zoneCandidates = validCandidates.slice(startIdx, endIdx);
        
        if (zoneCandidates.length > 0) {
            zoneCandidates.sort((a, b) => b.score - a.score);
            selectedItems.push(zoneCandidates[0]);
        }
    }

    return selectedItems
        .sort((a, b) => a.index - b.index)
        .map(item => item.sentence)
        .join(" ");
}
/**
 * exintro가 짧을 때만 본문 핵심 문장을 보강해서 최종 설명을 만든다.
 * @param {string} introText 기존 exintro
 * @param {string} bodyText 전체 본문 extract
 * @param {string[]} aliases 인물명/별칭 배열
 * @param {number} extraCount 추가 문장 수
 * @param {number} introThreshold intro가 이 길이보다 짧으면 보강
 * @param {number} maxLength 최종 최대 길이
 * @returns {string}
 */
export function buildDescription(
    introText,
    bodyText,
    aliases = [],
    extraCount = 3,
    introThreshold = 150,
    maxLength = 1100
) {
    const intro = normalizeSpace(introText || "");
    const body = normalizeSpace(bodyText || "");

    if (!intro && !body) return "";

    const cleanSlice = (text) => {
        if (text.length <= maxLength) return text;
        const sliced = text.slice(0, maxLength);
        const lastPeriod = sliced.lastIndexOf(".");
        if (lastPeriod > maxLength * 0.5) {
            return sliced.slice(0, lastPeriod + 1).trim();
        }
        return sliced;
    };

    // [토막글 예외 처리] 총 글자 수가 짧으면 필터 없이 바로 합침
    const totalLength = intro.length + body.length;
    if (totalLength < 350) {
        const combined = normalizeSpace([intro, body].filter(Boolean).join(" "));
        return cleanSlice(combined);
    }

    const introSentences = intro.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    const firstSentence = introSentences[0] || "";

    // 본문에서 요약문 추출
    let extra = "";
    if (body && body.length > 40) {
        extra = extractImportantSentences(body, intro, aliases, extraCount);
    }

    // 건질 본문이 없다면 서론의 나머지 문장 활용
    if (!extra) {
        const remainingIntro = introSentences.slice(1).join(" ");
        if (remainingIntro) {
            extra = extractImportantSentences(remainingIntro, firstSentence, aliases, extraCount);
        }
    }

    const merged = normalizeSpace([firstSentence, extra].filter(Boolean).join(" "));
    return cleanSlice(merged);
}
