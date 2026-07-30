// ==========================================================
// 1. 전역 상수 및 정규식 사전 컴파일 (성능 최적화 핵심)
// ==========================================================
const IMPORTANT_KEYWORDS = [
    "태어났다", "출생", "사망", "활동", "노력", "독점", "정벌", "발표", "창시", "발명",
    "발견", "폐지", "수상", "노벨", "대표", "저서", "저자", "작품", "전쟁", "독립", "혁명",
    "연구", "증명", "설립", "창립", "개발", "제작", "기록", "영향", "업적", "졸업", "도입", "주장",
    "임명", "취임", "부정", "일기", "수용소", "유대인", "수필", "순국", "3.1운동", "3.1 운동", "이토",
    "히로부미", "옥사", "고문", "투옥", "역임", "주석", "의병", "교육", "망명", "피살", "저항", "만세",
    "저술", "집대성", "창안", "고안", "편찬", "집필", "창제", "축조", "개혁", "기여",
    "주도", "총괄", "선출", "달성", "남겼", "남기", "평가받", "일컬어", "불린", "이끌",
    "가담", "초석", "기틀", "개선", "전개", "주창", "체계화", "정립", "기여하", "성공",
    "통일", "멸망", "함락", "정복", "편입", "군현제", "도량형", "만리장성", "분서갱유", "황제", "칭호", "제도", "토목", "능묘", "순행", "붕어",
    "개량", "설계", "과학", "기술", "천문", "의학", "수학", "공학", "관측", "발명품", "이론", "법칙", "원리", "측우기", "혼천의", "자격루",
    "헌신", "보급", "창설", "구제", "지원", "정책", "구호", "봉사", "확산",
    "유학", "사상", "성현", "철학", "사상가", "유학자", "성선설", "인", "의", "예", "지", "맹자", "공자", "논어", "대학", "중용", "도덕", "윤리", "경전", "성리학", "실학", "경세", "목민", "실용", "실사구시", "이용후생"
];

// 🚀 최적화: 80개 키워드를 일일이 .includes()하지 않고, 단일 정규식으로 한 번에 매칭 횟수 계산
const KEYWORD_REGEX = new RegExp(IMPORTANT_KEYWORDS.join('|'), 'g');

const GENEALOGY_REGEX = /(의\s*(?:아들|딸|손자|손녀|부인|아내|남편|부친|모친|차남|장남|차녀|장녀|자녀|후손)(?:이다|이었다|이며|이고|으로서)?|슬하에|결혼하(?:여|였|고)|결혼했(?:다)?)/;

const NUTRITION_REGEX = /(독립|전투|(?:독립|만세|민주화)?운동(?!\s*장)|학설|발명|발견|창시|개혁|통일|건국|재위|집권|해방|혁명|사상|학파|저서|대표작|노벨상|원소|정리|공식|전쟁|함락|전승|수상|발표|설립|창립|개발|발명가|순국|고문|정복|멸망|편입|군현제|도량형|만리장성|분서갱유|황제|칭호|제도|토목|능묘|순행|붕어|고안|제작|창제|개량|설계|과학|기술|천문|의학|수학|공학|헌신|보급|창설|주창|구제|지원|관측|발명품|이론|법칙|원리|측우기|혼천의|자격루|유학|철학|성현|사상가|유학자|성선설|경전|성리학|실학|경세|목민|실용|실사구시|이용후생|(?!(?:여론|결론|방법론))(?:[가-힣]+론)|(?:[가-힣]+주의))/;

const MINOR_TMI_REGEX = /(돌아와서|자제해|마부|수레|점점|은퇴|노년|보냈|생활했|향리|소일|이름을\s*딴|체육관|유적)/;
const DANGLING_START_REGEX = /^(이(후|러한|와\s+같이)?|따라서|이에|반면)\b/;

