// ==========================================
// 1. 텍스트 정제 및 안전 유틸리티
// ==========================================

function normalizeSpace(text = "") {
    return String(text).replace(/\s+/g, " ").trim();
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 🌟 외국어/한자 유지 + 각주 및 불필요 공백만 정제
export function cleanWikiText(text) {
    if (!text) return "";
    return text
        .replace(/\[\s*\*?\s*\]|\[\d+\]|\[출처\s*필요\]|\[각주\]/g, "")
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

const COMMON_STOP_WORDS = new Set([
    "등의", "대한", "통해", "위해", "있었다", "하고", "이고", "따라", "의해", "위한",
    "경우", "관한", "가지", "관련", "이후", "당시", "가지고", "대해", "또한", "그리고"
]);

// ==========================================
// 2. 접속어 및 주어 중복 안전 정제
// ==========================================

function cleanLeadingConjunctions(sentence) {
    if (!sentence) return "";
    return sentence.replace(/^(또한|그리고|이에|그러자|이처럼|따라서|한편|그 결과|이때|이후)\s+/, "");
}

function refineClauseConnectives(sentence) {
    if (!sentence) return "";
    let text = sentence.trim();

    text = text.replace(/([가-힣]+)하여\s+([가-힣\s]+)하여/g, "$1하고 $2하여");
    text = text
        .replace(/하였으며,/g, "하였고,")
        .replace(/이었으나,/g, "이었지만,")
        .replace(/되었으나,/g, "되었지만,");

    return text;
}

function fixDanglingClause(sentence) {
    if (!sentence) return "";
    let text = sentence.trim();

    return text
        .replace(/(였으며|하였으며|이었으며)$/, "이었다.")
        .replace(/(하며|하며,|하며\s*)$/, "하였다.")
        .replace(/(하고|하고,|하고\s*)$/, "하였다.")
        .replace(/(했으나|하였으나)$/, "하였다.");
}

function formatMergedText(sentences, aliases = []) {
    if (sentences.length <= 1) return sentences.join(" ");

    const safeAliases = aliases
        .map(a => a.trim())
        .filter(a => a.length >= 2)
        .sort((a, b) => b.length - a.length);

    return sentences.map((sent, idx) => {
        if (idx === 0) return sent;

        let trimmed = sent;
        for (const alias of safeAliases) {
            try {
                const escapedAlias = escapeRegExp(alias);
                const subjectRegex = new RegExp(`^${escapedAlias}(은|는|이|가)\\s+`);
                if (subjectRegex.test(trimmed)) {
                    trimmed = trimmed.replace(subjectRegex, "");
                    break;
                }
            } catch (e) {}
        }
        return trimmed;
    }).join(" ");
}

function isMicroDetailSentence(sentence) {
    const numberMatches = sentence.match(/\d+(?:,\d+)*(?:명|개|원|달러|km|m|%|퍼센트|년)/g) || [];
    if (numberMatches.length >= 3) return true;

    const reportEndingRegex = /(보고하였다|집계되었다|기록하였다|기재되어 있다)\.?$/;
    if (reportEndingRegex.test(sentence)) return true;

    return false;
}

function checkSelfContainment(sentence) {
    const demonstrativeStartRegex = /^(이|그|저)(러|느|것|들|때|곳|후|외|에|로|와|과|도|는|가|를|의|\s)/;
    if (demonstrativeStartRegex.test(sentence)) return false;

    const quoteOrCitationRegex = /(“|”|'|'|"(?:라 하였다|라 전한다|고 한다|라 한다|한 것이다|하였다)$)/;
    if (quoteOrCitationRegex.test(sentence)) return false;

    const relativeSubjectRegex = /^(어머니|아버지|남동생|여동생|형|오빠|누나|언니|아들|딸|부인|아내|남편|할아버지|할머니)\s+/;
    if (relativeSubjectRegex.test(sentence)) return false;

    return true;
}

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

// ==========================================
// 3. 단락 분량 기반 문장 추출 (가장 긴 구역에서 2문장)
// ==========================================

export function extractImportantSentences(bodyText, introText = "", aliases = []) {
    if (!bodyText) return [];

    const paragraphs = bodyText.split(/\n+/).map(p => p.trim()).filter(p => p.length > 30);
    if (paragraphs.length === 0) return [];

    let largestParaIndex = 0;
    let maxCharCount = 0;

    paragraphs.forEach((para, idx) => {
        if (para.length > maxCharCount) {
            maxCharCount = para.length;
            largestParaIndex = idx;
        }
    });

    const topKeywords = extractTopKeywords(bodyText + " " + introText);
    const introTokens = new Set(tokenize(introText));

    const paragraphCandidates = paragraphs.map((para, paraIdx) => {
        const sentences = splitSentences(para);
        const scoredSentences = sentences.map((sentence, index) => {
            const trimmed = sentence.trim();

            if (!checkSelfContainment(trimmed) || isMicroDetailSentence(trimmed)) {
                return { sentence: trimmed, index, score: -100 };
            }

            let score = 0;
            if (/(《|『).*?(》|』)/.test(trimmed)) score += 18;
            if (index === 0) score += 15;

            const hasAlias = aliases.some(alias => alias && trimmed.includes(alias));
            if (hasAlias) score += 12;

            const words = tokenize(trimmed);
            if (words.length === 0) return { sentence: trimmed, index, score: -100 };

            let keywordHitCount = 0;
            let introOverlapCount = 0;

            for (const word of words) {
                if (topKeywords.has(word)) keywordHitCount++;
                if (introTokens.has(word)) introOverlapCount++;
            }

            score += keywordHitCount * 5;

            const overlapRate = introOverlapCount / Math.max(words.length, 1);
            if (overlapRate > 0.75) return { sentence: trimmed, index, score: -100 };

            return { sentence: trimmed, index, score };
        }).filter(item => item.score > 0);

        return {
            paraIdx,
            candidates: scoredSentences.sort((a, b) => b.score - a.score)
        };
    });

    const selectedSentences = [];

    paragraphCandidates.forEach(({ paraIdx, candidates }) => {
        if (candidates.length === 0) return;

        if (paraIdx === largestParaIndex) {
            selectedSentences.push(...candidates.slice(0, 2).map(c => c.sentence));
        } else {
            selectedSentences.push(candidates[0].sentence);
        }
    });

    return selectedSentences;
}

// ==========================================
// 4. 최종 요약문 빌더
// ==========================================

export function buildDescription(
    introText,
    bodyText,
    aliases = [],
    maxLength = 1100
) {
    const cleanIntro = cleanWikiText(introText);
    const cleanBody = cleanWikiText(bodyText);

    const introSentences = splitSentences(cleanIntro)
        .filter(s => checkSelfContainment(s) && !isMicroDetailSentence(s));

    let selectedSentences = [];

    if (introSentences.length > 0) {
        selectedSentences.push(introSentences[0]);
        if (introSentences.length > 1 && introSentences[1].length < 120) {
            selectedSentences.push(introSentences[1]);
        }
    }

    if (cleanBody) {
        const bodyExtracted = extractImportantSentences(
            cleanBody,
            selectedSentences.join(" "),
            aliases
        );
        if (Array.isArray(bodyExtracted) && bodyExtracted.length > 0) {
            selectedSentences.push(...bodyExtracted);
        }
    }

    const processedSentences = selectedSentences.map((sent, idx) => {
        let text = sent;
        if (idx > 0) text = cleanLeadingConjunctions(text);
        text = refineClauseConnectives(text);
        text = fixDanglingClause(text);
        return text;
    });

    const mergedText = formatMergedText(processedSentences, aliases);

    if (mergedText.length <= maxLength) return mergedText;

    const sliced = mergedText.slice(0, maxLength);
    const lastPeriod = sliced.lastIndexOf(".");
    return lastPeriod > maxLength * 0.5 ? sliced.slice(0, lastPeriod + 1).trim() : sliced;
}
