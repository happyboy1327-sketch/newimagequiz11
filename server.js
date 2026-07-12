import express from "express";
import path from "path";
import axios from "axios";
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

// --- 설정 ---
const CACHE_SIZE = 40;        
let QUIZ_CACHE = [];
let LAST_PLAYED = [];
let isCaching = false;
import https from "https";
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });

const WIKI_AXIOS_CONFIG = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
    },
    timeout: 6500,
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

    // 동상(위인들)은 허용하되, 글씨만 있는 비석/충렬비 등은 빡세게 컷
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
                for(let i = 0; i <= word.length - 2; i++) {
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



// 1. 위키백과를 한 번 찔러서 유효한 인물 '배열'을 반환하는 핵심 단독 엔진
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

    // 1단계: 제목만 저렴하게 조회 (extract 없음)
    const listRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
        ...WIKI_AXIOS_CONFIG,
        params: {
            action: "query", generator: "categorymembers", gcmtitle: `분류:${year}년_출생`,
            gcmlimit: 40, gcmtype: "page", format: "json", origin: "*"
        }
    });

    let candidates = Object.values(listRes.data.query?.pages || {})
        .filter(page => !page.title.includes(":") && !forbiddenNames.has(page.title));

    if (!isHistorical) {
        candidates = candidates.filter(page =>
            !/\(.*\)|선수|음악|작가|기업|수학|과학|독립운동|미술|의사|간호사|영화/.test(page.title)
        );
    }

    candidates = candidates.slice(0, 12); // 살아남은 것만 상세 조회
    if (candidates.length === 0) return [];

    // 2단계: 필터링 통과한 소수만 extract/이미지 요청
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

// 2. 평상시 백그라운드에서 조용히 대량으로 캐시를 모으는 함수
async function fillCache() {
    if (isCaching) return;
    if (QUIZ_CACHE.length >= CACHE_SIZE) return;

    isCaching = true;
    const forbiddenNames = new Set([...LAST_PLAYED, ...QUIZ_CACHE.map(q => q.name)]);

    try {
        // 평상시엔 3발만 동시 발사해 백그라운드 부하 최소화
        const concurrentAttempts = [
            scoutWikipedia(forbiddenNames),
            scoutWikipedia(forbiddenNames),
            scoutWikipedia(forbiddenNames),
            scoutWikipedia(forbiddenNames),
            scoutWikipedia(forbiddenNames)
        ];
        const allResults = await Promise.all(concurrentAttempts);

        allResults.flat().forEach(item => {
    if (item && QUIZ_CACHE.length < CACHE_SIZE) {
        // 🛑 스냅샷 대신 넣는 순간의 최신 배열 상태를 직접 확인
        const isDuplicate = LAST_PLAYED.includes(item.name) || QUIZ_CACHE.some(q => q.name === item.name);
        if (!isDuplicate) {
            QUIZ_CACHE.push(item);
        }
    }
});

    } catch (err) {
        console.error("백그라운드 캐싱 에러:", err);
    } finally {
        isCaching = false;
        if (QUIZ_CACHE.length < CACHE_SIZE) {
            setTimeout(fillCache, 1500);
        }
    }
}

app.get("/api/quiz", async (req, res) => {
    try {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const forbiddenNames = new Set([...LAST_PLAYED, ...QUIZ_CACHE.map(q => q.name)]);

        // [경로 A] 창고에 물건이 존재하면? 0초 만에 낚아채서 즉시 반환
        if (QUIZ_CACHE.length > 0) {
            const item = QUIZ_CACHE.shift();
            
            LAST_PLAYED.push(item.name);
            if (LAST_PLAYED.length > 15) LAST_PLAYED.shift();
            
            // 캐시가 22개 이하로 떨어지면 충전 요청 (두 번째 블록 조건 적용)
            if (QUIZ_CACHE.length <= 30) fillCache(); 
            return res.json({ ...item, imageUrl: item.image, requestId });
        }

        // [경로 B] 🚨 비상 상황: 캐시가 0개다! 꼼수 없이 위키백과 정면 돌파 + 레이싱 가동
        console.warn("🚨 캐시 전멸! 레이싱 엔진 및 백그라운드 충전 동시 가동합니다.");
        
        // 백그라운드 일반 충전도 같이 트리거
        fillCache(); 

        let resolvedItem = null;
        
        // 5발 레이서 동시 발사
        //;

        const racers = Array.from({ length: 5 }, async () => {
    if (resolvedItem) return; 
    
    const items = await scoutWikipedia(forbiddenNames, true); 
    if (items.length > 0 && !resolvedItem) {
        // 🛑 1등 골인 직전 실시간 중복 체크
        const isDuplicate = LAST_PLAYED.includes(items[0].name) || QUIZ_CACHE.some(q => q.name === items[0].name);
        if (!isDuplicate && !resolvedItem) {
            resolvedItem = items[0]; 
        }
        
        // 🛑 남은 짜바리 데이터들도 실시간으로 중복 검사하며 창고에 적립
        items.slice(1).forEach(subItem => {
            if (QUIZ_CACHE.length < CACHE_SIZE) {
                const isSubDuplicate = LAST_PLAYED.includes(subItem.name) || 
                                       QUIZ_CACHE.some(q => q.name === subItem.name) || 
                                       (resolvedItem && resolvedItem.name === subItem.name);
                if (!isSubDuplicate) {
                    QUIZ_CACHE.push(subItem);
                }
            }
        });
    }
});


        // 🔗 통합 체크 루프: 레이싱 결과(resolvedItem)가 나오거나, 
        // 혹은 fillCache()가 백그라운드에서 먼저 긁어와서 QUIZ_CACHE에 넣을 때까지 양쪽 다 감시함
        for (let i = 0; i < 15; i++) {
            if (resolvedItem || QUIZ_CACHE.length > 0) break;
            await new Promise(resolve => setTimeout(resolve, 200)); // 0.2초마다 촘촘하게 체크
        }

        // 레이싱 엔진이 먼저 물어온 경우
        if (resolvedItem) {
            LAST_PLAYED.push(resolvedItem.name);
            if (LAST_PLAYED.length > 15) LAST_PLAYED.shift();
            
            fillCache();
            return res.json({ ...resolvedItem, imageUrl: resolvedItem.image, requestId });
        }

        // 레이싱은 늦었지만 fillCache가 먼저 창고에 채워 넣은 경우 (기존 while 루프의 안전망 역할)
        if (QUIZ_CACHE.length > 0) {
            const item = QUIZ_CACHE.shift();
            
            LAST_PLAYED.push(item.name);
            if (LAST_PLAYED.length > 15) LAST_PLAYED.shift();
            
            if (QUIZ_CACHE.length <= 22) fillCache();
            return res.json({ ...item, imageUrl: item.image, requestId });
        }

        // 둘 다 실패해서 진짜 아무것도 안 나왔을 때의 최종 컷트라인
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

// 서버 구동 시 예열
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    fillCache(); // 서버 켜지자마자 미리 땡겨놓기
});