const NAME_ORIGIN_REGEX = /(이름은?\s*.*?(?:유래|뜻|불리다|붙이다|개명|바꾸다)|호는?\s*.*?(?:유래|뜻|불리다|칭하다))/;
const NAME_CHANGE_REGEX = /(이름을\s*(?:바꾸다|개명하다|칭하다)|~에서\s*~로\s*(?:개명|변경))/;


// ==========================================================
// 1. 호(號) 전용 초정밀 정규식 추가 또 안되긴만 해봐 ㅅㅂ
// ==========================================================
const HO_META_REGEX = /((?<![가-힣])호는\s+[^。.]{1,200}?(?:이다|였다|이었|이며|이고|\.|$)/; 
// ==========================================================
// 2. 저서명 추출 함수 추가
// ==========================================================
function extractBookTitles(text) {
    const titles = [];
    const regex = /《([^》]+)》/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        titles.push(match[1]);
    }
    return titles;
}

// ==========================================================
// 3. 전처리 함수 (호 메타 제거 추가)
// ==========================================================
function normalizeSpace(text = "") {
    return String(text)
        .replace(/([.!?。])([가-힣a-zA-Z])/g, "$1 $2")  // 문장부호 뒤 공백 강제
        .replace(/\s+/g, " ")
        .trim();
}

function removeMetaBySearch(text) {
    if (!text) return "";
    let result = text;

    // 🎯 호(號) 메타 정보 전용 제거
    result = result.replace(HO_META_REGEX, "");

    // 기존 메타 정보 제거 (본관, 자, 시호 등)
    const keywords = "본관|자|별호|아호|아명|태명|세례명|일명|당호|시호|법명|성명";
    const keyPattern = `(?<![가-힣])(?:${keywords})(?:은|는|\\([^)]*\\))`;
    const valToken = `(?:[^\\s,.\\(\\)\\u00B7]+(?:\\([^)]*\\))?)`; 
    const valPattern = `${valToken}(?:\\s*[·ㆍ]\\s*${valToken})*`;
    const singleMeta = `${keyPattern}\\s+${valPattern}`;

    const metaChainRegex = new RegExp(
        `(?:,\\s*|\\s+)*(?:${singleMeta}(?:,\\s*|\\s+이며|\\s+이고|\\s+)*)+(?:이다|였다|이었다|이며|이고|이자|으로)?`,
        "g"
    );
    result = result.replace(metaChainRegex, "");

    // 찌꺼기 정리
    result = result
        .replace(/([\.!\?])\s*(?:이었(?:으며|지만|으나|다)?|였(?:으며|지만|으나|다)?|이며|이고|이자|으로|며|는데|지만|으나)\.?/g, "$1")
        .replace(/\.{2,}/g, ".")
        .replace(/,\s*\./g, ".")
        .replace(/\s+\./g, ".")
        .replace(/\s+/g, " ")
        .trim();

    return result;
}

function cleanWikiText(text) {
    if (!text) return "";
    return text
        .replace(/\[\s*\*?\s*\]|\[\d+\]|\[출처\s*필요\]|\[각주\]/g, "")
        .replace(/\((첫|두|세|네|다섯|\d+)\s*번째\)/g, "")
        .replace(/^(첫째|둘째|셋째|넷째|다섯째|마지막으로|우선|먼저|또한|그리고),?\s*/g, "")
        .replace(/\(\s*\)/g, "")
        .replace(/\s+/g, " ")
        .replace(/\s+\./g, ".")
        .trim();
}

function isIncompleteSentence(sentence) {
    if (!sentence) return true;
    const text = sentence.trim();
    const validEndingRegex = /(다|냐|까|요|죠|라|며|음|임|함|됨|성|상|위|중)\.?$/;
    return !validEndingRegex.test(text);
}

