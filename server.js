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
const CACHE_SIZE = 25;        
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
    "모차르트", "루트비히 판 베토벤", "파블로 피카소", "모네", "나폴레옹 보나파르트", "빈센트 반 고흐",
    "알베르트 아인슈타인", "토머스 에디슨", "에이브러햄 링컨", "마하트마 간디", "마리 퀴리",
    "레오나르도 다 빈치", "윌리엄 셰익스피어", "아이작 뉴턴", "갈릴레오 갈릴레이", "니콜라 테슬라", 
    "헬렌 켈러", "잔 다르크", "조지 워싱턴", "크리스토퍼 콜럼버스", "찰스 다윈", "넬슨 만델라", "소크라테스", "아리스토텔레스", "플라톤", "공자", "맹자",
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
        "grave", "monument", "book", "cover", "coin", "currency", "memorial", "plaque", 
        "calligraphy", "handwriting", "manuscript", "document", "letter", "rubbing",
        "필적", "글씨", "서체", "문서", "편지", "탁본", "서간", "의궤", "집자", "현판", "비석",
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
    console.log(`🔄 투트랙 캐시 충전 가동 (현재 상태: ${QUIZ_CACHE.length}/${CACHE_SIZE})`);
    
    let randomSearchAttempts = 0;

    while (QUIZ_CACHE.length < CACHE_SIZE && randomSearchAttempts < 10) {
        if (QUIZ_CACHE.length >= CACHE_SIZE) break;
        randomSearchAttempts++;

        try {
            // 🔥 30% 확률로 레거시 위인 출현, 70%는 사진 빵빵한 근현대 인물
            const isLegacyTurn = Math.random() < 0.6;
            let targetTitles = [];

            if (isLegacyTurn) {
                const shuffledVips = LEGACY_VIP_LIST.sort(() => Math.random() - 0.5).slice(0, 16);
                targetTitles = shuffledVips.filter(name => !QUIZ_CACHE.some(c => c.name.includes(name)) && !LAST_PLAYED.some(lp => lp.includes(name)));
            } else {
                // 무한 렉 방지: 랜덤 연도를 무조건 사진이 있는 1900년~2000년 사이로 한정!!
                const year = Math.floor(Math.random() * (2000 - 900 + 1)) + 900;
                const listRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                    ...WIKI_AXIOS_CONFIG,
                    params: {
                        action: "query",
                        list: "categorymembers",
                        cmtitle: `분류:${year}년_출생`,
                        cmlimit: 60, 
                        cmtype: "page",
                        format: "json",
                        origin: "*"
                    }
                });

                const candidates = listRes.data.query?.categorymembers || [];
                targetTitles = candidates
                    .filter(cand => !cand.title.includes(":") && !QUIZ_CACHE.some(c => c.name === cand.title) && !LAST_PLAYED.includes(cand.title))
                    .filter(cand => !/\(.*\)|선수|음악|작가|기업|수학|과학|독립운동|미술|의사|간호사|영화/.test(cand.title))
                    .sort(() => Math.random() - 0.5)
                    .map(c => c.title)
                    .slice(0, 15); 
            }

            if (targetTitles.length > 0) {
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

                for (const pageData of pages) {
                    if (QUIZ_CACHE.length >= CACHE_SIZE) break; 
                    if (!pageData || !pageData.extract || pageData.extract.length < 100) continue;
                    if (!isLegacyTurn && /(대학교수|명예교수|석좌교수|교수|교육자)/.test(pageData.extract)) continue;

                    const aliases = makeNameAliases(pageData.title);

                    if (pageData.thumbnail?.source && isValidImageUrl(pageData.thumbnail.source) && isHumanPhoto(pageData.pageimage || "", aliases)) {
                        
                        if (QUIZ_CACHE.some(cached => cached.name === pageData.title)) continue;

                        let rawText = pageData.extract;
                        const cutIndex = rawText.search(/==\s*(각주|같이 보기|참고 문헌|외부 링크)\s*==/i);
                        if (cutIndex !== -1) rawText = rawText.substring(0, cutIndex);
                        
                        rawText = rawText.substring(0, 1200).replace(/=+\s*.*?\s*=+/g, " ").replace(/\s+/g, " ").trim();
                        if (rawText.length < 100) continue;

                        QUIZ_CACHE.push({
                            name: pageData.title,
                            image: pageData.thumbnail.source,
                            hint: createMaskedHint(pageData.title, rawText), 
                            description: rawText.length > 1000 ? rawText.substring(0, 1000) + "..." : rawText 
                        });
                        console.log(`   [캐시 적재 완료] 👤 ${pageData.title} ${isLegacyTurn ? '(⭐레거시VIP)' : ''}`);
                    }
                }
            }
                } catch (e) {
            console.error("채굴 중 오류:", e.message);
        } finally {
            isCaching = false;

            // 최근 30초 이내에 유저가 요청을 보냈을 때만 백그라운드 타이머 작동
            const isPageActive = Date.now() - LAST_ACTIVE < 30000;

            if (QUIZ_CACHE.length < CACHE_SIZE && isPageActive) {
                // 🔥 [핵심: 긴급 가속 페달] 
                // 캐시가 5개 미만으로 떨어지면 1.5초씩 쉴 여유가 없습니다. 
                // 0.1초(100ms)만 쉬고 곧바로 다음 인물 캐러 출동하게 만듭니다!
                const nextDelay = QUIZ_CACHE.length < 5 ? 100 : 1500;
                
                setTimeout(fillCache, nextDelay); 
            }
            resolve();
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

    //; 

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
