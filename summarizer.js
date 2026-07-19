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

    // 1. 점수 매기기 (구역 편중을 유발하는 index 보너스 제거)
    const scored = candidates.map((sentence, index) => {
        let score = 0;

        for (const alias of aliases) {
            if (alias && sentence.includes(alias)) score += 10;
        }

        // 주어가 생략되는 본문 중후반부를 위해 대명사 가산점 추가
        if (/(그는|그의|그를|작가는|이후|말년에)/.test(sentence)) score += 5;

        for (const keyword of IMPORTANT_KEYWORDS) {
            if (sentence.includes(keyword)) score += 6;
        }

        if (/\d{3,4}년/.test(sentence)) score += 5;

        // 예술가 퀴즈인 경우 작품명(《 》 또는 < >)이 들어간 문장 가산점
        if (/[<>\u226A\u226B]/.test(sentence)) score += 4;

        // 💡 감점 기준 완화 (핵심 문장이 탈락하는 것 방지)
        if (sentence.length > 180) score -= 6;
        if (sentence.length < 30) score -= 4;

        return { sentence, index, score };
    });

    // 2. ★ 핵심: 훑는 범위를 전범위로 넓히기 위한 구역별(Zone) 샘플링 기법
    const totalCandidates = scored.length;
    const selectedItems = [];

    if (totalCandidates <= count) {
        // 후보가 몇 개 없다면 그냥 점수 순으로 정렬해서 내보냄
        return scored
            .sort((a, b) => b.score - a.score)
            .map(item => item.sentence)
            .join(" ");
    } else {
        // 후보군을 3개의 구역(초/중/후반)으로 균등하게 분할
        const zoneSize = Math.floor(totalCandidates / count);

        for (let i = 0; i < count; i++) {
            const startIdx = i * zoneSize;
            // 마지막 구역은 배열 끝까지 포함
            const endIdx = (i === count - 1) ? totalCandidates : (i + 1) * zoneSize;
            
            const zoneCandidates = scored.slice(startIdx, endIdx);
            
            // 해당 구역에서 가장 점수가 높은 문장 1개 추출
            if (zoneCandidates.length > 0) {
                zoneCandidates.sort((a, b) => b.score - a.score);
                selectedItems.push(zoneCandidates[0]);
            }
        }
    }

    // 3. 최종 선택된 문장들을 원래 본문 순서(index)대로 다시 정렬해서 합침
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
