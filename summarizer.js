/**
 * 범용 텍스트 요약 모듈 (전 분야 및 지시어 복원 기능 통합)
 */

// 1. [스택 기반] 괄호 및 내부 텍스트 완벽 제거 (괄호 안 쉼표, 마침표 영향 차단)
function removeParentheses(text) {
    if (!text) return "";
    let result = "";
    let depth = 0;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '(' || char === '[' || char === '{' || char === '〈' || char === '《') {
            depth++;
        } else if (char === ')' || char === ']' || char === '}' || char === '〉' || char === '》') {
            if (depth > 0) depth--;
        } else if (depth === 0) {
            result += char;
        }
    }
    return result;
}

// 2. 위키 문법 및 주석, 수식 등 전처리
export function cleanWikiText(text) {
    if (!text) return "";
    return text
        .replace(/\[\s*\*?\s*\]|\[\d+\]|\[출처\s*필요\]|\[각주\]/g, "")
        .replace(/\{\\displaystyle\s*([^}]+)\}/g, " $1 ")
        .replace(/\\[a-zA-Z]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// 3. 한국어 문장 분리기 (소수점, 고유명사 마침표 보호)
export function splitSentences(text) {
    if (!text) return [];

    const normalized = cleanWikiText(text);
    
    // 마침표 안전 보호 (소수점, 3.1운동, 4.19혁명, 5.18, 날짜 등)
    const protectedText = normalized
        .replace(/(\d+)\s*\.\s*(\d+)/g, "$1__DECIMAL__$2")
        .replace(/(\d+)\s*\.\s*(?=[가-힣a-zA-Z])/g, "$1__DECIMAL__");

    const rawSentences = protectedText.split(/(?<=[.!?。])(?=\s+|$)/);

    return rawSentences
        .map(s => s.replace(/__DECIMAL__/g, ".").trim())
        .filter(Boolean);
}

// 4. 족보/신상정보 및 파편 문장 정제
export function cleanGenealogyClause(sentence) {
    if (!sentence) return "";

    let cleaned = removeParentheses(sentence).trim();

    const genealogyPattern = /(?:,\s*|\s+)?(?:본관은|본관이|아명은|태명은|세례명은|당호는|시호는|일명은|묘호는|휘는|자\(字\)는|호\(號\)는|시\(諡\)는|자는|호는)\s+[가-힣A-Za-z0-9\s]+(?=[,.!?]|$)/g;
    cleaned = cleaned.replace(genealogyPattern, "");

    cleaned = cleaned.replace(/^[^가-힣A-Za-z0-9]+/, "").replace(/[.,\s]+$/, "").trim();

    if (!cleaned) return "";

    if (!/[.!?]$/.test(cleaned)) {
        cleaned += ".";
    }

    if (cleaned.length < 12 || /(따옴|연유함|에서\s*따왔다)/.test(cleaned)) return "";

    return cleaned;
}

// 5. 완결되지 않은 문장 또는 훼손된 문장 검증
function isValidSentence(sentence) {
    if (!sentence || sentence.length < 15 || sentence.length > 350) return false;

    // 앞 숫자가 잘린 파손 문장 차단 (예: '1운동으로 시작된...', '월 1일에...')
    if (/^\d+(운동|월|일|년|회)\b/.test(sentence) && !/^(19|20)\d\d년/.test(sentence)) {
        return false;
    }

    const validEndingRegex = /(다|냐|까|요|죠|자|라|며|음|임|함|됨|성|상|위|중)\.?$/;
    return validEndingRegex.test(sentence.trim());
}

// 6. [지시어/명칭 복원 로직] 앞 문장에서 제목(《》, 〈〉, "", '') 탐색
function findPrecedingTitle(sentences, currentIndex) {
    for (let i = currentIndex - 1; i >= Math.max(0, currentIndex - 3); i--) {
        const prevText = sentences[i];
        if (!prevText) continue;
        const titleMatch = prevText.match(/《([^》]+)》|<([^>]+)>|〈([^〉]+)〉|“([^”]+)”|"([^"]+)"|'([^']+)'/);
        if (titleMatch) return titleMatch[0];
    }
    return null;
}

