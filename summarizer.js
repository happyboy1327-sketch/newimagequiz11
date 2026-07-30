// 1) IMPORTANT_KEYWORDS 배열에 추가
const IMPORTANT_KEYWORDS = [
    "태어났다", "출생", "사망", "순국", "옥사", "고문", "투옥", "형무소", "체포", "서거",
    "활동", "노력", "독점", "정벌", "발표", "창시", "발명", "발견", "폐지", "수상",
    "노벨", "대표", "저서", "저자", "작품", "전쟁", "독립", "혁명", "의거", "의열",
    "연구", "증명", "설립", "창립", "개발", "제작", "기록", "영향", "업적", "졸업",
    "임명", "취임", "부정", "일기", "수용소", "유대인", "수필", "만세", "저격", "이토", "히로부미", "하얼빈"
];

// 2) STRICT_GENEALOGY_REGEX에 추가
const STRICT_GENEALOGY_REGEX = /(본관은|아명은|세례명은|자\(字\)는|자는\s+|호\(號\)는|호는\s+|당호는|시호는|시\(諡\)는|시는\s+|성씨는|족보는)/;
//                               ^^^^^^^^ [추가]

// 3) NUTRITION_REGEX에 추가
const NUTRITION_REGEX = /(독립|전투|운동|학설|발명|발견|창시|개혁|통일|건국|재위|집권|해방|혁명|사상|학파|저서|대표작|노벨상|원소|정리|공식|전쟁|함락|승리|패배|결성|폐지|창립|설립|의병|관찰사|벼슬|임진왜란|제정|창간|조직|주도|도입|확립|개척|순국|옥사|고문|투옥|형무소|의거|저격|이토|히로부미|하얼빈|동양평화론|단지|(?!(?:여론|결론|방법론))(?:[가-힣A-Za-z]+론)|(?:[가-힣A-Za-z]+주의))/;
//                                                                                                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ [추가]

const GENEALOGY_REGEX = /(의\s*(아들|딸|손자|손녀|부인|아내|남편|부친|모친|차남|장남|차녀|장녀)(이다|이었다|이며|이고|\s|\.))|(슬하에)|(결혼하(여|였|고))|(출생하|태어났)/;

const MINOR_TMI_REGEX = /(돌아와서|자제해|마부|수레|점점|은퇴|노년|보냈|생활했|향리|소일)/;
const DANGLING_START_REGEX = /^(이(후|러한|와\s+같이)?|따라서|이에|반면)\b/;

function normalizeSpace(text = "") {
    return String(text).replace(/\s+/g, " ").trim();
}

// 유니코드 윗첨자 맵
function toSuperscript(str) {
    const superMap = {
        '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
        '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
        '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
        'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ', 'y': 'ʸ', 'a': 'ᵃ',
        'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ', 'k': 'ᵏ',
        'm': 'ᵐ', 'p': 'ᵖ', 'r': 'ʳ', 't': 'ᵗ'
    };
    return str.split('').map(ch => superMap[ch] || ch).join('');
}

// 🌟 [추가] 유니코드 아래첨자 맵
function toSubscript(str) {
    const subMap = {
        '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
        '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
        '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
        'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ',
        'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'o': '⒒',
        'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ',
        'v': 'ᵥ', 'x': 'ₓ'
    };
    return str.split('').map(ch => subMap[ch] || ch).join('');
}

