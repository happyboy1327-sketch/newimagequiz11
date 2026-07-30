const IMPORTANT_KEYWORDS = [
    "태어났다", "출생", "사망", "활동", "노력", "독점", "정벌", "발표", "창시", "발명",
    "발견", "폐지", "수상", "노벨", "대표", "저서", "저자", "작품", "전쟁", "독립", "혁명",
    "연구", "증명", "설립", "창립", "개발", "제작", "기록", "영향", "업적", "졸업", "도입", "주장",
    "임명", "취임", "부정", "일기", "수용소", "유대인", "수필", "순국", "3.1운동", "3.1 운동", "이토",
    "히로부미", "옥사", "고문", "투옥", "역임", "주석", "의병", "교육", "망명", "피살", "저항", "만세"
];

const META_RE = /(자는|자\(字\)는|호는|호\(號\)는|아호는|아명은|아명|본관|태명|태명은|세례명은|일명은|본관은|당호|시호)/;
const GENEALOGY_REGEX = /(의\s*(?:아들|딸|손자|손녀|부인|아내|남편|부친|모친|차남|장남|차녀|장녀|자녀|후손)(?:이다|이었다|이며|이고|으로서)?|슬하에|결혼하(?:여|였|고)|결혼했(?:다)?)/;

// 🌟 [수정] '운동장' 등 장소 명칭을 제외하도록 룩어헤드(?!\s*장) 적용 및 '순국', '고문' 추가
const NUTRITION_REGEX = /(독립|전투|(?:독립|만세|민주화)?운동(?!\s*장)|학설|발명|발견|창시|개혁|통일|건국|재위|집권|해방|혁명|사상|학파|저서|대표작|노벨상|원소|정리|공식|전쟁|함락|전승|수상|발표|설립|창립|개발|발명가|순국|고문)/;
// 🌟 [수정] 체육관, 유적, 이름을 딴 등 단순 기념 시설 TMI 감점 추가
const MINOR_TMI_REGEX = /(돌아와서|자제해|마부|수레|점점|은퇴|노년|보냈|생활했|향리|소일|이름을\s*딴|체육관|유적)/;
const DANGLING_START_REGEX = /^(이(후|러한|와\s+같이)?|따라서|이에|반면)\b/;

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

