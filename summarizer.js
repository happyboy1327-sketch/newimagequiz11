const IMPORTANT_KEYWORDS = [
    "태어났다",
    "출생",
    "사망",
    "활동",
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
    "서훈",
    "대상"
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

    const candidates = sentences.filter((sentence) => {
        const words = tokenize(sentence);
        if (words.length === 0) return false;

        let overlap = 0;
        for (const word of words) {
            if (introWords.has(word)) overlap++;
        }

        const overlapRate = overlap / Math.max(words.length, 1);
        return overlapRate < 0.55;
    });

    if (candidates.length === 0) return "";

    const scored = candidates.map((sentence, index) => {
    let score = 0;

    for (const alias of aliases) {
        if (alias && sentence.includes(alias)) score += 10;
    }

    for (const keyword of IMPORTANT_KEYWORDS) {
        if (sentence.includes(keyword)) score += 6;
    }

    if (/\d{3,4}년/.test(sentence)) score += 5;

    // 💡 수정: 위키 문장은 기므로 감점 기준을 180자로 완화합니다.
    if (sentence.length > 180) score -= 6; 
    if (sentence.length < 30) score -= 4; // 너무 짧은 쓰레기 문장 감점

    // 초반 인덱스 가산점을 2점 정도로 낮춰서 뒤쪽의 핵심 문장도 기회를 줍니다.
    score += Math.max(0, 2 - index); 

    return { sentence, index, score };
});

    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, count)
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
    maxLength = 1000
) {
    const intro = normalizeSpace(introText || "");
    const body = normalizeSpace(bodyText || "");

    if (!intro && !body) return "";

    // 1. 위키 첫 문장은 인물의 정체성(이름, 직업 등)을 나타내므로 무조건 첫 줄로 확보
    const introSentences = intro.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    const firstSentence = introSentences[0] || "";

    // 2. 무조건 서론만 리턴하던 기존 버그 조건문 제거!!
    // 첫 문장을 제외한 서론의 나머지 문장들과 본문을 하나로 합쳐 후보군 생성
    const remainingIntro = introSentences.slice(1).join(" ");
    const combinedCandidateText = [remainingIntro, body].filter(Boolean).join(" ");

    // 3. 합쳐진 전체 텍스트에서 스코어링 알고리즘(extractImportantSentences)을 돌려 알짜배기 문장만 추출
    const extra = extractImportantSentences(combinedCandidateText, firstSentence, aliases, extraCount);

    // 4. [정체성 첫 문장 + 엄선된 핵심 문장들] 병합
    const merged = normalizeSpace([firstSentence, extra].filter(Boolean).join(" "));

    // 5. 최종 글자 수 제한 내에서 온점(.) 마감 처리
    if (merged.length <= maxLength) return merged;
    const sliced = merged.slice(0, maxLength);
    const lastPeriod = sliced.lastIndexOf(".");
    
    if (lastPeriod > maxLength * 0.5) {
        return sliced.slice(0, lastPeriod + 1).trim();
    }
    return sliced;
}