function cleanWikiText(text) {
    if (!text) return "";
    return text
        // 🌟 위키백과 수식(Math) 종합 유니코드 정제
        .replace(/([a-zA-Z0-9\s+,=\-*\/^()_]*)\{\\displaystyle\s*([^}]+)\}/g, (match, fallback, latex) => {
            let cleaned = latex
                // 1. 폰트/스타일 래퍼 제거
                .replace(/\\(mathrm|text|mathbf|mathit)\{([^}]+)\}/g, "$2")
                
                // 2. 분수 & 제곱근 변환
                .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1/$2)")
                .replace(/\\sqrt\[([^\]]+)\]\{([^}]+)\}/g, (_, root, val) => toSuperscript(root) + "√(" + val + ")")
                .replace(/\\sqrt\{([^}]+)\}/g, "√($1)")

                // 3. 적분, 시그마, 극한, 미분기호
                .replace(/\\iiiint/g, "⨌").replace(/\\iiint/g, "∭")
                .replace(/\\iint/g, "∬").replace(/\\oint/g, "∮").replace(/\\int/g, "∫")
                .replace(/\\sum/g, "∑").replace(/\\prod/g, "∏")
                .replace(/\\lim/g, "lim").replace(/\\infty/g, "∞")
                .replace(/\\partial/g, "∂").replace(/\\nabla/g, "∇")

                .replace(/(\d+)[\s·․ㆍ.]+(\d+)/g, "$1.$2") // 3 . 1, 3·1 -> 3.1

                // 4. 연산자 & 관계 기호
                .replace(/\\times/g, "×").replace(/\\cdot/g, "·")
                .replace(/\\pm/g, "±").replace(/\\mp/g, "∓")
                .replace(/\\ne(?:q)?/g, "≠").replace(/\\le(?:q)?/g, "≤").replace(/\\ge(?:q)?/g, "≥")
                .replace(/\\approx/g, "≈").replace(/\\equiv/g, "≡")
                .replace(/\\(?:to|rightarrow)/g, "→").replace(/\\leftarrow/g, "←")

                // 5. 집합 & 논리 기호
                .replace(/\\in/g, "∈").replace(/\\notin/g, "∉")
                .replace(/\\subset/g, "⊂").replace(/\\supset/g, "⊃")
                .replace(/\\cap/g, "∩").replace(/\\cup/g, "∪")
                .replace(/\\forall/g, "∀").replace(/\\exists/g, "∃")

                // 6. 그리스 문자
                .replace(/\\alpha/g, "α").replace(/\\beta/g, "β").replace(/\\gamma/g, "γ")
                .replace(/\\delta/g, "δ").replace(/\\epsilon/g, "ε").replace(/\\theta/g, "θ")
                .replace(/\\lambda/g, "λ").replace(/\\mu/g, "μ").replace(/\\pi/g, "π")
                .replace(/\\sigma/g, "σ").replace(/\\phi/g, "φ").replace(/\\omega/g, "ω")
                .replace(/\\Delta/g, "Δ").replace(/\\Sigma/g, "Σ").replace(/\\Omega/g, "Ω")

                // 7. 지수(윗첨자) 및 아래첨자 변환
                .replace(/\^{(.*?)}/g, (_, exp) => toSuperscript(exp))
                .replace(/\^([a-zA-Z0-9]+)/g, (_, exp) => toSuperscript(exp))
                .replace(/_{(.*?)}/g, (_, sub) => toSubscript(sub))
                .replace(/_([a-zA-Z0-9]+)/g, (_, sub) => toSubscript(sub))

                // 8. 찌꺼기 백슬래시/중괄호 정리
                .replace(/\\[,;!\s]/g, " ")
                .replace(/\\/g, "")
                .replace(/[{}]/g, "")
                .replace(/,([^\s])/g, ", ")
                .replace(/\s+/g, " ")
                .trim();

            return " " + cleaned + " ";
        })
        .replace(/\[\s*\*?\s*\]|\[\d+\]|\[출처\s*필요\]|\[각주\]/g, "")
        .replace(/\((첫|두|세|네|다섯|\d+)\s*번째\)/g, "")
        .replace(/\(\s*\)/g, "")
        .replace(/\s+/g, " ")
        .replace(/\s+\./g, ".")
        .trim();
}

// 🌟 [핵심] 문장 통째 삭제가 아닌, "자는.. 호는.." 구문만 핀포인트로 오려내는 함수
// 🌟 [수정] 일반 단어(시작된, 자유 등)에 절대로 반응하지 않는 안전한 핀포인트 수술기
function cleanGenealogyClause(sentence) {
    if (!sentence || typeof sentence !== "string") return "";

    let cleaned = sentence.trim();

    // 1. 뒤에 '는/은/가/이'가 확실히 붙은 완전한 족보 표현만 정확히 타격
    const genealogyPattern = /(?:,\s*|\s+)?(?:본관은|본관이|아명은|태명은|세례명은|당호는|시호는|일명은|묘호는|휘는|자\(字\)는|호\(號\)는|시\(諡\)는|자는|호는)(?:\s*|\s+)(?:\([^)]*\)|[^,.!?])+(?=[,.!?]|$)/g;
    cleaned = cleaned.replace(genealogyPattern, "");

    // 🟢 [추가] 남아있는 닫는 괄호 및 기호 수거
    cleaned = cleaned.replace(/^[^가-힣A-Za-z0-9]*\)/, "");
    cleaned = cleaned.replace(/[.,\s]+$/, "");

    // 3. 어미 수리 (~으로 -> ~이다. / ~였으며 -> ~였다.)
    cleaned = cleaned.replace(/(?:으로|이고|이며|였으며|였고|였으나|이자)$/i, "이다.");
    cleaned = cleaned.replace(/(?:하하였고|하였으며|하고)$/i, "하였다.");

    // 4. 문장 시작 찌꺼기 정리
    cleaned = cleaned.replace(/^[,.\s]+/, "").trim();

    if (!cleaned) return "";

    // 5. 마침표 복원
    if (!/[.!?]$/.test(cleaned)) {
        cleaned += ".";
    }

    if (cleaned.length < 12 || /(따옴|연유함|에서\s*따왔다)/.test(cleaned)) return "";

    return cleaned;
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

