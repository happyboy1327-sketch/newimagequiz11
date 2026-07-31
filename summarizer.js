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
    const keyPattern = `(?<![가-힣])(?:${keywords})(?:은|는|\\([^)]*\\))?`;
    const valToken = `(?:[^\\s,.\\(\\)\\u00B7]+(?:\\([^)]*\\)?)?)`;
    const valPattern = `${valToken}(?:\\s*[·ㆍ]\\s*${valToken})*`;
    const singleMeta = `${keyPattern}\\s*${valPattern}`;

    const metaChainRegex = new RegExp(`(?:,\\s*|\\s+)*(?:${singleMeta}(?:,\\s*|\\s+이며|\\s+이고|\\s+)*)+(?:이다|였다|이었다|이며|이고|이자|으로)?`, "g");
// ==========================================================
// 1. �꾩쿂由� 諛� �뺤젣 �ы띁
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
            .replace(/\[\s*\*?\s*\]|\[\d+\]|\[異쒖쿂\s*�꾩슂\]|\[媛곸＜\]/g, "")
            .replace(/\((泥�|��|��|��|�ㅼ꽢|\d+)\s*踰덉㎏\)/g, "")
            .replace(/\(\s*\)/g, "")
    )
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

function normalizeSpace(text = "") {
    return String(text)
        .replace(/([.!?��])([媛�-�즑-zA-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim();
}

const REGEX_LEADING_CONNECTORS = /^(洹몃윭��|�섏�留�|洹몃윴��|�쒗렪|�곕씪��|寃뚮떎媛�|諛섎㈃|�댁뿉|�댄썑|寃곌뎅|洹�\s*��|�먰븳|洹몃━怨�),?\s*/;
function cleanLeadingConnectors(sentence) {
    if (!sentence) return "";
    return sentence.replace(REGEX_LEADING_CONNECTORS, "").trim();
}

function removeMetaBySearch(text) {
    if (!text) return "";
    let result = text;

    const hoMetaRegex = /(?<![媛�-��])�몃뒗\s+[^��.]{1,200}?(?:�대떎|����|�댁뿀|�대ŉ|�닿퀬|\.|$)/g;
    result = result.replace(hoMetaRegex, "");

    const keywords = "�쒗샇|蹂멸�|��|蹂꾪샇|�꾪샇|�꾨챸|�쒕챸|�몃�紐�|�쇰챸|�뱁샇|踰뺣챸";
    const valToken = `(?:[^\\s,.\\(\\)\\u00B7]+(?:\\([^)]*\\)?)?)`;
    const valPattern = `${valToken}(?:\\s*[쨌��]\\s*${valToken})*`;
    // �� FIX: "��" 媛숈� �� 湲��� �ㅼ썙�쒕뒗 ��/��/愿꾪샇 �묐��� �놁씠 諛붾줈 �� 湲��먯뿉 遺숈쑝硫�
    //         "�먮━", "�먯떊", "�먯뿰" �� 臾닿��� �⑥뼱瑜� �듭㎏濡� ��젣�대쾭�몄쓬.
    //         �묐��ш� �놁쓣 寃쎌슦 媛� �욎뿉 諛섎뱶�� 怨듬갚�� �덉뼱�쇰쭔 硫뷀��뺣낫濡� �몄젙�섎룄濡� �쒗븳.
    const keySuffixed = `(?:${keywords})(?:��|��|\\([^)]*\\))`;
    const keyBare = `(?:${keywords})`;
    const singleMeta = `(?<![媛�-��])(?:${keySuffixed}\\s*${valPattern}|${keyBare}\\s+${valPattern})`;

    const metaChainRegex = new RegExp(`(?:,\\s*|\\s+)*(?:${singleMeta}(?:,\\s*|\\s+�대ŉ|\\s+�닿퀬|\\s+)*)+(?:�대떎|����|�댁뿀��|�대ŉ|�닿퀬|�댁옄|�쇰줈)?`, "g");
    result = result.replace(metaChainRegex, "");

    return result
        .replace(/\(\s*(?:蹂멸�|�쒗샇|��|�꾨챸|�쇰챸)[^;)]*;\s*/g, "(")
        .replace(/\.{2,}/g, ".")
        .replace(/\s+\./g, ".")
        .replace(/\s+/g, " ")
        .trim();
}

function isIncompleteSentence(sentence) {
    if (!sentence) return true;
    const cleanEnd = sentence.replace(/[()"'\s.]+$|��/g, "").trim();
    const validEndingRegex = /(?:��|����|�댁뿀��|�섏���|�먮떎|�쒕떎|�덈떎|�녿떎|�덈떎|�섏뿀��|�④꼈��|�숈“�섏���|吏�吏��섏���|媛쒖쭊�쒖섟��|��엫�덈떎|遺덈┛��)$/;
    return !validEndingRegex.test(cleanEnd);
}

function splitSentences(text) {
    if (!text || typeof text !== "string") return [];
    const normalized = normalizeSpace(text).replace(/\n+/g, " ");
    return normalized
        .split(/(?<!\b[a-zA-Z]|\d)([.!?��])(?=\s+|$)/)
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
// 2. �낆쟻/吏곸뾽 諛� �쒕룞 愿��� �뺢퇋�� �뺤옣
// ==========================================================

// �렞 �낆쟻, 吏곸뾽, 李쎌옉, �쒕룞, �섏긽 愿��� �ㅼ썙�� ���� �뺤옣
const ACHIEVEMENT_REGEX = /(湲곗뿬|�ㅻ┰|媛쒕컻|諛쒓껄|李쎌떆|二쇰룄|諛쒗몴|�곹뼢|�깃났|援ъ텞|�곷챸|�섏긽|李쎈┰|����|珥앷큵|媛쒗쁺|�뺣┰|二쇱갹|泥닿퀎��|�뺤궛|蹂닿툒|李쎌븞|吏묐���|湲고�|珥덉꽍|�밸━|�됱젙|�뺤옣|李쎌떆��|媛쒖쿃��|�꾨쾭吏�|����|以묒슂��|�낆쟻|�곌뎄|�쇰Ц|�묓뭹|李쎌옉|諛쒕챸|媛쒖쭊|�숈“|吏�吏�|�댁꽍|諛섎�|�쇱웳|遺���|�섎줈��|愿�痢�|��엫|�뚯꽕媛�|�묎�|臾명븰|�뚯꽕|�쒖씤|�붽�|�뚯븙媛�|泥좏븰��|�ъ긽媛�|�뺤튂媛�|怨쇳븰��|臾쇰━�숈옄|�섑븰��|援먯닔|�쒕룞|吏묓븘|異쒗뙋|諛쒓컙|�몃줎��|湲곗옄|�쒕룞��|�묒뾽|�꾩꽦)/;

// �렞 �몄씠利�/TMI �ㅼ썙�� (利됱떆 �덈씫)
const HARD_NOISE_REGEX = /(��\s*(?:�꾨뱾|��|�먯옄|�먮�|遺���|�꾨궡|�⑦렪|遺�移�|紐⑥튇|李⑤궓|�λ궓|�먮�|�꾩넀|遺�紐�)|寃고샎��|�ы븯��|�쇳솕|�щ떞|�뚮Ц|�꾪빐吏꾨떎|泥댁쑁愿�|�좎쟻|�ㅼ감媛�\s*�앷릿��|李⑥씠瑜�\s*蹂댁씠怨�|�댁꽕��\s*�덈떎|�쒖뼱��|�좏븰��|異쒖깮�섏���|�ы뻾��|援ш�|�먮뱾|湲곕뀗�섏뿬|�쒖옉�섏뿀��|�앹씪��)/;

// �� FIX: \b �� ASCII �뚮뱶 寃쎄퀎留� �몄떇�섍린 �뚮Ц�� �쒓� ��紐낆궗 �ㅼ뿉�쒕뒗 �덈� 留ㅼ튂�섏� �딆븯��.
//         "�ㅼ쓬 湲��먭� �쒓� �뚯젅�� �꾨땲嫄곕굹 臾몄옄�� ��" 議곌굔�쇰줈 援먯껜.
const PRONOUN_REGEX = /(?:^|\s)(?:洹몃뒗|洹멸�|洹몄쓽|洹몃�|洹몄뿉寃�|洹몃���|洹몃�媛�|洹몃���|洹몃�瑜�)(?=[^媛�-��]|$)/;

function filterOtherPerson(rawSentences, aliases = []) {
    if (!Array.isArray(rawSentences)) return [];
    const safeAliases = Array.isArray(aliases) ? aliases.filter(Boolean) : [];
    if (safeAliases.length === 0) return rawSentences;

    // �� FIX: "諛붾줈 �� 2臾몄옣"留� �뺤씤�섎뜕 諛⑹떇�� "洹몃뒗 ~. 洹몃뒗 ~. 洹몃뒗 ~."泥섎읆
    //         ��紐낆궗媛� 3踰� �댁긽 �곗냽�섎㈃ 3踰덉㎏ 臾몄옣遺��� 嫄몃윭吏��� 臾몄젣媛� �덉뿀��.
    //         �쒖감�곸쑝濡� �묒쑝硫댁꽌 "吏�湲� 臾몃㎘�� 蹂몄씤 �댁빞湲곗씤吏�" �곹깭(inSubjectContext)瑜�
    //         異붿쟻�섍퀬, ��紐낆궗 臾몄옣�� 洹� �곹깭瑜� �좎��쒖폒 泥댁씤�� �딄린吏� �딄쾶 ��.
    let inSubjectContext = true; // 泥� 臾몄옣�� ��긽 蹂몄씤 �뚭컻濡� 媛꾩＜

    return rawSentences.map((sentence, index) => {
        const text = sentence.trim();
        if (!text) return null;

        if (index === 0) {
            inSubjectContext = true;
            return text;
        }

        const hasSelfName = safeAliases.some(alias => text.includes(alias));
        if (hasSelfName) {
            inSubjectContext = true;
            return text;
        }

        const hasPronoun = PRONOUN_REGEX.test(text);
        const hasOtherPersonNoise = HARD_NOISE_REGEX.test(text);

        if (hasPronoun && inSubjectContext && !hasOtherPersonNoise) {
            // ��紐낆궗 + 吏곸쟾源뚯� 蹂몄씤 臾몃㎘�� �댁뼱吏�怨� �덉뿀�ㅻ㈃ 怨꾩냽 �좎�
            return text;
        }

        // ��紐낆궗�� �녾퀬 蹂몄씤 �대쫫�� �녿뒗 臾몄옣(�ㅻⅨ �몃Ъ �쒖닠 媛��μ꽦) �� 臾몃㎘ 醫낅즺
        inSubjectContext = false;
        return null;
    }).filter(Boolean);
}

function getDocumentKeywords(text, topN = 12) {
    if (!text) return [];
    const words = text.match(/[媛�-�즑-zA-Z0-9]{2,}/g) || [];
    const stopWords = new Set([
        "����", "寃쎌슦", "愿���", "�듯빐", "�꾪빐", "�곕씪", "�먰븳", "洹몃━怨�", "�섏�留�", "�댄썑", 
        "�뱀떆", "寃껋씠��", "�랁빐", "�섑빐", "�덈떎", "�녿떎", "�섏뼱", "�섏뿬", "�덈뒗", "�섎뒗",
        "�щ엺", "�섎굹", "媛�吏�", "�먯떊��", "�꾪빐", "�뚮Ц", "愿���", "湲곕줉", "湲곕줉�섏뼱", "李⑥씠瑜�"
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
// 3. 硫붿씤 �붿빟 �앹꽦 濡쒖쭅
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

        if (len < 15 || len > 350) continue;
        if (isIncompleteSentence(text)) continue;
        if (HARD_NOISE_REGEX.test(text)) continue;
        if (!ACHIEVEMENT_REGEX.test(text)) continue;

        let score = 50;

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
    if (targetBody && targetBody.length > 12) {
        extra = extractImportantSentences(targetBody, introResultText, aliases, extraCount);
    }

    const merged = normalizeSpace([introResultText, extra].filter(Boolean).join(" "));
    return cleanSlice(merged);
}   
