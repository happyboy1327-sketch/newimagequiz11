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

const WIKI_AXIOS_CONFIG = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
    },
    timeout: 5000 
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

// =======================================================
// 5) 투트랙 최적화 캐시 충전
// =======================================================
async function fillCache() {
    if (isCaching) return;
    if (QUIZ_CACHE.length >= CACHE_SIZE) return;

    isCaching = true;
    let foundCount = 0; 
    let randomSearchAttempts = 0;

    console.log(`🔄 캐시 충전 시작 (현재: ${QUIZ_CACHE.length}/${CACHE_SIZE})`);

    while (QUIZ_CACHE.length < CACHE_SIZE && randomSearchAttempts < 10) {
        randomSearchAttempts++;
        try {
            // 1. 레거시/일반 모드 결정
            const isLegacyTurn = Math.random() < 0.6;
            let targetTitles = [];

            if (isLegacyTurn) {
                const shuffledVips = LEGACY_VIP_LIST.sort(() => Math.random() - 0.5).slice(0, 10);
                targetTitles = shuffledVips.filter(name => !QUIZ_CACHE.some(c => c.name.includes(name)));
            } else {
                // 1900~2000년생 카테고리 멤버 API 호출
                const year = Math.floor(Math.random() * (2000 - 900 + 1)) + 900;
                const listRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                    ...WIKI_AXIOS_CONFIG,
                    params: {
                        action: "query",
                        list: "categorymembers",
                        cmtitle: `분류:${year}년_출생`,
                        cmlimit: 50,
                        cmtype: "page",
                        format: "json",
                        origin: "*"
                    }
                });
                targetTitles = (listRes.data.query?.categorymembers || [])
                    .filter(c => !c.title.includes(":") && !QUIZ_CACHE.some(q => q.name === c.title))
                    .sort(() => Math.random() - 0.5)
                    .map(c => c.title).slice(0, 15);
            }

            if (targetTitles.length === 0) continue;

            // 2. [API 호출] 위키백과 상세 정보 가져오기
            const detailRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                ...WIKI_AXIOS_CONFIG,
                params: {
                    action: "query",
                    titles: targetTitles.join('|'),
                    prop: "extracts|pageimages",
                    explaintext: true,
                    pithumbsize: 600,
                    format: "json",
                    origin: "*"
                }
            });
            const pages = Object.values(detailRes.data.query?.pages || {});

            // 3. [병렬 처리] 페이지별 이미지 및 사진 유효성 검사
            const processTasks = pages.map(async (pageData) => {
                if (!pageData.extract || pageData.extract.length < 100) return null;
                // 교수님 컷
                if (!isLegacyTurn && /(대학교수|교수|석좌교수|교육자)/.test(pageData.extract)) return null;

                const aliases = makeNameAliases(pageData.title);
                // 유효성 검사 (isHumanPhoto, isValidImageUrl은 기존 함수 그대로 사용)
                if (pageData.thumbnail?.source && isValidImageUrl(pageData.thumbnail.source) && isHumanPhoto(pageData.pageimage || "", aliases)) {
                    return {
                        name: pageData.title,
                        image: pageData.thumbnail.source,
                        hint: createMaskedHint(pageData.title, pageData.extract),
                        description: pageData.extract.substring(0, 1000)
                    };
                }
                return null;
            });

            // 모든 검사를 병렬로 처리
            const results = await Promise.all(processTasks);
            
            // 4. 결과 취합
            results.forEach(item => {
                if (item && QUIZ_CACHE.length < CACHE_SIZE) {
                    QUIZ_CACHE.push(item);
                    foundCount++;
                }
            });

        } catch (e) {
            console.warn(`⚠️ API 검색 중 에러 발생: ${e.message}`);
        }
    }

    isCaching = false;
    console.log(`✅ 캐시 충전 종료 (이번에 ${foundCount}명 추가, 총 ${QUIZ_CACHE.length}명)`);
    
    // 5. [안전장치] 캐시 5개 이하일 때 재시도 (데이터 없으면 10초, 있으면 2초)
    if (QUIZ_CACHE.length <= 5) {
        const delay = (foundCount > 0) ? 2000 : 10000;
        console.log(`⏳ 다음 자동 충전까지 ${delay/1000}초 대기...`);
        setTimeout(fillCache, delay);
    }
}

fillCache();

// --- API ---
app.get("/api/quiz", async (req, res) => {
  try {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`; 

    if (QUIZ_CACHE.length === 0) {
        fillCache(); 
        let attempts = 0;
        while (QUIZ_CACHE.length === 0 && attempts < 15) { 
            await new Promise(resolve => setTimeout(resolve, 400));
            attempts++;
        }
    }
  
    const item = QUIZ_CACHE.shift();
  
    if (!item) {
        return res.status(503).json({ error: "데이터 준비 중입니다. 잠시 후 새로고침 해주세요.", requestId });
    }

    // 캐시가 5개 이하로 떨어지면 백그라운드 자동 충전
    if (QUIZ_CACHE.length <= 22) fillCache(); 

    LAST_PLAYED.push(item.name);
    if (LAST_PLAYED.length > 15) LAST_PLAYED.shift(); 

    res.json({ ...item, imageUrl: item.image, requestId });

  } catch (error) {
    console.error("API 오류 발생:", error);
    res.status(500).json({ error: "서버 내부 오류", errorId: `err_${Date.now()}` });
  }
});

app.use(express.static(path.join(process.cwd(), "public")));
app.get("/", (req, res) => res.sendFile(path.join(process.cwd(), "public", "index.html")));

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
