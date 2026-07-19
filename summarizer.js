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

    // 1. 모든 문장에 대해 점수 계산 및 지시어(이 작품은 등) 문맥 보정 진행
    const scored = sentences.map((sentence, index) => {
        let processedSentence = sentence.trim();
        let score = 0;

        // 🌟 [문맥 보정 로직] 대명사가 외롭게 남는 현상 방지
        const targetRegex = /(이|그)\s+(작품|조각|그림|회화|동상|건축물|벽화|서적|책|화풍|시리즈)/;
        if (targetRegex.test(processedSentence)) {
            let foundTitle = null;
            
            // 현재 문장 바로 앞 구역부터 역순으로 올라가며 가장 가까운 겹화살괄호 《 》 나 〈 〉 검색
            for (let j = index - 1; j >= 0; j--) {
                const match = sentences[j].match(/《([^》]+)》/) || sentences[j].match(/〈([^〉]+)〉/);
                if (match) {
                    foundTitle = match[0]; // 예: "《다비드》" 획득
                    break;
                }
            }
            
            // 문맥에 맞는 작품명을 찾았다면 "이 작품" -> "《다비드》 작품" 형태로 자연스럽게 치환
            if (foundTitle) {
                processedSentence = processedSentence.replace(
                    /(이|그)\s+(작품|조각|그림|회화|동상|건축물|벽화|서적|책|화풍|시리즈)/g, 
                    `${foundTitle} $2`
                );
            }
        }

        // 2. 필터 조건 사전 체크 (글자 수가 없거나 서론과 55% 이상 겹치면 탈락)
        const words = tokenize(processedSentence);
        if (words.length === 0) return { sentence: processedSentence, index, score: -100 };

        let overlap = 0;
        for (const word of words) {
            if (introWords.has(word)) overlap++;
        }
        const overlapRate = overlap / Math.max(words.length, 1);
        if (overlapRate >= 0.55) return { sentence: processedSentence, index, score: -100 };

        // 3. 본격적인 가산점 스코어링 (보정된 processedSentence 기준)
        for (const alias of aliases) {
            if (alias && processedSentence.includes(alias)) score += 10;
        }

        if (/(그는|그의|그를|작가는|이후|말년에)/.test(processedSentence)) score += 5;

        for (const keyword of IMPORTANT_KEYWORDS) {
            if (processedSentence.includes(keyword)) score += 6;
        }

        if (/\d{3,4}년/.test(processedSentence)) score += 5;
        if (/[<>\u226A\u226B]/.test(processedSentence)) score += 4;

        if (processedSentence.length > 180) score -= 6;
        if (processedSentence.length < 30) score -= 4;

        return { sentence: processedSentence, index, score };
    });

    // 필터 탈락 대상(-100점) 제외시키기
    const validCandidates = scored.filter(item => item.score > -100);
    if (validCandidates.length === 0) return "";

    // 4. 구역별(Zone) 균등 샘플링 진행 (초/중/후반 분산 추출)
    const totalCandidates = validCandidates.length;
    const selectedItems = [];

    if (totalCandidates <= count) {
        return validCandidates
            .sort((a, b) => b.score - a.score)
            .map(item => item.sentence)
            .join(" ");
    } else {
        const zoneSize = Math.floor(totalCandidates / count);

        for (let i = 0; i < count; i++) {
            const startIdx = i * zoneSize;
            const endIdx = (i === count - 1) ? totalCandidates : (i + 1) * zoneSize;
            
            const zoneCandidates = validCandidates.slice(startIdx, endIdx);
            
            if (zoneCandidates.length > 0) {
                zoneCandidates.sort((a, b) => b.score - a.score);
                selectedItems.push(zoneCandidates[0]);
            }
        }
    }

    // 5. 뽑힌 문장들을 원본 순서(index)대로 최종 재정렬 후 병합
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
