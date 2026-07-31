// ==========================================================
// 1. 전역 상수 및 정규식
// ==========================================================
//const IMPORTANT_KEYWORDS = [
   // "태어났다", "출생", "사망", "활동", "독점", "정벌", "발표", "창시", "발명",
    //"발견", "폐지", "수상", "노벨", "대표", "저서", "저자", "작품", "전쟁", "독립", "혁명",
    //"연구", "증명", "설립", "창립", "개발", "제작", "기록", "영향", "업적", "졸업", "도입", "주장",
   // "임명", "취임", "부정", "일기", "수용소", "유대인", "수필", "순국", ", "이토",
   // "히로부미", "옥사", "고문", "투옥", "역임", "주석", "의병", "교육", "망명", "피살", "저항", "만세",
    ///"저술", "집대성", "창안", "고안", "편찬", "집필", "창제", "축조", "개혁", "기여",
    //주도", "총괄", "선출", "달성", "남겼", "남기", "평가받", "일컬어", "불린", "이끌",
    //"가담", "초석", "기틀", "개선", "전개", "주창", "체계화", "정립", "기여하", "성공", "임시정부", "조직",
    //"통일", "멸망", "함락", "정복", "편입", "군현제", "도량형", "만리장성", "분서갱유", "황제", "칭호", "제도", "토목", "능묘", "순행",
    //"개량", "설계", "과학", "기술", "천문", "의학", "수학", "공학", "관측", "발명품", "이론", "법칙", "원리", "측우기", "혼천의", "자격루",
    //"헌신", "보급", "창설", "구제", "지원", "정책", "구호", "봉사", "확산",
  //  "유학", "사상", "성현", "철학", "사상가", "유학자", "성선설", "인", "의", "예", "지", "맹자", "공자", "논어", "대학", "중용", "도덕", "윤리", "경전", "성리학", "실학", "경세", "목민", "실용", "실사구시", "이용후생"
    
      // ==========================================================
      // ==========================================================
// 1. 전처리 및 정제 헬퍼
// ==========================================================

   // ==========================================================
// 1. 전처리 및 정제 헬퍼
// ==========================================================

function removeUnpairedParentheses(str) {
    if (!str) return "";
    const stack = [];
    const toRemove = new Set();
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '(') stack.push(i);
        else if (str[i] === ')') stack.length ? stack.pop() : toRemove.add(i);
    }
    stack.forEach(i => toRemove.add(i));
    return str.split('').filter((_, i) => !toRemove.has(i)).join('');
}

