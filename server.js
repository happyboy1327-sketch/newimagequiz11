import express from "express";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// 🔥 [보안/성능 개선] Express 관련 헤더 설정
app.disable('x-powered-by');

app.use((req, res, next) => {
    // 보안 헤더
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // 캐시 제어
    if (req.path === '/api/quiz') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
        res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
    }
    
    next();
});

// 프로세스 수준 안전장치
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err && err.stack ? err.stack : err);
});

// --- 설정 ---
const CACHE_SIZE = 25;        
const VALIDATION_TRY = 2;    

// --- 기존 퀴즈풀의 유명 인물 리스트 (검색 우선순위) ---
const LEGACY_NAMES = [
  "이순신", "세종대왕", "알베르트 아인슈타인", "에이브러햄 링컨", "마하트마 간디",
  "유관순", "안중근", "김구", "윤동주", "레오나르도 다 빈치", "윤봉길", "아리스토텔레스", "갈릴레오 갈릴레이",
  "미켈란젤로 부오나로티", "빈센트 반 고흐", "파블로 피카소", "아이작 뉴턴", "찰스 다윈",
  "토머스 에디슨", "니콜라 테슬라", "스티브 잡스", "빌 게이츠", "마리 퀴리",
  "루트비히 판 베토벤", "볼프강 아마데우스 모차르트", "윌리엄 셰익스피어", "나폴레옹 보나파르트",
  "칭기즈 칸", "알렉산드로스 3세", "줄리어스 시저", "조지 워싱턴", "넬슨 만델라"
];

let QUIZ_CACHE = [];
let isCaching = false;
let cachePromise = null; 

const WIKI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Accept': 'application/json'
};

// ===============================
// 1) 이름 alias 자동 생성
// ===============================
function makeNameAliases(title) {
    const cleanKo = title.replace(/\(.+?\)/g, "").trim();
    const lowerKo = cleanKo.toLowerCase();

    let aliases = [
        lowerKo,
        lowerKo.replace(/\s+/g, "_"),
        lowerKo.replace(/\s+/g, "-")
    ];

    if (/모차르트/.test(cleanKo)) aliases.push("mozart");
    if (/베토벤/.test(cleanKo)) aliases.push("beethoven");
    if (/피카소/.test(cleanKo)) aliases.push("picasso");
    if (/간디/.test(cleanKo)) aliases.push("gandhi");
    if (/고흐/.test(cleanKo)) aliases.push("gogh");
    if (/나폴레옹/.test(cleanKo)) aliases.push("napoleon");

    return [...new Set(aliases)];
}

// ===============================
// 2) OG 이미지 추출 (HTML 파싱용)
// ===============================
function extractOgImage(html) {
    const match = html.match(/<meta\s+property="og:image"\s+content="(.*?)"/i);
    if (match && match[1]) {
        return match[1].replace(/&amp;/g, '&');
    }
    return null;
}

// ===============================
// 3) 이미지 URL 유효성 검사 (SVG 및 키워드 차단)
// ===============================
function isValidImageUrl(url) {
    if (!url || typeof url !== "string") return false;
    
    if (/\.svg(\?.*)?$/i.test(url)) return false;
    if (/\/svg\//i.test(url)) return false;
    
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes("coat_of_arms")) return false;
    if (lowerUrl.includes("emblem")) return false;
    if (lowerUrl.includes("flag")) return false;
    if (lowerUrl.includes("icon")) return false;
    
    return /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url);
}

