import express from "express";
import path from "path";
import axios from "axios";
import https from "https";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    if (req.path === '/api/quiz') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
        res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
    }
    next();
});

process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));

// ─────────────────────────────────────────────────────────
// ⚠️ Vercel 서버리스 관련 설계 노트
// - 이전 버전은 QUIZ_CACHE/fillCache로 "미리 창고를 채워두는" 구조였는데,
//   Vercel 서버리스 함수는 응답을 보낸 뒤 그대로 얼어붙어서 setTimeout 재귀 호출이
//   신뢰성 있게 이어지지 않음 → 캐시가 항상 비어있는 것과 마찬가지 상황이 됨.
// - 그래서 이번 버전은 "요청 하나가 들어오면 그 안에서 5개를 동시에 위키에 쏘고
//   제일 먼저 성공한 걸 즉시 반환"하는 방식으로 바꿈 (Promise.any 레이싱).
// - LAST_PLAYED는 같은 웜(warm) 인스턴스가 재사용될 때만 유효한 best-effort
//   중복 방지임. 완벽한 중복 방지가 필요하면 프론트에서 최근 본 이름들을
//   ?exclude=이름1,이름2 형태로 넘겨주는 방식을 추가하는 게 안전함.
// ─────────────────────────────────────────────────────────

let LAST_PLAYED = [];

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });

const WIKI_AXIOS_CONFIG = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
    },
    timeout: 4000, // 레이싱 방식이라 하나가 느리면 다른 게 이기게, 타임아웃을 짧게
    httpsAgent: keepAliveAgent
};

// 🔥 레거시 유명인물 (역사적 레전드 위인) 전용 VIP 풀
const LEGACY_VIP_LIST = [
    "세종대왕", "이순신", "안중근", "김구", "유관순", "윤동주", "윤봉길", "신사임당", "이황", "광개토대왕", "장수왕", "장영실",
    "모차르트", "베토벤", "파블로 피카소", "모네", "나폴레옹 보나파르트", "빈센트 반 고흐", "소크라테스", "플라톤", "아리스토텔레스", "공자",
    "알베르트 아인슈타인", "토머스 에디슨", "에이브러햄 링컨", "마하트마 간디", "마리 퀴리", "맹자",
    "레오나르도 다 빈치", "윌리엄 셰익스피어", "아이작 뉴턴", "갈릴레오 갈릴레이", "니콜라 테슬라",
    "헬렌 켈러", "잔 다르크", "조지 워싱턴", "크리스토퍼 콜럼버스", "찰스 다윈", "넬슨 만델라",
    "마틴 루터 킹 주니어", "어니스트 헤밍웨이", "안네 프랑크", "쇼팽", "클레오파트라 7세",
    "알렉산드로스 대왕", "율리우스 카이사르", "마더 테레사", "체 게바라", "오드리 헵번"
];

function makeNameAliases(title) {
    const cleanKo = title.replace(/\(.+?\)/g, "").trim();
    const lowerKo = cleanKo.toLowerCase();
    let aliases = [lowerKo, lowerKo.replace(/\s+/g, "_"), lowerKo.replace(/\s+/g, "-")];
    if (/모차르트/.test(cleanKo)) aliases.push("mozart");
    if (/베토벤/.test(cleanKo)) aliases.push("beethoven");
    if (/피카소/.test(cleanKo)) aliases.push("picasso");
    if (/간디/.test(cleanKo)) aliases.push("gandhi");
    if (/고흐/.test(cleanKo)) aliases.push("gogh");
    if (/나폴레옹/.test(cleanKo)) aliases.push("napoleon");
    return [...new Set(aliases)];
}

function isValidImageUrl(url) {
    if (!url || typeof url !== "string") return false;
    if (/\.svg(\?.*)?$/i.test(url) || /\/svg\//i.test(url)) return false;
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes("coat_of_arms") || lowerUrl.includes("emblem") || lowerUrl.includes("flag") || lowerUrl.includes("icon")) return false;
    return /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url);
}

