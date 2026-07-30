/**
 * 범용 텍스트 요약 모듈 (외부 설치 불필요, 순수 자바스크립트 버전)
 */

// 1. [스택 기반] 괄호 제거 함수 (외국어 인명/원어명/생몰년은 보존)
function removeGenealogyParentheses(text) {
    if (!text) return "";
    let result = "";
    let i = 0;

    while (i < text.length) {
        if (text[i] === '(' || text[i] === '[') {
            const openChar = text[i];
            const closeChar = openChar === '(' ? ')' : ']';
            let depth = 1;
            let j = i + 1;
            let innerText = "";

            while (j < text.length && depth > 0) {
                if (text[j] === openChar) depth++;
                else if (text[j] === closeChar) depth--;
                
                if (depth > 0) innerText += text[j];
                j++;
            }

            const isMultilingualOrName = /[a-zA-Z\u4e00-\u9fa5\u3040-\u30ff]/.test(innerText) || /\d{4}년/.test(innerText);

            if (isMultilingualOrName) {
                result += text.slice(i, j);
            } else {
                result += " ";
            }
            i = j;
        } else {
            result += text[i];
            i++;
        }
    }
    return result;
}

// 2. 위키 문법 및 주석 정제
export function cleanWikiText(text) {
    if (!text) return "";
    return text
        .replace(/\[\s*\*?\s*\]|\[\d+\]|\[출처\s*필요\]|\[각주\]/g, "")
        .replace(/\{\\displaystyle\s*([^}]+)\}/g, " $1 ")
        .replace(/\\[a-zA-Z]+/g, "")
        .replace(/(?:작품으로|저서로)\s*,\s*등이/g, "여러 작품이")
        .replace(/\s+/g, " ")
        .trim();
}

// 3. 순수 JS 기반 한국어 문장 분리기 (소수점, 3.1운동 마침표 완벽 보호)
export function splitSentences(text) {
    if (!text) return [];
    const normalized = cleanWikiText(text);

    // 숫자 뒤 마침표나 소수점, 3.1운동 등의 마침표가 문장 분리로 오인되지 않도록 임시 치환
    const protectedText = normalized
        .replace(/(\d+)\s*\.\s*(\d+)/g, "$1__DECIMAL__$2")
        .replace(/(\d+)\s*\.\s*(?=[가-힣a-zA-Z])/g, "$1__DECIMAL__");

    // 문장 마침표/물음표/느낌표 기준으로 분할
    const rawSentences = protectedText.split(/(?<=[.!?。])(?=\s+|$)/);

    return rawSentences
        .map(s => s.replace(/__DECIMAL__/g, ".").trim())
        .filter(Boolean);
}

// 4. 족보/신상정보 및 파편 문장 정제
export function cleanGenealogyClause(sentence) {
    if (!sentence) return "";

    let cleaned = removeGenealogyParentheses(sentence).trim();

    const genealogyPattern = /(?:,\s*|\s+)?(?:본관은|본관이|아명은|태명은|세례명은|당호는|시호는|일명은|묘호는|휘는|자\(字\)는|호\(號\)는|시\(諡\)는|자는|호는)\s+[가-힣A-Za-z0-9\s]+(?=[,.!?]|$)/g;
    cleaned = cleaned.replace(genealogyPattern, "");

    cleaned = cleaned.replace(/\s+/g, " ").replace(/^[,.\s]+/, "").replace(/[.,\s]+$/, "").trim();

    if (!cleaned) return "";

    if (!/[.!?]$/.test(cleaned)) {
        cleaned += ".";
    }

    if (cleaned.length < 10 || /(따옴|연유함|에서\s*따왔다)/.test(cleaned)) return "";

    return cleaned;
}

// 5. 완결 검증
function isValidSentence(sentence) {
    if (!sentence || sentence.length < 12 || sentence.length > 350) return false;

    if (/^\d+(운동|월|일|년|회)\b/.test(sentence) && !/^(19|20)\d\d년/.test(sentence)) {
        return false;
    }

    const validEndingRegex = /(다|냐|까|요|죠|자|라|며|음|임|함|됨|성|상|위|중)\.?$/;
    return validEndingRegex.test(sentence.trim());
}

// 6. 지시어/명칭 복원 관련 함수들
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

// 7. 점수 산출
function calculateSentenceScore(sentence, isFirstSentence = false) {
    let score = 10;

    if (/(은|는|이|가)\s+.*(이다|하였다|주장하였다|수립하였다|건설하였다|집대성하였다|특징이다|의미한다|의거|순국|창시|개발|설립|발행|발표)/.test(sentence)) {
        score += 20;
    }

    if (/(사상|이론|주장|체계|혁명|독립|운동|지향|해명|개혁|지주|정책|기여|영향|대표|원인|결과|수필|희곡|신문|잡지)/.test(sentence)) {
        score += 15;
    }

    if (isFirstSentence) score += 10;

    if (/(통계|백분율|소작료|아내|부인|아들|딸|친인척|노년|은퇴|향리)/.test(sentence)) {
        score -= 20;
    }

    if (sentence.length >= 30 && sentence.length <= 180) {
        score += 10;
    }

    return score;
}

// 8. 중요 문장 추출
export function extractImportantSentences(bodyText, count = 2) {
    if (!bodyText) return "";

    const rawSentences = splitSentences(bodyText);
    const validCandidates = [];

    rawSentences.forEach((raw, idx) => {
        let cleaned = cleanGenealogyClause(raw);

        if (!isValidSentence(cleaned)) return;

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

// 9. 최종 요약문 생성
export function buildDescription(introText, bodyText, maxLength = 1000) {
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