export function cleanWikiText(text) {
    if (!text) return "";
    return removeUnpairedParentheses(
        text
            .replace(/\[\s*\*?\s*\]|\[\d+\]|\[출처\s*필요\]|\[각주\]/g, "")
            .replace(/\((첫|두|세|네|다섯|\d+)\s*번째\)/g, "")
            .replace(/\(\s*\)/g, "")
    )
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

function normalizeSpace(text = "") {
    return String(text)
        .replace(/([.!?。])([가-힣a-zA-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim();
}

const REGEX_LEADING_CONNECTORS = /^(그러나|하지만|그런데|한편|따라서|게다가|반면|이에|이후|결국|그\s*후|또한|그리고),?\s*/;
function cleanLeadingConnectors(sentence) {
    if (!sentence) return "";
    return sentence.replace(REGEX_LEADING_CONNECTORS, "").trim();
}

function removeMetaBySearch(text) {
    if (!text) return "";
    let result = text;

    const hoMetaRegex = /(?<![가-힣])호는\s+[^。.]{1,200}?(?:이다|였다|이었|이며|이고|\.|$)/g;
    result = result.replace(hoMetaRegex, "");

    const keywords = "시호|본관|자|별호|아호|아명|태명|세례명|일명|당호|법명";
    const valToken = `(?:[^\\s,.\\(\\)\\u00B7]+(?:\\([^)]*\\)?)?)`;
    const valPattern = `${valToken}(?:\\s*[·ㆍ]\\s*${valToken})*`;
    
    const keySuffixed = `(?:${keywords})(?:은|는|\\([^)]*\\))`;
    const keyBare = `(?:${keywords})`;
    const singleMeta = `(?<![가-힣])(?:${keySuffixed}\\s*${valPattern}|${keyBare}\\s+${valPattern})`;

    const metaChainRegex = new RegExp(`(?:,\\s*|\\s+)*(?:${singleMeta}(?:,\\s*|\\s+이며|\\s+이고|\\s+)*)+(?:이다|였다|이었다|이며|이고|이자|으로)?`, "g");
    result = result.replace(metaChainRegex, "");

    return result
        .replace(/\(\s*(?:본관|시호|자|아명|일명)[^;)]*;\s*/g, "(")
        .replace(/\.{2,}/g, ".")
        .replace(/\s+\./g, ".")
        .replace(/\s+/g, " ")
        .trim();
}

function isIncompleteSentence(sentence) {
    if (!sentence) return true;
    const cleanEnd = sentence.replace(/[()"'\s.]+$|》/g, "").trim();
    const validEndingRegex = /(?:다|였다|이었다|하였다|됐다|된다|있다|없다|했다|되었다|남겼다|동조하였다|지지하였다|개진시켰다|역임했다|불린다)$/;
    return !validEndingRegex.test(cleanEnd);
}

function splitSentences(text) {
    if (!text || typeof text !== "string") return [];
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
// 2. 키워드 및 타인/TMI 필터링 (주어 생략 보완)
// ==========================================================

const ACHIEVEMENT_REGEX = /(기여|설립|개발|발견|창시|주도|발표|영향|성공|구축|혁명|수상|창립|저술|총괄|개혁|정립|주창|체계화|확산|보급|창안|집대성|기틀|초석|승리|평정|확장|창시자|개척자|아버지|대표|중요한|업적|연구|논문|작품|창작|발명|개진|동조|지지|해석|반대|논쟁|부활|수로도|관측|역임|소설가|작가|문학|소설|시인|화가|음악가|철학자|사상가|정치가|과학자|물리학자|수학자|교수|활동|집필|출판|발간|언론인|기자|활동을|작업|완성)/;

// TMI / 단순 출생/가족 관련 정제 대상
const HARD_NOISE_REGEX = /(의\s*(?:아들|딸|손자|손녀|부인|아내|남편|부친|모친|차남|장남|자녀|후손|부모)|결혼하|슬하에|일화|여담|소문|전해진다|체육관|유적|오차가\s*생긴다|차이를\s*보이고|이설이\s*있다|태어나|유학을|출생하였다|여행을|구글|두들|기념하여|제작되었다|생일을)/;

// 🎯 [핵심 수정] 주어가 생략된 한국어 문장도 잘리지 않고 정상 유지되도록 수정
function filterOtherPerson(rawSentences, aliases = []) {
    if (!Array.isArray(rawSentences) || rawSentences.length === 0) return [];

    return rawSentences.filter((sentence, index) => {
        const text = sentence.trim();
        if (!text) return false;
        if (index === 0) return true;

        // TMI 또는 타인 관련 가족 서술 문장은 탈락
        if (HARD_NOISE_REGEX.test(text)) return false;

        // 주어가 생략되었거나 대명사/본인 이름이 포함된 문장 모두 통과
        return true;
    });
}

function getDocumentKeywords(text, topN = 12) {
    if (!text) return [];
    const words = text.match(/[가-힣a-zA-Z0-9]{2,}/g) || [];
    const stopWords = new Set([
        "대한", "경우", "관한", "통해", "위해", "따라", "또한", "그리고", "하지만", "이후", 
        "당시", "것이다", "속해", "의해", "있다", "없다", "되어", "하여", "있는", "하는",
        "사람", "하나", "가지", "자신의", "위해", "때문", "관련", "기록", "기록되어", "차이를"
    ]);
    const freqMap = {};
    for (const w of words) {
        if (!stopWords.has(w)) {
            freqMap[w] = (freqMap[w] || 0) + 1;
        }
    }
    return Object.keys(freqMap)
        .sort((a, b) => freqMap[b] - freqMap[a])
        .slice(0, topN);
}

// ==========================================================
// 3. 메인 요약 생성 로직
// ==========================================================

export function extractImportantSentences(bodyText, introText = "", aliases = [], count = 3) {
    if (!bodyText || typeof bodyText !== "string") return "";

    const cleanedBody = removeMetaBySearch(cleanWikiText(bodyText));
    let rawSentences = splitSentences(cleanedBody);

    if (aliases && aliases.length > 0) {
        rawSentences = filterOtherPerson(rawSentences, aliases);
    }

    const totalCount = rawSentences.length;
    if (totalCount === 0) return "";

    const docKeywords = getDocumentKeywords(cleanedBody + " " + introText, 12);
    const scoredCandidates = [];

    for (let index = 0; index < totalCount; index++) {
        let text = rawSentences[index].trim();
        const len = text.length;

        if (len < 12 || len > 350) continue;
        if (isIncompleteSentence(text)) continue;
        if (HARD_NOISE_REGEX.test(text)) continue;

        let score = 10;

        // 🎯 [핵심 수정] 하드 필터링 대신 높은 가산점 제공으로 문장 증발 방지
        if (ACHIEVEMENT_REGEX.test(text)) score += 40;

        let keywordHits = 0;
        docKeywords.forEach(kw => {
            if (text.includes(kw)) keywordHits++;
        });
        score += keywordHits * 10;

        if (len >= 30 && len <= 180) score += 10;

        scoredCandidates.push({
            sentence: text,
            index: index,
            score: score
        });
    }

    if (scoredCandidates.length === 0) return "";

    scoredCandidates.sort((a, b) => b.score - a.score);
    const selected = scoredCandidates.slice(0, count);
    selected.sort((a, b) => a.index - b.index);

    return selected
        .map((item, idx) => idx === 0 ? item.sentence : cleanLeadingConnectors(item.sentence))
        .join(" ");
}

export function buildDescription(introText, bodyText, aliases = [], extraCount = 2, introThreshold = 150, maxLength = 630) { 
    let introClean = removeMetaBySearch(cleanWikiText(introText));
    let bodyClean = removeMetaBySearch(cleanWikiText(bodyText));

    if (introClean && aliases.length > 0) {
        const introSentences = splitSentences(introClean);
        introClean = filterOtherPerson(introSentences, aliases).join(" ");
    }
    if (bodyClean && aliases.length > 0) {
        const bodySentences = splitSentences(bodyClean);
        bodyClean = filterOtherPerson(bodySentences, aliases).join(" ");
    }

    let intro = normalizeSpace(introClean || "");
    let body = normalizeSpace(bodyClean || "");

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

    const introSentences = splitSentences(intro).filter(Boolean);
    const selectedIntroSentences = [];

    if (introSentences.length > 0) {
        if (!isIncompleteSentence(introSentences[0])) {
            selectedIntroSentences.push(introSentences[0]);
        }

        for (let i = 1; i < introSentences.length; i++) {
            const sentence = introSentences[i];
            const currentLen = selectedIntroSentences.join(" ").length;

            if (currentLen >= 220 || selectedIntroSentences.length >= 2) break;

            if (!isIncompleteSentence(sentence) && !HARD_NOISE_REGEX.test(sentence)) {
                selectedIntroSentences.push(cleanLeadingConnectors(sentence));
            }
        }
    }

    const introResultText = selectedIntroSentences.join(" ");
    const remainingIntro = introSentences.slice(selectedIntroSentences.length).filter(Boolean).join(" ");
    const targetBody = normalizeSpace([remainingIntro, body].filter(Boolean).join(" "));

    let extra = "";
    if (targetBody && targetBody.length > 10) {
        extra = extractImportantSentences(targetBody, introResultText, aliases, extraCount);
    }

    const merged = normalizeSpace([introResultText, extra].filter(Boolean).join(" "));
    return cleanSlice(merged);
}        