// 7. [지시어/명칭 복원 로직] "이 중", "그 중" 복원
function resolveVagueReference(sentence, foundTitle) {
    if (!foundTitle) return sentence;
    let text = sentence.trim();
    if (/^(이|그)\s*중\b/.test(text)) {
        return text.replace(/^(이|그)\s*중\b/, `${foundTitle} 중`);
    }
    return `${foundTitle}의 ${text}`;
}

// 8. [지시어/명칭 복원 로직] "이 작품", "그 사상" 등 지시대명사 복원
export function resolveDemonstrativeReference(sentence, sentences, currentIndex) {
    let processedSentence = sentence;
    const targetRegex = /(이|그)\s+(작품|조각|그림|회화|동상|건축물|벽화|서적|책|화풍|시리즈|주장|사상|이론|업적|시기|운동|전쟁)/;
    
    if (targetRegex.test(processedSentence)) {
        let foundTitle = null;
        for (let j = currentIndex - 1; j >= Math.max(0, currentIndex - 3); j--) {
            if (!sentences[j]) continue;
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

// 9. 문맥 중심 중요도 점수 산출
function calculateSentenceScore(sentence, isFirstSentence = false) {
    let score = 10;

    if (/(은|는|이|가)\s+.*(이다|하였다|하였다고\s+볼\s+수\s+있다|주장하였다|수립하였다|건설하였다|집대성하였다|특징이다|의미한다|의거|순국|창시|개발|설립|발명|발견)/.test(sentence)) {
        score += 20;
    }

    if (/(사상|이론|주장|체계|혁명|독립|운동|지향|해명|개혁|지주|정책|기여|영향|대표|원인|결과|극복)/.test(sentence)) {
        score += 15;
    }

    if (isFirstSentence) score += 10;

    if (/(통계|백분율|소작료|아내|부인|아들|딸|친인척|노년|은퇴|향리)/.test(sentence)) {
        score -= 20;
    }

    if (sentence.length >= 40 && sentence.length <= 180) {
        score += 10;
    }

    return score;
}

// 10. 중요 문장 추출 (지시어 복원 연결 완료)
export function extractImportantSentences(bodyText, count = 2) {
    if (!bodyText) return "";

    const rawSentences = splitSentences(bodyText);
    const validCandidates = [];

    rawSentences.forEach((raw, idx) => {
        let cleaned = cleanGenealogyClause(raw);

        if (!isValidSentence(cleaned)) return;

        // 지시어 복원 처리 적용
        if (/^(이|그)\s*중\b/.test(cleaned)) {
            const foundTitle = findPrecedingTitle(rawSentences, idx);
            if (foundTitle) {
                cleaned = resolveVagueReference(cleaned, foundTitle);
            }
        } else {
            cleaned = resolveDemonstrativeReference(cleaned, rawSentences, idx);
        }

        const score = calculateSentenceScore(cleaned, idx === 0);
        validCandidates.push({ sentence: cleaned, score, index: idx });
    });

    if (validCandidates.length === 0) return "";

    validCandidates.sort((a, b) => b.score - a.score);
    const selected = validCandidates.slice(0, count);

    selected.sort((a, b) => a.index - b.index);

    return selected.map(item => item.sentence).join(" ");
}

// 11. 최종 요약문 생성
export function buildDescription(introText, bodyText, maxLength = 1100) {
    const cleanIntro = cleanGenealogyClause(cleanWikiText(introText));
    const cleanBody = cleanWikiText(bodyText);

    let summaryParts = [];

    if (cleanIntro && isValidSentence(cleanIntro)) {
        summaryParts.push(cleanIntro);
    }

    const bodySummary = extractImportantSentences(cleanBody, 2);
    if (bodySummary) {
        summaryParts.push(bodySummary);
    }

    let result = summaryParts.join(" ").trim();

    if (result.length > maxLength) {
        result = result.slice(0, maxLength);
        const lastDot = result.lastIndexOf(".");
        if (lastDot > maxLength * 0.5) {
            result = result.slice(0, lastDot + 1);
        }
    }

    return result;
}