// ===============================
// 4) [강력 필터] 사람 사진 판별기 (휘장/심볼 완벽 차단)
// ===============================
function isHumanPhoto(filename, aliases) {
    if (!filename || typeof filename !== "string") return false;
    const n = filename.toLowerCase();

    const BLACKLIST = [
        "svg", "gif",                   
        "coat of arms", "coat_of_arms", 
        "coa", 
        "stone",
        "tomb", "_tomb",
        "arms",                         
        "emblem",                       
        "insignia",                     
        "flag", "standard", "banner",   
        "seal", "stamp",                
        "icon", "logo", "symbol",       
        "map", "chart", "diagram",      
        "signature", "sign",            
        "grave", "tomb", "monument",    
        "book", "cover",                
        "coin", "currency",             
        "statue", "sculpture",          
        "memorial", "plaque", "doctrinae",
        "landscape", "architectures" 
    ];

    for (const badWord of BLACKLIST) {
        if (n.includes(badWord)) return false;
    }
    
    if (/(portrait|photo|face|profile|bust|painting|oil|canvas)/i.test(n)) return true;

    for (const a of aliases) {
        if (!a) continue;
        const cleanName = a.replace(/[\s\-\_]/g, "");
        const cleanFile = n.replace(/[\s\-\_]/g, "");
        if (cleanFile.includes(cleanName)) return true;
    }

    return true;
}

// ===============================
// 5) getStableMainImage - 개선된 버전
// ===============================
async function getStableMainImage(title) {
    const aliases = makeNameAliases(title);
    
    try {
        const thumbRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
            headers: WIKI_HEADERS,
            params: {
                action: "query",
                titles: title,
                prop: "pageimages",
                pithumbsize: 600,
                format: "json",
                origin: "*"
            }
        });
        const page = Object.values(thumbRes.data.query.pages)[0];
        const thumbUrl = page?.thumbnail?.source;
        const thumbName = page?.pageimage || "";

        if (thumbUrl && isValidImageUrl(thumbUrl) && isHumanPhoto(thumbName, aliases)) {
            return thumbUrl;
        }
    } catch (e) {}

    try {
        const htmlRes = await axios.get(
            `https://ko.wikipedia.org/wiki/${encodeURIComponent(title)}`,
            { headers: WIKI_HEADERS }
        );
        const html = htmlRes.data;

        const ogImage = extractOgImage(html);
        if (ogImage && isValidImageUrl(ogImage)) {
            return ogImage;
        }

        const infoboxMatch = html.match(/<table[^>]*class="[^"]*infobox[^"]*"[^>]*>[\s\S]*?<\/table>/i);
        if (infoboxMatch) {
            const srcMatch = infoboxMatch[0].match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
            if (srcMatch && srcMatch[1]) {
                let src = srcMatch[1];
                if (src.startsWith("//")) src = "https:" + src;
                
                if (isValidImageUrl(src) && !/pixel\.gif|blank\.gif/i.test(src)) {
                     return src;
                }
            }
        }
    } catch (e) {}

    try {
        const imgListRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
            headers: WIKI_HEADERS,
            params: {
                action: "query",
                titles: title,
                prop: "images",
                imlimit: 55,
                format: "json",
                origin: "*"
            }
        });

        const page = Object.values(imgListRes.data.query.pages)[0];
        const imgs = page.images || [];
        const candidates = imgs.filter(i => isHumanPhoto(i.title, aliases));

        for (const c of candidates) {
            const infoRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                headers: WIKI_HEADERS,
                params: {
                    action: "query",
                    titles: c.title,
                    prop: "imageinfo",
                    iiprop: "url",
                    format: "json",
                    origin: "*"
                }
            });
            const info = Object.values(infoRes.data.query.pages)[0];
            const url = info.imageinfo?.[0]?.url;

            if (isValidImageUrl(url)) {
                return url;
            }
        }
    } catch (e) {}

    console.log(`❌ 최종 이미지 실패: ${title}`);
    return null;
}

// --- 이미지 URL 안정성 체크 ---
async function checkUrlStability(url) {
    if (!url) return false;
    try {
        const res = await axios.head(url, {
            headers: WIKI_HEADERS,
            timeout: 1000
        });
        return res.status === 200;
    } catch (e) {
        try {
            const res = await axios.get(url, { 
                headers: WIKI_HEADERS, 
                timeout: 1000, 
                responseType: "stream" 
            });
            return res.status === 200;
        } catch(err) {
            return false; 
        }
    }
}

