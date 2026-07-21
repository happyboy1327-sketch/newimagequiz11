const IMPORTANT_KEYWORDS = [
    "태어났다", "출생", "사망", "활동", "노력", "독점", "정벌", "발표", "창시", "발명",
    "발견", "폐지", "수상", "노벨", "대표", "저서", "작품", "전쟁", "독립", "혁명",
    "연구", "증명", "설립", "창립", "개발", "제작", "기록", "영향", "업적", "졸업",
    "임명", "취임", "부정"
];

const GENEALOGY_REGEX = /(의\s*(아들|딸|손자|손녀|부인|아내|남편|부친|모친|차남|장남|차녀|장녀)(이다|이었다|이며|이고|\s|\.))|(슬하에)|(결혼하(여|였|고))|(출생하|태어났)/;
const NUTRITION_REGEX = /(독립|전투|운동|학설|발명|발견|창시|개혁|통일|건국|재위|집권|해방|혁명|사상|학파|저서|대표작|노벨상|원소|정리|공식|전쟁|함락|승리|패배|결성|폐지|창립|설립|의병|관찰사|벼슬|임진왜란)/;
const MINOR_TMI_REGEX = /(돌아와서|자제해|마부|수레|점점|은퇴|노년|보냈|생활했|향리|소일)/;

// 🌟 [추가] 앞 맥락 없이는 의미가 깨지는 단독 지시어/연결어 시작 문장 차단
const DANGLING_START_REGEX = /^(이(후|러한|와\s+같이)?|따라서|이에|반면|이\s+[가-힣]+[이가은는을를의에서로도]?)\b/;
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

function resolveDemonstrativeReference(sentence, sentences, currentIndex) {
    let processedSentence = sentence;
    const targetRegex = /(이|그)\s+(작품|조각|그림|회화|동상|건축물|벽화|서적|책|화풍|시리즈|주장|사상|이론|업적|시기|운동|전쟁)/;
    
    if (targetRegex.test(processedSentence)) {
        let foundTitle = null;
        for (let j = currentIndex - 1; j >= Math.max(0, currentIndex - 3); j--) {
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
    return processedSentence;
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

function calculateBasicNutritionScore(sentence) {
    let score = 0;
    if (NUTRITION_REGEX.test(sentence)) score += 20;
    IMPORTANT_KEYWORDS.forEach(kw => {
        if (sentence.includes(kw)) score += 5;
    });
    return score;
}

export function extractImportantSentences(bodyText, introText = "", aliases = [], count = 2) {
    if (!bodyText || typeof bodyText !== "string") return "";

    const rawSentences = splitSentences(bodyText);
    const cleanedSentences = [];

    rawSentences.forEach((sentence, index) => {
        let text = cleanWikiText(sentence);
        if (!text || isIncompleteSentence(text)) return;

        if (/^[《<〈“"'`].*[》>〉”"'`]$/.test(text)) return;
        if (text.length < 15 || text.length > 200) return;

        let processedText = text;
        let targetIndex = index;

        if (DANGLING_START_REGEX.test(processedText) && index > 0) {
            const prevText = cleanWikiText(rawSentences[index - 1]);
            if (prevText && !isIncompleteSentence(prevText) && prevText.length >= 10 && prevText.length <= 150) {
                processedText = `${prevText} ${processedText}`;
                targetIndex = index - 1;
            } else {
                return;
            }
        } else if (/^(이|그)\s*중\b/.test(processedText) || !/^[가-힣a-zA-Z0-9\s《<〈“"'\(\)]+(이|가|은|는|을|를|의|에|에서)/.test(processedText)) {
            const foundTitle = findPrecedingTitle(rawSentences, index);
            if (foundTitle) {
                processedText = resolveVagueReference(processedText, foundTitle);
            } else {
                return;
            }
        } else {
            processedText = resolveDemonstrativeReference(processedText, rawSentences, index);
        }

        if (processedText.length > 300) return;

        cleanedSentences.push({ original: processedText, index: targetIndex });
    });

    if (cleanedSentences.length === 0) return "";

    const candidates = cleanedSentences.map(({ original, index }) => {
        let score = 10;
        
        if (NUTRITION_REGEX.test(original)) score += 20;
        IMPORTANT_KEYWORDS.forEach(kw => {
            if (original.includes(kw)) score += 5;
        });

        if (!NUTRITION_REGEX.test(original) && GENEALOGY_REGEX.test(original)) {
            score -= 50;
        }

        if (MINOR_TMI_REGEX.test(original)) {
            score -= 30;
        }

        if (original.length >= 25 && original.length <= 150) score += 5;

        return { sentence: original, index, score };
    });

    candidates.sort((a, b) => b.score - a.score);
    
    const seen = new Set();
    const uniqueCandidates = [];
    for (const item of candidates) {
        if (!seen.has(item.sentence)) {
            seen.add(item.sentence);
            uniqueCandidates.push(item);
            if (uniqueCandidates.length >= count) break;
        }
    }

    uniqueCandidates.sort((a, b) => a.index - b.index);

    return uniqueCandidates.map(item => item.sentence).join(" ");
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

    const introSentences = splitSentences(intro);
    let firstSentence = introSentences[0] || "";
    if (firstSentence.length < 50 && introSentences.length > 1) {
        firstSentence = `${introSentences[0]} ${introSentences[1]}`;
    }

    let extra = "";
    const remainingIntro = introSentences.slice(firstSentence.includes(introSentences[1] || "") ? 2 : 1).join(" ");
    const targetBody = normalizeSpace([remainingIntro, body].filter(Boolean).join(" "));

    if (targetBody && targetBody.length > 20) {
        extra = extractImportantSentences(targetBody, extraCount);
    }

    const merged = normalizeSpace([firstSentence, extra].filter(Boolean).join(" "));
    return cleanSlice(merged);
}