function isHumanPhoto(filename, aliases) {
    if (!filename || typeof filename !== "string") return false;
    const n = filename.toLowerCase();

    const BLACKLIST = [
        "svg", "gif", "coat of arms", "coat_of_arms", "coa", "stone", "tomb", "_tomb",
        "arms", "emblem", "insignia", "flag", "standard", "banner", "seal", "stamp",
        "icon", "logo", "symbol", "map", "chart", "diagram", "signature", "sign",
        "grave", "monument", "book", "cover", "coin", "currency", "memorial", "plaque", "grave",
        "calligraphy", "handwriting", "manuscript", "document", "letter", "rubbing",
        "필적", "글씨", "서체", "문서", "편지", "탁본", "서간", "의궤", "집자", "현판", "비석", "묘",
        "충렬비", "기념비", "비각", "정려각", "사당", "전경", "생가", "현충사", "사적비", "정려", "탑", "릉"
    ];

    for (const badWord of BLACKLIST) {
        if (n.includes(badWord)) return false;
    }

    if (/(portrait|photo|face|profile|bust|painting|oil|canvas|illustration|hyakunin|statue)/i.test(n)) return true;

    for (const a of aliases) {
        if (!a) continue;
        const cleanName = a.replace(/[\s\-\_]/g, "");
        const cleanFile = n.replace(/[\s\-\_]/g, "");
        if (cleanFile.includes(cleanName)) return true;
    }

    return true;
}

function createMaskedHint(title, extract) {
    let hintText = extract.substring(0, 350);
    const cleanTitle = title.trim();

    const parenMatch = cleanTitle.match(/\((.*?)\)/);
    if (parenMatch) {
        parenMatch[1].split(/[\s\.\,\-]+/).forEach(part => {
            if (part.length > 1) hintText = hintText.replace(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), "OOO");
        });
    }

    const baseName = cleanTitle.replace(/\s*\(.*?\)\s*/g, '');
    baseName.split(' ').forEach(word => {
        if (word.length >= 2) {
            hintText = hintText.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), "OOO");
            if (word.length >= 3 && !/\s/.test(word)) {
                for (let i = 0; i <= word.length - 2; i++) {
                    hintText = hintText.replace(new RegExp(word.substring(i, i + 2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), "OOO");
                }
            }
        }
    });

    hintText = hintText.replace(/([a-zA-Z\d\.\,\:\-\s'\[\]\/\(\)ˌˈɛɔ]+)/g, (match, p1) => {
        const cleanedMatch = p1.trim();
        return (cleanedMatch.length > 1 && /[a-zA-Z]/.test(cleanedMatch)) ? "OOO" : match;
    });

    return hintText.substring(0, 130).trim() + "...";
}

// ─────────────────────────────────────────────────────────
// 위키백과를 한 번 찔러서 유효한 인물 배열을 반환하는 핵심 엔진
// 비레거시 경로는 "제목만 저렴하게 조회 → 필터링 → 소수만 상세조회" 2단계로 최적화
// ─────────────────────────────────────────────────────────
async function scoutWikipedia(forbiddenNames, forceLegacy = false) {
    try {
        const isLegacyTurn = forceLegacy || (Math.random() < 0.6);
        let pages = [];
        let isHistorical = false;

        if (isLegacyTurn) {
            const shuffledVips = LEGACY_VIP_LIST.sort(() => Math.random() - 0.5).slice(0, 10);
            const targetTitles = shuffledVips.filter(name => !forbiddenNames.has(name));
            if (targetTitles.length === 0) return [];

            const detailRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                ...WIKI_AXIOS_CONFIG,
                params: { action: "query", titles: targetTitles.join('|'), prop: "extracts|pageimages", explaintext: true, pithumbsize: 400, format: "json", origin: "*" }
            });
            pages = Object.values(detailRes.data.query?.pages || {});
        } else {
            const year = Math.random() < 0.5
                ? Math.floor(Math.random() * (2000 - 1900 + 1)) + 1900
                : Math.floor(Math.random() * (1899 - 900 + 1)) + 900;

            isHistorical = year < 1900;

            // 1단계: extract 없이 제목만 저렴하게 조회
            const listRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                ...WIKI_AXIOS_CONFIG,
                params: {
                    action: "query", generator: "categorymembers", gcmtitle: `분류:${year}년_출생`,
                    gcmlimit: 40, gcmtype: "page", format: "json", origin: "*"
                }
            });

            let candidates = Object.values(listRes.data.query?.pages || {})
                .filter(p => !p.title.includes(":") && !forbiddenNames.has(p.title));

            if (!isHistorical) {
                candidates = candidates.filter(p =>
                    !/\(.*\)|선수|음악|작가|기업|수학|과학|독립운동|미술|의사|간호사|영화/.test(p.title)
                );
            }

            candidates = candidates.slice(0, 12); // 필터링 통과한 소수만 상세 조회
            if (candidates.length === 0) return [];

            // 2단계: 살아남은 후보만 extract/이미지 포함 상세 조회
            const detailRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                ...WIKI_AXIOS_CONFIG,
                params: {
                    action: "query", titles: candidates.map(c => c.title).join('|'),
                    prop: "extracts|pageimages", explaintext: true, pithumbsize: 400,
                    format: "json", origin: "*"
                }
            });
            pages = Object.values(detailRes.data.query?.pages || {});
        }

        const processTasks = pages.map(async (pageData) => {
            if (!pageData.extract || pageData.extract.length < 100) return null;
            if (!isLegacyTurn && !isHistorical) {
                if (/(대학교수|교수|석좌교수|교육자)/.test(pageData.extract)) return null;
                if (/\(.*\)|선수|음악|작가|기업|수학|과학|독립운동|미술|의사|간호사|영화/.test(pageData.title)) return null;
            }

            let rawText = pageData.extract;
            const cutIndex = rawText.search(/==\s*(각주|같이 보기|참고 문헌|외부 링크)\s*==/i);
            if (cutIndex !== -1) rawText = rawText.substring(0, cutIndex);

            rawText = rawText.substring(0, 1200).replace(/=+\s*.*?\s*=+/g, " ").replace(/\s+/g, " ").trim();
            if (rawText.length < 100) return null;

            const aliases = makeNameAliases(pageData.title);
            if (pageData.thumbnail?.source && isValidImageUrl(pageData.thumbnail.source) && isHumanPhoto(pageData.pageimage || "", aliases)) {
                return {
                    name: pageData.title,
                    image: pageData.thumbnail.source,
                    hint: createMaskedHint(pageData.title, rawText),
                    description: rawText.length > 1000 ? rawText.substring(0, 1000) + "..." : rawText
                };
            }
            return null;
        });

        const results = await Promise.all(processTasks);
        return results.filter(item => item !== null);
    } catch (e) {
        return [];
    }
}