function removeMetaBySearch(text) {
    const keywords = [
        "본관",
        "아명",
        "태명",
        "세례명",
        "일명",
        "자는",
        "자(字)",
        "호",
        "아호",
        "당호",
        "시호"
    ];

    let result = text;

    for (const key of keywords) {
        let index = result.indexOf(key);

        while (index !== -1) {
            let start = index;

            // 키워드 앞 쉼표까지 포함
            if (start > 0 && result[start - 1] === ",") {
                start--;
            }

            // 다음 쉼표 찾기
            let end = result.indexOf(",", index);

            if (end === -1) {
                // 문장 끝이면 끝까지 제거
                result = result.slice(0, start);
            } else {
                result = result.slice(0, start) + result.slice(end + 1);
            }

            result = result.trim();

            index = result.indexOf(key);
        }
    }

    return result
        .replace(/,\s*,/g, ",")
        .replace(/^\s*,/, "")
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
        if (titleMatch) return titleMatch[0];
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

// 🌟 [수정] 문장 분리 함수 안전화 적용
function filterOtherPersonDeath(text, aliases = []) {
    if (!text) return "";
    const sentences = splitSentences(text);
    const cleanSentences = sentences.filter(sentence => {
        const match = sentence.match(/([가-힣\s]{2,12})(?:이|가|은|는).*?(?:사망|별세|서거|타계|전사|시해|사사|병사|처형|살해|숨졌|목숨을\s*잃)/);
        if (match) {
            const subjectName = match[1].trim();
            const isPronounOrContext = /^(그|그녀|본인|이들|해당\s*인물|이\s*인물)$/.test(subjectName) || /년|월|일|수용소|당시/.test(subjectName);

            if (!isPronounOrContext) {
                const isSelf = aliases.some(alias => {
                    if (!alias) return false;
                    const cleanAlias = alias.replace(/[\s\_\-]/g, "");
                    const cleanSubject = subjectName.replace(/[\s\_\-]/g, "");
                    return cleanSubject.includes(cleanAlias) || cleanAlias.includes(cleanSubject);
                });
                if (!isSelf) return false;
            }
        }

        const possessiveDeathRegex = /((아버지|부친|어머니|모친|아내|부인|남편|아들|딸|형|동생|스승|친구|동료|통역가)의\s*(사망|별세|서거|타계|처형|죽음))/;
        if (possessiveDeathRegex.test(sentence) && !/(그녀|그|본인|가족|식구|모두|함께)/.test(sentence)) {
            return false;
        }

        return true;
    });
    return cleanSentences.join(" ");
}

// 🌟 [수정] 숫자/날짜 속 마침표(3.1, 1902.12.16 등)를 잘라먹지 않도록 정규식 강화
function splitSentences(text) {
    const normalized = normalizeSpace(text).replace(/\n+/g, " ");
    return normalized
        .split(/(?<!\b[a-zA-Z]|\d)([.!?。])(?=\s+|$)/)
        .reduce((acc, curr, index, array) => {
            if (index % 2 === 0) {
                const punctuation = array[index + 1] || "";
                const sentence = (curr + punctuation).trim();
                if (sentence) acc.push(sentence);
            }
            return acc;
        }, []);
}

export function extractImportantSentences(bodyText, introText = "", aliases = [], count = 3) {
    if (!bodyText || typeof bodyText !== "string") return "";

    const rawSentences = splitSentences(bodyText);
    const cleanedSentences = [];

    rawSentences.forEach((sentence, index) => {
        let text = cleanWikiText(sentence);

        if (!text || isIncompleteSentence(text)) return;
        if (/^[《<〈“"'`].*[》>〉”"'`]$/.test(text)) return;
        if (text.length < 15) return;

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
        } else if (/^(이|그)\s*중\b/.test(processedText)) {
            const foundTitle = findPrecedingTitle(rawSentences, index);
            if (foundTitle) {
                processedText = resolveVagueReference(processedText, foundTitle);
            } else {
                return;
            }
        } else {
            processedText = resolveDemonstrativeReference(processedText, rawSentences, index);
        }

        if (processedText.length > 400) return;

       processedText = removeMetaBySearch(processedText);

    if (!processedText) return;
        
        cleanedSentences.push({ original: processedText, index: targetIndex });
    });

    if (cleanedSentences.length === 0) return "";

    const candidates = cleanedSentences.map(({ original, index }) => {
        let score = 10;

        if (NUTRITION_REGEX.test(original)) score += 20;
        IMPORTANT_KEYWORDS.forEach(kw => {
            if (original.includes(kw)) score += 5;
        });

        if (!NUTRITION_REGEX.test(original) && GENEALOGY_REGEX.test(original)) score -= 50;
        if (MINOR_TMI_REGEX.test(original)) score -= 30;
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
    extraCount = 4,
    introThreshold = 150,
    maxLength = 1100
) {
    let intro = cleanWikiText(introText);
    let body = cleanWikiText(bodyText);

    if (intro && aliases.length > 0) intro = filterOtherPersonDeath(intro, aliases);
    if (body && aliases.length > 0) body = filterOtherPersonDeath(body, aliases);

    intro = normalizeSpace(intro || "");
    body = normalizeSpace(body || "");

    const cleanSlice = (text) => {
        if (text.length <= maxLength) return text;
        const sliced = text.slice(0, maxLength);
        const lastPeriod = sliced.lastIndexOf(".");
        if (lastPeriod > maxLength * 0.5) {
            return sliced.slice(0, lastPeriod + 1).trim();
        }
        return sliced;
    };

    if (!intro && !body) {
        const fallback = normalizeSpace(cleanWikiText(introText) || cleanWikiText(bodyText));
        if (!fallback) return "";
        return cleanSlice(fallback);
    }

    const totalLength = intro.length + body.length;
    if (totalLength < 350) {
        const combined = normalizeSpace([intro, body].filter(Boolean).join(" "));
        return cleanSlice(combined);
    }

    const introSentences = splitSentences(intro);
    let firstSentence = introSentences[0] || "";
    let usedSecondSentence = false;

    // 🌟 [수정] 한자/생몰년 괄호를 빼고 계산한 '실질 텍스트 길이' 기준 적용
    const realFirstSentenceLength = firstSentence.replace(/\([^)]*\)/g, "").trim().length;

    const secondSentence = introSentences[1] || "";
    const isGenealogyTMI = GENEALOGY_REGEX.test(secondSentence);

    if (!isGenealogyTMI && secondSentence) {
        if (realFirstSentenceLength < 50 && introSentences.length > 1) {
            firstSentence += " " + secondSentence;
            usedSecondSentence = true;
        } else if (
            introSentences.length > 1 &&
            /(창시자|제정|대표|설립|창립|발명|발견|창안|업적|노벨|수상|혁명|독립|순국|고문|시위|3\.1|운동)/.test(secondSentence)
        ) {
            firstSentence += " " + secondSentence;
            usedSecondSentence = true;
        }
    }

    let extra = "";
    const remainingIntro = introSentences
        .slice(usedSecondSentence ? 2 : 1)
        .join(" ");
    const targetBody = normalizeSpace([remainingIntro, body].filter(Boolean).join(" "));

    if (targetBody && targetBody.length > 12) {
        extra = extractImportantSentences(
            targetBody,
            "",
            aliases,
            extraCount
        );
    }

    const merged = normalizeSpace([firstSentence, extra].filter(Boolean).join(" "));
    return cleanSlice(merged);
}