function filterOtherPersonDeath(text, aliases = []) {
    if (!text) return "";
    const sentences = text.split(/(?<=[.!?])\s+/);
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

        const possessiveDeathRegex = /(아버지|부친|어머니|모친|아내|부인|남편|아들|딸|형|동생|스승|친구|동료|통역가)의\s*(사망|별세|서거|타계|처형|죽음)/;
        if (possessiveDeathRegex.test(sentence) && !/(그녀|그|본인|가족|식구|모두|함께)/.test(sentence)) {
            return false;
        }

        return true;
    });
    return cleanSentences.join(" ");
}

function splitSentences(text) {
    if (!text) return [];
    
    // split 전에 숫자 사이의 점(예: 3.1, 1919.3.1)을 임시 치환하여 쪼개짐 방지
    const protectedText = normalizeSpace(text)
        .replace(/\n+/g, " ")
        .replace(/(\d+)\s*\.\s*(\d+)/g, "$1__DECIMAL_DOT__$2");

    return protectedText
        .split(/(?<!\b[a-zA-Z])([.!?。])(?=\s+|$)/)
        .reduce((acc, curr, index, array) => {
            if (index % 2 === 0) {
                const punctuation = array[index + 1] || "";
                let sentence = (curr + punctuation).trim();
                // 치환했던 소수점 복원
                sentence = sentence.replace(/__DECIMAL_DOT__/g, ".");
                if (sentence) acc.push(sentence);
            }
            return acc;
        }, []);
}

export function extractImportantSentences(bodyText, introText = "", aliases = [], count = 2) {
    if (!bodyText || typeof bodyText !== "string") return "";

    const rawSentences = splitSentences(bodyText);
    const cleanedSentences = [];

    rawSentences.forEach((sentence, index) => {
        let text = cleanWikiText(sentence);

        if (!text || isIncompleteSentence(text)) return;
        if (/^[《<〈“"'`].*[》>〉”"'`]$/.test(text)) return;
        if (text.length < 15 || text.length > 320) return;

        // 🌟 [강력 차단] '자는', '호는', '시는', '본관은' 포함 문장은 후보 등록 자체를 거부!
        if (STRICT_GENEALOGY_REGEX.test(text)) return;

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

        if (GENEALOGY_REGEX.test(original)) score -= 80;
        if (MINOR_TMI_REGEX.test(original)) score -= 30;
        if (original.length >= 25 && original.length <= 150) score += 5;

        return { sentence: original, index, score };
    })
    // 🌟 [핵심] 점수가 0점 이하인 저품질/TMI 문장은 절대 최종 후보에 넣지 않음!
    .filter(item => item.score > 0);

    if (candidates.length === 0) return "";

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

    let intro = splitSentences(cleanWikiText(introText))
        .map(s => cleanGenealogyClause(s))
        .filter(Boolean)
        .join(" ");

    let body = splitSentences(cleanWikiText(bodyText))
        .map(s => cleanGenealogyClause(s))
        .filter(Boolean)
        .join(" ");

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
        return cleanSlice(purgeGenealogySentences(fallback));
    }

    // 🌟 [수정] 350자 미만 short text 분기에서도 이미 purgeGenealogySentences로 지워진 깔끔한 텍스트만 전달
    const totalLength = intro.length + body.length;
    if (totalLength < 350) {
        const combined = normalizeSpace([intro, body].filter(Boolean).join(" "));
        return cleanSlice(combined);
    }

    
    const introSentences = splitSentences(intro);
    let firstSentence = introSentences[0] || "";
    let usedSecondSentence = false;

    const secondSentence = introSentences[1] || "";
    if (secondSentence && !STRICT_GENEALOGY_REGEX.test(secondSentence)) {
        // 🌟 [수정] 첫 문장 글자 수 기준을 50자 -> 80자로 완화 (생몰년도 포함 문장 대응)
        if (firstSentence.length < 80 && introSentences.length > 1) {
            firstSentence += " " + secondSentence;
            usedSecondSentence = true;
        } else if (
            introSentences.length > 1 &&
            /(창시자|제정|대표|설립|창립|발명|발견|창안|업적|노벨|수상|혁명|독립|창조|고안|순국|옥사)/.test(secondSentence)
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
