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
    "폐지",
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
        .split(/(?<!\b[a-zA-Z])([.!?。！？])\s+/)
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

    // 고영양가 핵심 키워드 정규식 (+15점)
    const nutritionRegex = /(독립|운동|투쟁|해방|전투|전사|왕위|즉위|폐위|살해|통치|재위|업적|개혁|혁명|조약|발명|발견|창시|수립|기여|작품|주의|성선설|사단|사덕|측은|수오|사양|시비|오륜|부자유친|민본주의|인정|왕도|역성혁명|천명관)/;

    // 범용 지시어-조사 감지 정규식
    const fullStructureRegex = /^(이|그)\s+([가-힣]+)(이|가|은|는)\s+/;

    // 🌟 [주변 친인척 주어 정규식] 서브 인물 주객전도 방지용
    const relativeSubjectRegex = /^(어머니|아버지|남동생|여동생|형|오빠|누나|언니|아들|딸|부인|아내|남편|할아버지|할머니)\s+/;

    const scored = sentences.map((sentence, index) => {
        let processedSentence = sentence.trim();
        
        // 1. [원천 제외 필터]
        if (
            /(칭했다|두었다|슬하)/.test(processedSentence) ||
            /^(이때|그때|이 무렵|당시|그해)\s+/.test(processedSentence)
        ) {
            return { sentence: processedSentence, index, score: -100 };
        }

        // 2. [지시어 주어 맥락 자동 병합]
        if (fullStructureRegex.test(processedSentence)) {
            if (nutritionRegex.test(processedSentence)) {
                if (index > 0) {
                    const prevSentence = sentences[index - 1].trim();
                    processedSentence = `${prevSentence} ${processedSentence}`;
                } else {
                    processedSentence = processedSentence.replace(/^(이|그)\s+/, "");
                }
            } else {
                return { sentence: processedSentence, index, score: -100 };
            }
        }

        // 3. [명사형 작품/매체 지시어 보정]
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

        let score = 0;

        // 🌟 4. [주인공(Alias) 및 서브 인물 검증]
        const hasAlias = aliases.some(alias => alias && processedSentence.includes(alias));
        const isRelativeSubject = relativeSubjectRegex.test(processedSentence);

        // 주인공(alias) 포함 시 가산점 대폭 강화 (+20점)
        if (hasAlias) {
            score += 20;
        }

        // 주변 친인척이 주어인데 주인공 언급이 없으면 감점 (-15점) 및 영양가 점수 차단
        if (isRelativeSubject && !hasAlias) {
            score -= 15;
        } else {
            // 주인공 본인의 문장이거나 친인척 주어가 아닐 때만 고영양가 점수 부여 (+15점)
            if (nutritionRegex.test(processedSentence)) {
                score += 15; 
            }
        }

        if (typeof IMPORTANT_KEYWORDS !== "undefined") {
            for (const keyword of IMPORTANT_KEYWORDS) {
                if (processedSentence.includes(keyword)) score += 5;
            }
        }

        if (/\d{3,4}년/.test(processedSentence)) score += 5;

        // 5. [서론 중복도 검사]
        const words = tokenize(processedSentence);
        if (words.length === 0) return { sentence: processedSentence, index, score: -100 };

        let overlap = 0;
        for (const word of words) {
            if (introWords.has(word)) overlap++;
        }
        
        const overlapRate = overlap / Math.max(words.length, 1);
        const maxOverlapLimit = nutritionRegex.test(processedSentence) ? 0.88 : 0.75;
        if (overlapRate >= maxOverlapLimit) return { sentence: processedSentence, index, score: -100 };

        if (processedSentence.length > 300) score -= 6;
        if (processedSentence.length < 30) score -= 15; 

        return { sentence: processedSentence, index, score };
    });

    const validCandidates = scored.filter(item => item.score > 0 && item.sentence.length >= 25);
    if (validCandidates.length === 0) return "";

    if (validCandidates.length <= 4) {
        return validCandidates
            .sort((a, b) => b.score - a.score)
            .map(item => item.sentence)
            .join(" ");
    }

    // 6. [동적 3구역 분할 및 비중 기반 가변 추출]
    const totalCount = sentences.length;
    const boundary1 = Math.floor(totalCount / 3);
    const boundary2 = Math.floor((totalCount * 2) / 3);

    const zones = [
        { id: 1, candidates: [] },
        { id: 2, candidates: [] },
        { id: 3, candidates: [] }
    ];

    validCandidates.forEach(item => {
        if (item.index < boundary1) {
            zones[0].candidates.push(item);
        } else if (item.index < boundary2) {
            zones[1].candidates.push(item);
        } else {
            zones[2].candidates.push(item);
        }
    });

    let maxZoneIndex = 0;
    let maxCandidateCount = -1;

    zones.forEach((zone, idx) => {
        if (zone.candidates.length > maxCandidateCount) {
            maxCandidateCount = zone.candidates.length;
            maxZoneIndex = idx;
        }
    });

    const selectedItems = [];

    zones.forEach((zone, idx) => {
        if (zone.candidates.length === 0) return;

        zone.candidates.sort((a, b) => b.score - a.score);

        const takeCount = (idx === maxZoneIndex) ? 2 : 1;
        const picked = zone.candidates.slice(0, takeCount);
        selectedItems.push(...picked);
    });

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

    // buildDescription 함수 내부의 introSentence 분리 부분
const introSentences = intro.split(/(?<!\b[a-zA-Z])([.!?。！？])\s+/).reduce((acc, part, i, arr) => {
    if (i % 2 === 0 && part.length > 0) {
        const nextPart = arr[i + 1];
        acc.push(nextPart ? part + nextPart : part);
    }
    return acc;
}, []).map(s => s.trim()).filter(Boolean);
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
