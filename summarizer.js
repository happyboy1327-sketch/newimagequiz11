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
        .replace(/\((첫|두|세|네|다섯|\d+)\s*번째\)/g, "")
        .replace(/\(\s*\)/g, "")
        .replace(/\s+/g, " ")
        .replace(/\s+\./g, ".")
        .trim();
}

function filterOtherPersonDeath(text, aliases = []) {
    if (!text) return "";
    const sentences = text.split(/(?<=[.!?])\s+/);
    const cleanSentences = sentences.filter(sentence => {
        const match = sentence.match(/([가-힣\s]{2,12})(?:이|가)\s*(?:사망|별세|서거)/);
        if (match) {
            const subjectName = match[1].trim();
            const isSelf = aliases.some(alias => {
                const cleanAlias = alias.replace(/[\s\_\-]/g, "");
                const cleanSubject = subjectName.replace(/[\s\_\-]/g, "");
                return cleanSubject.includes(cleanAlias) || cleanAlias.includes(cleanSubject);
            });
            if (!isSelf) return false; 
        }
        return true;
    });
    return cleanSentences.join(" ");
}

function splitSentences(text) {
    const normalized = normalizeSpace(text).replace(/\n+/g, " ");
    return normalized
        .split(/(?<!\b[a-zA-Z])([.!?。！？])\s+/)
        .reduce((acc, part, i, arr) => {
            if (i % 2 === 0 && part.length > 0) {
                const nextPart = arr[i + 1];
                acc.push(nextPart ? part + nextPart : part);
            }
            return acc;
        }, [])
        .map(s => s.trim())
        .filter(s => s.length >= 12);
}

function tokenize(text) {
    return normalizeSpace(text)
        .replace(/[^\w가-힣]+/g, " ")
        .split(/\s+/)
        .map(s => s.trim())
        .filter(s => s.length >= 2);
}

export function extractImportantSentences(bodyText, introText = "", aliases = [], count = 3) {
    if (!bodyText) return "";

    const sentences = splitSentences(bodyText);
    if (sentences.length === 0) return "";

    const introWords = new Set(tokenize(introText));
    const nutritionRegex = /(독립|운동|투쟁|해방|전투|전사|왕위|즉위|폐위|살해|통치|재위|업적|개혁|혁명|조약|발명|발견|창시|수립|기여|작품|주의|성선설|사단|사덕|측은|수오|사양|시비|오륜|부자유친|민본주의|인정|왕도|역성혁명|천명관)/;
    
    // 🌟 [맥락 파괴 접속사 감지 정규식] 단독 추출 시 맥락이 끊기는 문장 강력 차단
    const contextBreakRegex = /^(그러자|이에|그러나|또한|이후|그 뒤|한편|그러던 중|그리하여|따라서|때문에|이때|그때|이 무렵|당시|그해)\b/;
    const relativeSubjectRegex = /^(어머니|아버지|남동생|여동생|형|오빠|누나|언니|아들|딸|부인|아내|남편|할아버지|할머니|손자|손녀)\s+/;
    const deathPattern = /(사망|별세|서거|타계|전사|시해|사사|병사|죽음|숨졌|세상을\s+떠났|생을\s+마감|사사되었|목숨을\s+잃었)/;

    const scored = sentences.map((sentence, index) => {
        let processedSentence = sentence.trim();
        
        // 1. [맥락 파괴 문장 원천 제외] (그러자, 이때, 서술형 찌꺼기 등)
        if (
            contextBreakRegex.test(processedSentence) ||
            /(칭했다|두었다|슬하|고 한다|라 한다)\.?$/.test(processedSentence) ||
            /^(이|그)\s+([가-힣]+)(이|가|은|는)\s+/.test(processedSentence)
        ) {
            return { sentence: processedSentence, index, score: -100 };
        }

        if (
            relativeSubjectRegex.test(processedSentence) || deathPattern.test(processedSentence) 
        ) {
            return { sentence: processedSentence, index, score: -120 };
        }

        let score = 0;
        const hasAlias = aliases.some(alias => alias && processedSentence.includes(alias));
        const isRelativeSubject = relativeSubjectRegex.test(processedSentence);

        if (hasAlias) score += 20;

        if (isRelativeSubject && !hasAlias) {
            score -= 15;
        } else {
            if (nutritionRegex.test(processedSentence)) score += 15; 
        }

        for (const keyword of IMPORTANT_KEYWORDS) {
            if (processedSentence.includes(keyword)) score += 5;
        }

        if (/\d{3,4}년/.test(processedSentence)) score += 5;

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

export function buildDescription(
    introText,
    bodyText,
    aliases = [],
    extraCount = 3,
    introThreshold = 150,
    maxLength = 1100
) {
    const rawIntro = filterOtherPersonDeath(cleanWikiText(introText), aliases);
    const rawBody = filterOtherPersonDeath(cleanWikiText(bodyText), aliases);

    const intro = normalizeSpace(rawIntro || "");
    const body = normalizeSpace(rawBody || "");

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

    const totalLength = intro.length + body.length;
    if (totalLength < 350) {
        const combined = normalizeSpace([intro, body].filter(Boolean).join(" "));
        return cleanSlice(combined);
    }

    const introSentences = intro
        .split(/(?<!\b[a-zA-Z])([.!?。！？])\s+/)
        .reduce((acc, part, i, arr) => {
            if (i % 2 === 0 && part.length > 0) {
                const nextPart = arr[i + 1];
                acc.push(nextPart ? part + nextPart : part);
            }
            return acc;
        }, [])
        .map(s => s.trim())
        .filter(Boolean);

    const firstSentence = introSentences[0] || "";

    let extra = "";
    if (body && body.length > 40) {
        extra = extractImportantSentences(body, intro, aliases, extraCount);
    }

    if (!extra) {
        const remainingIntro = introSentences.slice(1).join(" ");
        if (remainingIntro) {
            extra = extractImportantSentences(remainingIntro, firstSentence, aliases, extraCount);
        }
    }

    const merged = normalizeSpace([firstSentence, extra].filter(Boolean).join(" "));
    return cleanSlice(merged);
}