app.get("/api/quiz", async (req, res) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    try {
        const forbiddenNames = new Set(LAST_PLAYED);
        // 프론트에서 최근 본 이름들을 넘겨주면 서버리스 콜드스타트로 인한
        // LAST_PLAYED 초기화 문제를 보완할 수 있음 (선택사항, 없어도 동작함)
        if (req.query.exclude) {
            String(req.query.exclude).split(',').forEach(n => {
                if (n.trim()) forbiddenNames.add(n.trim());
            });
        }

        // 5개를 동시에 위키에 쏘고 제일 먼저 유효한 결과를 낸 놈이 승리
        const RACER_COUNT = 5;
        const racers = Array.from({ length: RACER_COUNT }, () =>
            scoutWikipedia(forbiddenNames).then(items => {
                const pick = items.find(it => !forbiddenNames.has(it.name));
                if (!pick) throw new Error("no valid candidate");
                return pick;
            })
        );

        let resolvedItem = null;
        try {
            // Vercel Hobby 플랜은 함수 실행시간이 10초로 하드캡되어 있고
            // (vercel.json이 builds 방식이라 maxDuration으로 못 늘림) 콜드스타트
            // 오버헤드까지 감안해 6.5초에서 끊음
            resolvedItem = await Promise.any([
                ...racers,
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6500))
            ]);
        } catch (e) {
            // 레이서 전원 실패 + 6.5초 타임아웃 → resolvedItem은 null
        }

        if (resolvedItem) {
            LAST_PLAYED.push(resolvedItem.name);
            if (LAST_PLAYED.length > 15) LAST_PLAYED.shift();
            return res.json({ ...resolvedItem, imageUrl: resolvedItem.image, requestId });
        }

        return res.status(503).json({
            error: "데이터 준비 중입니다. 잠시 후 새로고침 해주세요.",
            requestId
        });

    } catch (error) {
        console.error("API 오류 발생:", error);
        res.status(500).json({ error: "서버 내부 오류", errorId: `err_${Date.now()}` });
    }
});

app.use(express.static(path.join(process.cwd(), "public")));
app.get("/", (req, res) => res.sendFile(path.join(process.cwd(), "public", "index.html")));

// Vercel 환경에서는 상시 리스닝하지 않고 app을 그대로 export해서
// @vercel/node가 요청마다 핸들러로 사용하게 함. 로컬 개발 시에만 listen.
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}

export default app;