function findPrecedingTitle(sentences, currentIndex) {
    for (let i = currentIndex - 1; i >= Math.max(0, currentIndex - 3); i--) {
        const prevText = sentences[i];
        if (!prevText) continue;
        const titleMatch = prevText.match(/《([^》]+)》|<([^>]+)>|〈([^〉]+)〉|"([^"]+)"|'([^']+)'/);
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

function filterOtherPersonDeath(text, aliases = []) {
    if (!text) return "";
    const sentences = splitSentences(text);
    const cleanSentences = sentences.filter((sentence, index) => {
        if (index === 0) return true;

        const match = sentence.match(/([가-힣a-zA-Z\s]{2,20})(?:이|가|은|는).*?(?:사망|별세|서거|타계|전사|시해|사사|병사|처형|살해|숨졌|목숨을\s*잃)/);
        if (match) {
            const subjectName = match[1].trim();
            const isPronounOrContext = /^(그|그녀|본인|이들|해당\s*인물|이\s*인물)$/.test(subjectName) || /년|월|일|수용소|당시/.test(subjectName);

            if (!isPronounOrContext) {
                const isSelf = aliases.some(alias => {
                    if (!alias) return false;
                    const cleanAlias = alias.replace(/[\s_\-]/g, "");
                    const cleanSubject = subjectName.replace(/[\s_\-]/g, "");
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


 // ==========================================================
// 4. 스코어링 로직 수정 (저서명 연관 문장 우선 선택)
// ==========================================================
export function extractImportantSentences(bodyText, introText = "", aliases = [], count = 3) {
    if (!bodyText || typeof bodyText !== "string") return "";

    let cleanedBody = removeMetaBySearch(cleanWikiText(bodyText));
    if (aliases && aliases.length > 0) {
        cleanedBody = filterOtherPersonDeath(cleanedBody, aliases);
    }

    const rawSentences = splitSentences(cleanedBody);
    const totalCount = rawSentences.length;
    if (totalCount === 0) return "";

    // 📚 본문에서 저서명 추출
    const bookTitles = extractBookTitles(cleanedBody);

    const cleanedSentences = [];

    rawSentences.forEach((sentence, index) => {
        let text = sentence.trim();
        if (!text || text.length < 15 || text.length > 400) return;
        if (isIncompleteSentence(text)) return;

        let processedText = text;
        let targetIndex = index;

        if (DANGLING_START_REGEX.test(processedText) && index > 0) {
            const prevText = rawSentences[index - 1];
            if (prevText && !isIncompleteSentence(prevText) && prevText.length >= 10 && prevText.length <= 150) {
                processedText = `${prevText} ${processedText}`;
                targetIndex = index - 1;
            } else {
                return;
            }
        } else {
            processedText = resolveDemonstrativeReference(processedText, rawSentences, index);
        }
        processedText = processedText.replace(/^(첫째|둘째|셋째|넷째|다섯째|마지막으로|우선|먼저|또한|그리고|한편|다음으로|결국),?\s*/g, "");
        // 제거 후 다시 공백 정리        
        processedText = processedText.trim();        
        // 길이가 너무 짧아졌으면 스킵        
        if (processedText.length < 15) return; 

        cleanedSentences.push({
            original: processedText,
            index: targetIndex
        });
    });

    if (cleanedSentences.length === 0) return "";

    // 스코어링
    const scoredCandidates = cleanedSentences.map(({ original, index }) => {
        let score = 10;

        if (NUTRITION_REGEX.test(original)) score += 20;

        const keywordMatches = original.match(KEYWORD_REGEX);
        if (keywordMatches) {
            score += keywordMatches.length * 5;
        }

        // 🎯 [핵심] 저서명이 언급된 문장은 무조건 고득점 (+30)
        if (bookTitles.some(title => original.includes(title))) {
            score += 30;
        }

        // 과학자 발명품 언급
        if (/자격루|측우기|혼천의|앙부일구|거북선|활자/.test(original)) {
            score += 25;
        }

        if (NAME_ORIGIN_REGEX.test(original)) score -= 15;
        if (!NUTRITION_REGEX.test(original) && GENEALOGY_REGEX.test(original)) score -= 50;
        if (MINOR_TMI_REGEX.test(original)) score -= 30;
        if (original.length >= 25 && original.length <= 150) score += 5;

        return { sentence: original, index, score };
    });

    // 구역 분할 및 선별
    const boundary1 = Math.floor(totalCount / 3);
    const boundary2 = Math.floor((totalCount * 2) / 3);

    const zones = [{ candidates: [] }, { candidates: [] }, { candidates: [] }];
    scoredCandidates.forEach(item => {
        if (item.index < boundary1) zones[0].candidates.push(item);
        else if (item.index < boundary2) zones[1].candidates.push(item);
        else zones[2].candidates.push(item);
    });

    // 가장 중요한 문장이 많은 구역 찾기
    let maxZoneIndex = 0;
    let maxCount = -1;
    zones.forEach((zone, idx) => {
        if (zone.candidates.length > maxCount) {
            maxCount = zone.candidates.length;
            maxZoneIndex = idx;
        }
    });

    const selected = [];
    const seen = new Set();
    const zoneLimit = count > 1 ? Math.min(Math.max(1, Math.ceil(count * 0.7)), count - 1) : count;

    zones[maxZoneIndex].candidates.sort((a, b) => b.score - a.score);
    for (const item of zones[maxZoneIndex].candidates) {
        if (!seen.has(item.sentence)) {
            seen.add(item.sentence);
            selected.push(item);
            if (selected.length >= zoneLimit) break;
        }
    }

    const remaining = [];
    zones.forEach(zone => remaining.push(...zone.candidates));
    remaining.sort((a, b) => b.score - a.score);

    for (const item of remaining) {
        if (selected.length >= count) break;
        if (!seen.has(item.sentence)) {
            seen.add(item.sentence);
            selected.push(item);
        }
    }

    selected.sort((a, b) => a.index - b.index);
    return selected.map(item => item.sentence).join(" ");
}

// ==========================================================
// 6. 최종 빌드 함수
// ==========================================================
export function buildDescription(introText, bodyText, aliases = [], extraCount = 4, introThreshold = 150, maxLength = 1100) { 
    let intro = removeMetaBySearch(cleanWikiText(introText));
    let body = removeMetaBySearch(cleanWikiText(bodyText));

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
        const fallback = normalizeSpace(removeMetaBySearch(cleanWikiText(introText) || cleanWikiText(bodyText)));
        if (!fallback) return "";
        return cleanSlice(fallback);
    }

    const totalLength = intro.length + body.length;
    if (totalLength < 350) {
        return cleanSlice(normalizeSpace([intro, body].filter(Boolean).join(" ")));
    }

    const introSentences = splitSentences(intro).filter(Boolean);
    let firstSentence = introSentences[0] || "";
    let usedSecondSentence = false;

    const realFirstSentenceLength = firstSentence.replace(/\([^)]*\)/g, "").trim().length;
    const secondSentence = introSentences[1] || "";
    const isGenealogyTMI = GENEALOGY_REGEX.test(secondSentence);

    if (!isGenealogyTMI && secondSentence) {
        if (realFirstSentenceLength < 50 && introSentences.length > 1) {
            firstSentence += " " + secondSentence;
            usedSecondSentence = true;
        } else if (introSentences.length > 1 && /(창시자|제정|대표|설립|창립|발명|발견|창안|업적|노벨|수상|혁명|독립|순국|고문|시위|3\.1|운동)/.test(secondSentence)) {
            firstSentence += " " + secondSentence;
            usedSecondSentence = true;
        }
    }

    let extra = "";
    const remainingIntro = introSentences.slice(usedSecondSentence ? 2 : 1).filter(Boolean).join(" ");
    const targetBody = normalizeSpace([remainingIntro, body].filter(Boolean).join(" "));

    if (targetBody && targetBody.length > 12) {
        extra = extractImportantSentences(targetBody, "", aliases, extraCount);
    }

    const merged = normalizeSpace([firstSentence, extra].filter(Boolean).join(" "));
    return cleanSlice(merged);
}
