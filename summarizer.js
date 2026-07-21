// ==========================================
// 1. 텍스트 정제 및 기본 유틸리티
// ==========================================

function normalizeSpace(text = "") {
    return String(text).replace(/\s+/g, " ").trim();
}

// 위키백과 주석, 특수문자, 인용 표기 generic 정제
export function cleanWikiText(text) {
    if (!text) return "";
    return text
        .replace(/\[\s*\*?\s*\]|\[\d+\]|\[출처\s*필요\]|\[각주\]/g, "")
        .replace(/\((일본어|한자|영어|중국어|프랑스어|독일어|러시아어):\s*.*?\)/gi, "")
        .replace(/\((첫|두|세|네|다섯|\d+)\s*번째\)/g, "")
        .replace(/\(주:[^\)]*\)/g, "")
        .replace(/\(\s*\)/g, "")
        .replace(/\s+/g, " ")
        .replace(/\s+\./g, ".")
        .trim();
}

function tokenize(text) {
    return normalizeSpace(text)
        .replace(/[^\w가-힣]+/g, " ")
        .split(/\s+/)
        .map(s => s.trim())
        .filter(s => s.length >= 2);
}

// 문장 분리 (기본 문장부호 기준)
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
        .filter(s => s.length >= 15);
}

// 불용어(조사, 일반 어미 등) 기본 억제 규칙
const COMMON_STOP_WORDS = new Set([
    "등의", "대한", "통해", "위해", "있었다", "하고", "이고", "따라", "의해", "위한",
    "경우", "관한", "가지", "관련", "이후", "당시", "가지고", "대해", "또한", "그리고"
]);

// ==========================================
// 2. 동적 키워드 추출 (Dynamic Term Frequency)
// ==========================================

function extractTopKeywords(text, topN = 12) {
    const tokens = tokenize(text);
    const freqMap = new Map();

    for (const token of tokens) {
        if (COMMON_STOP_WORDS.has(token) || /^\d+$/.test(token)) continue;
        freqMap.set(token, (freqMap.get(token) || 0) + 1);
    }

    return new Set(
        [...freqMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, topN)
            .map(([word]) => word)
    );
}

// 타인 사망 문장 제거 (이름 대조)
export function filterOtherPersonDeath(text, aliases = []) {
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

// ==========================================
// 3. 문장 자립성(Self-Containment) 평가
// ==========================================

function checkSelfContainment(sentence) {
    // A. 지시어/대명사/접속 성향으로 시작하는 문장 (이/그/저 + 접사)
    // 예: 이는, 그는, 그러나, 하지만, 이에, 그후, 이로써, 이때 등 전체 커버
    const demonstrativeStartRegex = /^(이|그|저)(러|느|것|들|때|곳|후|외|에|로|와|과|도|는|가|를|의|\s)/;
    if (demonstrativeStartRegex.test(sentence)) {
        return false;
    }

    // B. 인용문/사서 인용/직접 대화 형태 (독립 문장으로 어색함)
    const quoteOrCitationRegex = /(“|”|'|'|"(?:라 하였다|라 전한다|고 한다|라 한다|한 것이다|하였다)$)/;
    if (quoteOrCitationRegex.test(sentence)) {
        return false;
    }

    // C. 서술 주어가 관계자(친인척/타인) 중심인 경우
    const relativeSubjectRegex = /^(어머니|아버지|남동생|여동생|형|오빠|누나|언니|아들|딸|부인|아내|남편|할아버지|할머니)\s+/;
    if (relativeSubjectRegex.test(sentence)) {
        return false;
    }

    return true;
}

// ==========================================
// 4. 문장 가중치 알고리즘 점수화
// ==========================================

export function extractImportantSentences(bodyText, introText = "", aliases = [], count = 3) {
    if (!bodyText) return "";

    const sentences = splitSentences(bodyText);
    if (sentences.length === 0) return "";

    // 1) 전체 본문 기반 동적 키워드 추출
    const topKeywords = extractTopKeywords(bodyText + " " + introText);
    const introTokens = new Set(tokenize(introText));

    const scored = sentences.map((sentence, index) => {
        const trimmed = sentence.trim();

        // 1. 구조적 자립성 미달 문장 제거
        if (!checkSelfContainment(trimmed)) {
            return { sentence: trimmed, index, score: -100 };
        }

        let score = 0;

        // 2. 대상 본인 명시 여부 (가장 확실한 자립 문장)
        const hasAlias = aliases.some(alias => alias && trimmed.includes(alias));
        if (hasAlias) score += 25;

        // 3. 문서 동적 핵심 키워드 포함도 (TF 점수)
        const words = tokenize(trimmed);
        if (words.length === 0) return { sentence: trimmed, index, score: -100 };

        let keywordHitCount = 0;
        let introOverlapCount = 0;

        for (const word of words) {
            if (topKeywords.has(word)) keywordHitCount++;
            if (introTokens.has(word)) introOverlapCount++;
        }

        score += keywordHitCount * 6; // 핵심어 포함 가중치

        // 4. 구체적 정보성 (연도, 숫자 함유)
        if (/\d{3,4}년/.test(trimmed)) score += 5;

        // 5. 위치 감쇄 (문서 앞쪽에 있을수록 살짝 우대)
        const positionFactor = 1 / (1 + index * 0.05);
        score += positionFactor * 5;

        // 6. 서론과의 유사도(Jaccard) 오버랩 감점 (중복 방지)
        const overlapRate = introOverlapCount / Math.max(words.length, 1);
        if (overlapRate > 0.7) return { sentence: trimmed, index, score: -100 };

        // 7. 길이 밸런스 페널티
        if (trimmed.length < 25 || trimmed.length > 250) score -= 10;

        return { sentence: trimmed, index, score };
    });

    // 점수가 유효한 후보만 선별
    const validCandidates = scored.filter(item => item.score > 0);
    if (validCandidates.length === 0) return "";

    // 구간별(초/중/후반) 균등 추출하여 다양한 정보 보장
    if (validCandidates.length <= 4) {
        return validCandidates
            .sort((a, b) => b.score - a.score)
            .map(item => item.sentence)
            .join(" ");
    }

    const totalCount = sentences.length;
    const boundary1 = Math.floor(totalCount / 3);
    const boundary2 = Math.floor((totalCount * 2) / 3);

    const zones = [[], [], []];
    validCandidates.forEach(item => {
        if (item.index < boundary1) zones[0].push(item);
        else if (item.index < boundary2) zones[1].push(item);
        else zones[2].push(item);
    });

    const selectedItems = [];
    zones.forEach(zone => {
        if (zone.length === 0) return;
        zone.sort((a, b) => b.score - a.score);
        selectedItems.push(zone[0]); // 각 영역별 최상위 1개씩 추출
    });

    return selectedItems
        .sort((a, b) => a.index - b.index)
        .map(item => item.sentence)
        .join(" ");
}

// ==========================================
// 5. 최종 요약문 빌더
// ==========================================

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
