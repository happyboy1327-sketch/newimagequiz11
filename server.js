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
// 🚀 핵심: 백그라운드 퀴즈 캐시 풀(Pool) 설정
// ─────────────────────────────────────────────────────────
let QUIZ_POOL = [];          // 미리 대기 중인 퀴즈 저장소
const MAX_POOL_SIZE = 5;     // 상시 대기시킬 퀴즈 개수
let LAST_PLAYED = [];        // 최근 출제된 인물 중복 방지 캐시
let isRefilling = false;     // 백그라운드 중복 작업 방지 플래그

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 15 });

const WIKI_AXIOS_CONFIG = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
    },
    timeout: 3000, 
    httpsAgent: keepAliveAgent
};

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
        "grave", "monument", "book", "cover", "coin", "currency", "memorial", "plaque",
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

    const baseName = cleanTitle.replace(/\s*\(.*?\)\s*/g, '');
    baseName.split(' ').forEach(word => {
        if (word.length >= 2) {
            hintText = hintText.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), "OOO");
        }
    });

    hintText = hintText.replace(/([a-zA-Z\d\.\,\:\-\s'\[\]\/\(\)ˌˈɛɔ]+)/g, (match, p1) => {
        const cleanedMatch = p1.trim();
        return (cleanedMatch.length > 1 && /[a-zA-Z]/.test(cleanedMatch)) ? "OOO" : match;
    });

    return hintText.substring(0, 140).trim() + "...";
}

async function scoutWikipedia(forbiddenNames, type = "random") {
    try {
        let params = {
            action: "query",
            prop: "extracts|pageimages",
            explaintext: true,
            pithumbsize: 400,
            format: "json",
            origin: "*"
        };

        if (type === "legacy") {
            const shuffledVips = LEGACY_VIP_LIST.sort(() => Math.random() - 0.5).slice(0, 3);
            const targetTitles = shuffledVips.filter(name => !forbiddenNames.has(name));
            if (targetTitles.length === 0) return [];
            params.titles = targetTitles.join('|');
        } else {
            const year = Math.random() < 0.5
                ? Math.floor(Math.random() * (2000 - 1900 + 1)) + 1900
                : Math.floor(Math.random() * (1899 - 1000 + 1)) + 1000;

            params.generator = "categorymembers";
            params.gcmtitle = `분류:${year}년_출생`;
            params.gcmlimit = 10;
            params.gcmtype = "page";
        }

        const res = await axios.get("https://ko.wikipedia.org/w/api.php", {
            ...WIKI_AXIOS_CONFIG,
            params
        });

        const pages = Object.values(res.data.query?.pages || {});
        
        return pages.map((pageData) => {
            if (!pageData.extract || pageData.extract.length < 120) return null;
            if (type === "random") {
                if (/\(.*\)|선수|음악|작가|기업|과학|의사|영화/.test(pageData.title)) return null;
                if (/(대학교수|교수|교육자)/.test(pageData.extract)) return null;
            }

            let rawText = pageData.extract;
            const cutIndex = rawText.search(/==\s*(각주|같이 보기|참고 문헌|외부 링크)\s*==/i);
            if (cutIndex !== -1) rawText = rawText.substring(0, cutIndex);

            rawText = rawText.substring(0, 1200).replace(/=+\s*.*?\s*=+/g, " ").replace(/\s+/g, " ").trim();
            if (rawText.length < 120) return null;

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
        }).filter(Boolean);
    } catch (e) {
        return [];
    }
}

// ─────────────────────────────────────────────────────────
// 🔄 백그라운드 퀴즈 충전기 (비동기로 풀을 항상 채워둠)
// ─────────────────────────────────────────────────────────
async function refillQuizPool() {
    if (isRefilling || QUIZ_POOL.length >= MAX_POOL_SIZE) return;
    isRefilling = true;

    try {
        while (QUIZ_POOL.length < MAX_POOL_SIZE) {
            const forbiddenNames = new Set([
                ...LAST_PLAYED, 
                ...QUIZ_POOL.map(q => q.name) // 현재 풀에 대기 중인 이름도 중복 예방
            ]);

            // 기존 레이싱 정공법 그대로 백그라운드에서 빌드
            const racers = [
                scoutWikipedia(forbiddenNames, "legacy"),
                scoutWikipedia(forbiddenNames, "random")
            ].map(p => p.then(items => {
                const pick = items.find(it => !forbiddenNames.has(it.name));
                if (!pick) throw new Error("no candidate");
                return pick;
            }));

            try {
                const newQuiz = await Promise.any([
                    ...racers,
                    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000))
                ]);

                if (newQuiz) {
                    QUIZ_POOL.push(newQuiz);
                    console.log(`[Cache Backup] 문제 충전 완료. 현재 큐 크기: ${QUIZ_POOL.length}/${MAX_POOL_SIZE} (${newQuiz.name})`);
                }
            } catch (err) {
                // 한 루프 실패 시 위키백과 과부하 방지를 위해 잠깐 쉬고 재시도
                await new Promise(res => setTimeout(res, 500));
            }
        }
    } finally {
        isRefilling = false;
    }
}

// ─────────────────────────────────────────────────────────
// 🎯 라우터: 위키백과를 가지 않고 캐시에서 즉시 반환 (0ms)
// ─────────────────────────────────────────────────────────
app.get("/api/quiz", async (req, res) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // 프론트에서 제외 요청한 이름 필터링
    const excludes = req.query.exclude ? String(req.query.exclude).split(',').map(n => n.trim()) : [];

    // 1. 캐시에 대기 중인 문제가 있으면 바로 분기
    if (QUIZ_POOL.length > 0) {
        // 프론트 exclude 조건에 안 걸리는 놈 우선 탐색
        let targetIndex = QUIZ_POOL.findIndex(q => !excludes.includes(q.name));
        if (targetIndex === -1) targetIndex = 0; // 다 걸리면 그냥 맨 앞 피킹

        const resolvedItem = QUIZ_POOL.splice(targetIndex, 1)[0];

        // 최근 플레이 등록 및 관리
        LAST_PLAYED.push(resolvedItem.name);
        if (LAST_PLAYED.length > 15) LAST_PLAYED.shift();

        // ⚡ 핵심: 문제 꺼내줬으니 백그라운드 충전기 즉시 가동 (유저를 대기시키지 않음)
        refillQuizPool();

        return res.json({ ...resolvedItem, imageUrl: resolvedItem.image, requestId });
    }

    // 2. 만약 서버 급가동 등으로 캐시가 비어있다면 최후의 보루로 동기 직접 수집 수행
    try {
        const forbiddenNames = new Set([...LAST_PLAYED, ...excludes]);
        const items = await scoutWikipedia(forbiddenNames, "legacy");
        const pick = items.find(it => !forbiddenNames.has(it.name));
        
        if (pick) {
            LAST_PLAYED.push(pick.name);
            if (LAST_PLAYED.length > 15) LAST_PLAYED.shift();
            refillQuizPool(); // 백그라운드 충전 가동
            return res.json({ ...pick, imageUrl: pick.image, requestId });
        }
    } catch (e) {}

    // 진짜 텅 비었을 때 대기 전송
    refillQuizPool();
    return res.status(503).json({ error: "문제를 준비 중입니다. 잠시 후 다시 시도해 주세요.", requestId });
});

app.use(express.static(path.join(process.cwd(), "public")));
app.get("/", (req, res) => res.sendFile(path.join(process.cwd(), "public", "index.html")));

if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
        // ⭐ 서버 구동 시작하자마자 백그라운드 풀 풀가동 시키기
        refillQuizPool();
    });
}

export default app;