async function validateImage(url) {
    for (let i = 0; i < VALIDATION_TRY; i++) {
        if (await checkUrlStability(url)) {
            return true;
        }

        // 마지막 시도가 아니면 잠시 대기
        if (i < VALIDATION_TRY - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    return false;
}

// --- 공통 힌트 마스킹 함수 ---
function createMaskedHint(title, extract) {
    let hintText = extract;
    const cleanTitle = title.trim();
    const parenMatch = cleanTitle.match(/\((.*?)\)/);
    if (parenMatch) {
        const parenContent = parenMatch[1]; 
        parenContent.split(/[\s\.\,\-]+/).forEach(part => {
            if (part.length > 1) {
                const safePart = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                hintText = hintText.replace(new RegExp(safePart, 'gi'), "OOO");
            }
        });
    }
    const baseName = cleanTitle.replace(/\s*\(.*?\)\s*/g, ''); 
    const nameParts = baseName.split(' ');
    nameParts.forEach(word => {
        if (word.length >= 2) {
            hintText = hintText.replace(new RegExp(word, 'gi'), "OOO");
            if (word.length >= 3 && !/\s/.test(word)) { 
                for(let i = 0; i <= word.length - 2; i++) {
                    const chunk = word.substring(i, i + 2);
                    hintText = hintText.replace(new RegExp(chunk, 'gi'), "OOO");
                }
            }
        }
    });
    hintText = hintText.replace(/([a-zA-Z\d\.\,\:\-\s'\[\]\/\(\)ˌˈɛɔ]+)/g, (match, p1) => {
        const cleanedMatch = p1.trim();
        if (cleanedMatch.length > 1 && /[a-zA-Z]/.test(cleanedMatch)) {
            return "OOO";
        }
        return match; 
    });

    return hintText.substring(0, 130) + "...";
}

// =======================================================
// 🔥 [핵심 수정] 데이터 채굴 로직 - 15명 대량 병렬 처리 버전
// =======================================================
async function fillCache() {
    if (isCaching || QUIZ_CACHE.length >= CACHE_SIZE) return;
    isCaching = true;

    cachePromise = new Promise(async (resolve) => {
        console.log("⛏️ 데이터 채굴 시작...");

        try {
            // -------------------------------------------------------
            // 1. LEGACY 유명인 우선 시도 (5명 묶어서 한 번에 병렬 처리)
            // -------------------------------------------------------
            if (QUIZ_CACHE.length < CACHE_SIZE && Math.random() < 0.85) { 
                const famousCandidates = LEGACY_NAMES
                .sort(() => Math.random() - 0.5)
                .slice(0, 5); // 3에서 5로 변경

                const detailRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                    headers: WIKI_HEADERS,
                    params: {
                        action: "query",
                        titles: famousCandidates.join('|'),
                        prop: "extracts",
                        exintro: true,
                        explaintext: true,
                        format: "json",
                        origin: "*"
                    }
                });

                const pages = Object.values(detailRes.data.query?.pages || {});
                
                // 유명인 5명 병렬 검증
                const legacyPromises = pages.map(async (pageData) => {
                    try {
                        if (!pageData || !pageData.extract || pageData.extract.length < 30) return null;

                        const imgUrl = await getStableMainImage(pageData.title);
                        if (!imgUrl) return null;
                        
                        const isStable = await validateImage(imgUrl);
                        if (!isStable) return null;

                        return {
                            name: pageData.title,
                            image: imgUrl,
                            hint: createMaskedHint(pageData.title, pageData.extract),
                            description: pageData.extract
                        };
                    } catch (e) {
                        return null;
                    }
                });

                const legacyResults = await Promise.all(legacyPromises);
                for (const item of legacyResults) {
                    if (item && QUIZ_CACHE.length < CACHE_SIZE) {
                        QUIZ_CACHE.push(item);
                    }
                }
            }

            // -------------------------------------------------------
            // 2. 랜덤 연도 탐색 (★ 15명 풀확보 + Promise.all 일괄 병렬 스캔)
            // -------------------------------------------------------
            let randomSearchAttempts = 0;

            while (QUIZ_CACHE.length < CACHE_SIZE && randomSearchAttempts < 3) {
                const year = Math.floor(Math.random() * (2000 - 500 + 1)) + 500;

                const listRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                    headers: WIKI_HEADERS,
                    params: {
                        action: "query",
                        list: "categorymembers",
                        cmtitle: `분류:${year}년_출생`,
                        cmlimit: 80, // 15명을 안정적으로 필터링하기 위해 80명 로드
                        cmtype: "page",
                        format: "json",
                        origin: "*"
                    }
                });

                const candidates = listRes.data.query?.categorymembers || [];

                const filteredCandidates = candidates
                    .filter(cand => {
                        if (cand.title.includes(":")) return false; 
                        return !/\(.*\)|선수|음악|작가|기업|수학|과학|독립운동|미술|의사|간호사|영화/.test(cand.title);
                    })
                    .sort(() => Math.random() - 0.5)
                    .slice(0, 15); // ★ 랜덤 인물 추출 한도를 15명으로 전격 상향!

                if (filteredCandidates.length > 0) {
                    const detailRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                        headers: WIKI_HEADERS,
                        params: {
                            action: "query",
                            titles: filteredCandidates.map(c => c.title).join('|'),
                            prop: "extracts",
                            exintro: true,
                            explaintext: true,
                            format: "json",
                            origin: "*"
                        }
                    });

                    const pages = Object.values(detailRes.data.query?.pages || {});
                    
                    // ★ 핵심: 15명의 본문 길이 및 이미지 존재 여부를 한 명씩 기다리지 않고 동시에(In Parallel) 검증
                    const validationPromises = pages.map(async (pageData) => {
                        try {
                            if (!pageData || !pageData.extract || pageData.extract.length < 300) return null;
                            
                            const extract = pageData.extract;

                            if (/(대학교수|명예교수|석좌교수|교수|교육자)/.test(extract)) {
                            return null;
                            }

                            const imgUrl = await getStableMainImage(pageData.title);
                            if (!imgUrl) return null;
                            
                            const isStable = await validateImage(imgUrl);
                            if (!isStable) return null;

                            return {
                                name: pageData.title,
                                image: imgUrl,
                                hint: createMaskedHint(pageData.title, pageData.extract),
                                description: pageData.extract
                            };
                        } catch (e) {
                            return null;
                        }
                    });

                    const results = await Promise.all(validationPromises);
                    
                    // 성공적으로 통과한 인물들만 골라서 캐시 저장소에 push
                    for (const item of results) {
                        if (item && QUIZ_CACHE.length < CACHE_SIZE) {
                            QUIZ_CACHE.push(item);
                        }
                    }
                }

                randomSearchAttempts++;
            }
        } catch (e) {
            console.error("채굴 중 오류:", e.message);
        } finally {
            isCaching = false;
            if (QUIZ_CACHE.length < 5) setTimeout(fillCache, 3000);
            resolve();
        }
    });

    return cachePromise;
}

fillCache();

// --- API ---
app.get("/api/quiz", async (req, res) => {
  try {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`; 
    console.log(`[Request] New request: ${requestId}`);

    if (QUIZ_CACHE.length === 0) {
        if (!isCaching) fillCache(); 
        if (cachePromise) await cachePromise;
    }
  
    const item = QUIZ_CACHE.shift();
  
    if (!item) {
        return res.status(503).json({ error: "데이터 준비 중입니다.", requestId });
    }

    if (QUIZ_CACHE.length < CACHE_SIZE / 2 && !isCaching) {
        fillCache(); 
    }

    res.json({ 
      ...item, 
      imageUrl: item.image,
      requestId 
    });

  } catch (error) {
    console.error("API 퀴즈 처리 중 심각한 오류 발생:", error);
    const errorId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`; 
    res.status(500).json({ error: "서버 내부 오류로 퀴즈를 불러올 수 없습니다.", errorId });
  }
});

// --- 정적 ---
app.use(express.static(path.join(process.cwd(), "public")));
app.get("/", (req, res) => res.sendFile(path.join(process.cwd(), "public", "index.html")));

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
