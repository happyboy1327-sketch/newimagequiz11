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

// 온전한 종결 어미로 끝나지 않은 짤린 문장 감지
function isIncompleteSentence(sentence) {
    if (!sentence) return true;
    const text = sentence.trim();
    const validEndingRegex = /(다|냐|까|요|죠|자|라|며|음|임|함|됨|성|상|위|중)\.?$/;
    return !validEndingRegex.test(text);
}

// 🌟 [신규] 앞 1~3개 문장을 역추적하여 《...》, <...>, “...” 형태의 작품/책 제목 추출
function findPrecedingTitle(sentences, currentIndex) {
    for (let i = currentIndex - 1; i >= Math.max(0, currentIndex - 3); i--) {
        const prevText = sentences[i];
        if (!prevText) continue;

        // 《...》, <...>, 〈...〉, “...”, "...", '...' 표기 제목 감지
        const titleMatch = prevText.match(/《([^》]+)》|<([^>]+)>|〈([^〉]+)〉|“([^”]+)”|"([^"]+)"|'([^']+)'/);
        if (titleMatch) {
            return titleMatch[0]; // 예: 《세 편의 단편과 열 편의 시》
        }
    }
    return null;
}

// 🌟 [신규] 지칭어(단편 중, 이 중 등)를 추출한 작품 제목으로 자연스럽게 복원
function resolveVagueReference(sentence, foundTitle) {
    if (!foundTitle) return sentence;
    let text = sentence.trim();

    // 1. "이 중", "그 중" -> "《작품명》 중"
    if (/^(이|그)\s*중\b/.test(text)) {
        return text.replace(/^(이|그)\s*중\b/, `${foundTitle} 중`);
    }

    // 2. "단편 중", "작품 중", "두 작품" 등 -> "《작품명》의 단편 중..."
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
    
    const contextBreakRegex = /^(하지만|그러나|그러자|이에|또한|이후|그\s*뒤|한편|그러던\s*중|그리하여|따라서|때문에|이때|그때|이\s*무렵|당시|그해|다만|반면|반면에|반대로|결국|마침내|그렇지만|그럼에도|이로\s*인해|이로써)\b/;
    const relativeSubjectRegex = /^(어머니|아버지|남동생|여동생|형|오빠|누나|언니|아들|딸|부인|아내|남편|할아버지|할머니|손자|손녀)\s+/;
    const deathPattern = /(사망|별세|서거|타계|전사|시해|사사|병사|죽음|숨졌|세상을\s+떠났|생을\s+마감|사사되었|목숨을\s+잃었)/;

    // 🌟 추적 및 보완 대상 지칭 시작어 패턴
    const vagueStartRegex = /^(단편\s*중|작품\s*중|이\s*중|그\s*중|일부|두\s*작품|한\s*작품|이\s*작품|그\s*작품|해당\s*작품|이\s*책|그\s*책)\b/;
    const relativeTimeRegex = /(지난해|올해|지난달|내년|그해|당해|최근에|얼마\s*전)/;

    const scored = sentences.map((sentence, index) => {
        let processedSentence = sentence.trim();
        
        // 🌟 [핵심] 지칭어가 나오면 앞 문장에서 제목을 찾아 문장 보완
        if (vagueStartRegex.test(processedSentence)) {
            const foundTitle = findPrecedingTitle(sentences, index);
            if (foundTitle) {
                // 예: "단편 중 두 작품은..." -> "《작품명》의 단편 중 두 작품은..."
                processedSentence = resolveVagueReference(processedSentence, foundTitle);
            } else {
                // 앞 문장에서도 제목을 못 찾았으면 맥락 결여로 제외
                return { sentence: processedSentence, index, score: -100 };
            }
        }

        // [맥락 파괴 / 짤린 미완성 문장 / 상대 시점 문장 제외]
        if (
            contextBreakRegex.test(processedSentence) ||
            relativeTimeRegex.test(processedSentence) ||
            isIncompleteSentence(processedSentence) ||
            /(칭했다|두었다|슬하|고 한다|라 한다)\.?$/.test(processedSentence) ||
            /^(이|그)\s+([가-힣]+)(이|가|은|는)\s+/.test(processedSentence)
        ) {
            return { sentence: processedSentence, index, score: -100 };
        }

        // [타인 주어 검증]
        if (aliases.length > 0) {
            const subjectMatch = processedSentence.match(/^([가-힣]{2,10})(?:은|는|이|가)\s+/);
            if (subjectMatch) {
                const subjectCandidate = subjectMatch[1].trim();
                const isMainSubject = aliases.some(alias => {
                    if (!alias) return false;
                    const cleanA = alias.replace(/[\s\_\-]/g, "");
                    const cleanS = subjectCandidate.replace(/[\s\_\-]/g, "");
                    return cleanS.includes(cleanA) || cleanA.includes(cleanS);
                });
                const hasMainAliasInSentence = aliases.some(alias => alias && processedSentence.includes(alias));

                if (!isMainSubject && !hasMainAliasInSentence) {
                    return { sentence: processedSentence, index, score: -100 };
                }
            }
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

    const validIntroSentences = introSentences.filter(s => !isIncompleteSentence(s));
    const firstSentence = validIntroSentences[0] || introSentences[0] || "";

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
