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
const CACHE_SIZE = 20;        
const VALIDATION_TRY = 3;    

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
    // <meta property="og:image" content="..."> 추출
    const match = html.match(/<meta\s+property="og:image"\s+content="(.*?)"/i);
    if (match && match[1]) {
        return match[1].replace(/&amp;/g, '&'); // URL 인코딩 보정
    }
    return null;
}

// ===============================
// 3) 이미지 URL 유효성 검사 (SVG 및 키워드 차단)
// ===============================
function isValidImageUrl(url) {
    if (!url || typeof url !== "string") return false;
    
    // 1. 파일 확장자/형식 검사 (SVG 절대 금지)
    if (/\.svg(\?.*)?$/i.test(url)) return false;
    if (/\/svg\//i.test(url)) return false;
    
    // 2. URL 자체에 금지 키워드가 포함되어 있는지 검사 (휘장, 깃발 방지)
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes("coat_of_arms")) return false;
    if (lowerUrl.includes("emblem")) return false;
    if (lowerUrl.includes("flag")) return false;
    if (lowerUrl.includes("icon")) return false;
    
    // 3. 유효 확장자 확인
    return /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url);
}

// ===============================
// 4) [강력 필터] 사람 사진 판별기 (휘장/심볼 완벽 차단)
// ===============================
function isHumanPhoto(filename, aliases) {
    if (!filename || typeof filename !== "string") return false;
    const n = filename.toLowerCase();

    // ====================================================
    // 🔥 [핵심] 나폴레옹 등 역사 인물 휘장/심볼 칼차단 목록
    // ====================================================
    const BLACKLIST = [
        "svg", "gif",                   // 포맷
        "coat of arms", "coat_of_arms", // 문장 (가장 많음)
        "coa",                          // 문장 약어
        "arms",                         // Arms
        "emblem",                       // 엠블럼
        "insignia",                     // 휘장
        "flag", "standard", "banner",   // 깃발류
        "seal", "stamp",                // 도장/우표
        "icon", "logo", "symbol",       // 심볼
        "map", "chart", "diagram",      // 지도/도표
        "signature", "sign",            // 서명
        "grave", "tomb", "monument",    // 무덤/기념비
        "book", "cover",                // 책 표지
        "coin", "currency",             // 동전/지폐
        "statue", "sculpture",          // 동상 (가능하면 실제 얼굴 선호)
        "memorial", "plaque", "doctrinae",
        "landscape", "architectures" // 기념판
    ];

    // 파일명에 블랙리스트 키워드가 하나라도 있으면 즉시 탈락
    for (const badWord of BLACKLIST) {
        if (n.includes(badWord)) return false;
    }

    // ====================================================
    // ✅ [통과 조건]
    // ====================================================
    
    // 1. 긍정 키워드가 있으면 무조건 통과 (우선순위 높음)
    if (/(portrait|photo|face|profile|bust|painting|oil|canvas)/i.test(n)) return true;

    // 2. 파일명에 이름(alias)이 포함되어 있으면 통과
    for (const a of aliases) {
        if (!a) continue;
        const cleanName = a.replace(/[\s\-\_]/g, "");
        const cleanFile = n.replace(/[\s\-\_]/g, "");
        if (cleanFile.includes(cleanName)) return true;
    }

    // 3. 블랙리스트에 걸리지 않았고, jpg/png라면 일단 후보로 인정
    // (이름이 파일명에 없어도 "Napoleon_in_his_study.jpg" 같은 경우를 잡기 위함)
    return true;
}

// ===============================
// 5) getStableMainImage - 개선된 버전
// ===============================
async function getStableMainImage(title) {
    const aliases = makeNameAliases(title);
    
    // ---------------------------------------------------------
    // 전략 1: PageImages API (썸네일) - 가장 정확함 (1순위)
    // ---------------------------------------------------------
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
        const thumbName = page?.pageimage || ""; // 파일명 확인용

        // URL 유효성 + 파일명 필터까지 이중 체크
        if (thumbUrl && isValidImageUrl(thumbUrl) && isHumanPhoto(thumbName, aliases)) {
            // console.log(`✔ [API] 썸네일 확정: ${title}`);
            return thumbUrl;
        }
    } catch (e) {}

    // ---------------------------------------------------------
    // 전략 2: HTML 파싱 (Open Graph Image -> Infobox)
    // ---------------------------------------------------------
    try {
        const htmlRes = await axios.get(
            `https://ko.wikipedia.org/wiki/${encodeURIComponent(title)}`,
            { headers: WIKI_HEADERS }
        );
        const html = htmlRes.data;

        // 2-1. og:image (카톡 공유시 뜨는 그 이미지)
        const ogImage = extractOgImage(html);
        // og:image URL에도 'svg'나 'coat_of_arms'가 들어가는지 체크
        if (ogImage && isValidImageUrl(ogImage)) {
            // console.log(`✔ [Meta] OG 이미지 사용: ${title}`);
            return ogImage;
        }

        // 2-2. Infobox 내부 이미지 (보조)
        const infoboxMatch = html.match(/<table[^>]*class="[^"]*infobox[^"]*"[^>]*>[\s\S]*?<\/table>/i);
        if (infoboxMatch) {
            const srcMatch = infoboxMatch[0].match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
            if (srcMatch && srcMatch[1]) {
                let src = srcMatch[1];
                if (src.startsWith("//")) src = "https:" + src;
                
                if (isValidImageUrl(src) && !/pixel\.gif|blank\.gif/i.test(src)) {
                     // console.log(`✔ [Infobox] 이미지 발견: ${title}`);
                     return src;
                }
            }
        }
    } catch (e) {
        // HTML 파싱 실패
    }

    // ---------------------------------------------------------
    // 전략 3: 전체 이미지 목록 검색 (최후의 보루)
    // ---------------------------------------------------------
    try {
        const imgListRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
            headers: WIKI_HEADERS,
            params: {
                action: "query",
                titles: title,
                prop: "images",
                imlimit: 50,
                format: "json",
                origin: "*"
            }
        });

        const page = Object.values(imgListRes.data.query.pages)[0];
        const imgs = page.images || [];

        // 여기서 강력 필터링 (isHumanPhoto) 수행
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
                // console.log(`✔ [List] 리스트 대체 이미지: ${title}`);
                return url;
            }
        }
    } catch (e) {}

    console.log(`❌ 최종 이미지 실패: ${title}`);
    return null;
}

// --- [핵심] 이미지 URL 안정성 체크 ---
async function checkUrlStability(url) {
    if (!url) return false;
    try {
        // HEAD 요청으로 이미지 존재 여부만 0.1초만에 스캔
        const res = await axios.head(url, {
            headers: WIKI_HEADERS,
            timeout: 1000
        });
        return res.status === 200;
    } catch (e) {
        // HEAD 요청을 거부하는 서버 대비용 GET 백업 (스트림으로 가볍게 수신)
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

    return hintText.substring(0, 120) + "...";
}

// --- 데이터 채굴 로직 ---
async function fillCache() {
    if (isCaching || QUIZ_CACHE.length >= CACHE_SIZE) return;
    isCaching = true;

    cachePromise = new Promise(async (resolve) => {
        console.log("⛏️ 데이터 채굴 시작...");

        try {
            // -------------------------------------------------------
            // 1. LEGACY 유명인 우선 시도
            // -------------------------------------------------------
            if (QUIZ_CACHE.length < CACHE_SIZE) {
                // process.stdout.write(`[유명인] 검색 시도... `);

                const famousCandidates = LEGACY_NAMES
                    .sort(() => Math.random() - 0.5)
                    .slice(0, 5);

                for (const pickName of famousCandidates) {
                    if (QUIZ_CACHE.length >= CACHE_SIZE) break;

                    const detailRes = await axios.get(
                        "https://ko.wikipedia.org/w/api.php",
                        {
                            headers: WIKI_HEADERS,
                            params: {
                                action: "query",
                                titles: pickName,
                                prop: "extracts", // 이미지는 따로 구함
                                exintro: true,
                                explaintext: true,
                                format: "json",
                                origin: "*"
                            }
                        }
                    );

                    const pages = detailRes.data.query?.pages;
                    if (!pages) continue;
                    const pageData = Object.values(pages)[0];
                    if (!pageData || !pageData.extract || pageData.extract.length < 30) continue;

                    // 🔥 이미지 확보 (개선된 함수 사용)
                    const imgUrl = await getStableMainImage(pageData.title);
                    if (!imgUrl) {
                        console.log(`❌ [유명인] ${pickName} 이미지 없음/불안정 → 패스`);
                        continue;
                    }
                    
                    const isStable = await checkUrlStability(imgUrl);
                    if (!isStable) {
                        console.log(`❌ [유명인] ${pickName} 이미지 연결 불안정 → 패스`);
                        continue;
                    }

                    console.log(`✅ [유명인] ${pickName} 통과.`);
                    const maskedHint = createMaskedHint(pageData.title, pageData.extract);
                    QUIZ_CACHE.push({
                        name: pageData.title,
                        image: imgUrl,
                        hint: maskedHint,
                        description: pageData.extract
                    });
                }
            }

            // -------------------------------------------------------
            // 2. 랜덤 연도 탐색 (출생 연도 기반)
            // -------------------------------------------------------
            let randomSearchAttempts = 0;

            while (QUIZ_CACHE.length < CACHE_SIZE && randomSearchAttempts < 3) {
                const year = Math.floor(Math.random() * (1940 - 500 + 1)) + 500;
                // process.stdout.write(`[랜덤] ${year}년도 탐색... `);

                const listRes = await axios.get(
                    "https://ko.wikipedia.org/w/api.php",
                    {
                        headers: WIKI_HEADERS,
                        params: {
                            action: "query",
                            list: "categorymembers",
                            cmtitle: `분류:${year}년_출생`,
                            cmlimit: 50,
                            cmtype: "page",
                            format: "json",
                            origin: "*"
                        }
                    }
                );

                const candidates = listRes.data.query?.categorymembers || [];

                for (const cand of candidates.slice(0, 10)) {
                    if (QUIZ_CACHE.length >= CACHE_SIZE) break;

                    // 노이즈 필터
                    if (/\(.*\)|선수|음악|작가|기업|수학|과학|독립운동|미술|의사|간호사|영화/.test(cand.title))
                        continue;

                    const detailRes = await axios.get(
                        "https://ko.wikipedia.org/w/api.php",
                        {
                            headers: WIKI_HEADERS,
                            params: {
                                action: "query",
                                titles: cand.title,
                                prop: "extracts",
                                exintro: true,
                                explaintext: true,
                                format: "json",
                                origin: "*"
                            }
                        }
                    );

                    const pages = detailRes.data.query?.pages;
                    if (!pages) continue;
                    const pageData = Object.values(pages)[0];
                    if (!pageData || !pageData.extract || pageData.extract.length < 300)
                        continue;

                    // 🔥 이미지 확보
                    const imgUrl = await getStableMainImage(pageData.title);
                    if (!imgUrl) {
                        console.log(`❌ [랜덤] ${pageData.title} 이미지 없음 → 패스`);
                        continue;
                    }
                    
                    const isStable = await checkUrlStability(imgUrl);
                    if (!isStable) {
                        console.log(`❌ [랜덤] ${pageData.title} 이미지 연결 불안정 → 패스`);
                        continue;
                    }

                    console.log(`✅ [랜덤] ${pageData.title} 통과.`);
                    const maskedHint = createMaskedHint(pageData.title, pageData.extract);

                    QUIZ_CACHE.push({
                        name: pageData.title,
                        image: imgUrl,
                        hint: maskedHint,
                        description: pageData.extract
                    });
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

    // ★ 수정: 캐시가 진짜 아예 없을 때만 채워질 때까지 기다립니다.
    if (QUIZ_CACHE.length === 0) {
        if (!isCaching) fillCache(); 
        if (cachePromise) await cachePromise;
    }
  
    const item = QUIZ_CACHE.shift();
  
    if (!item) {
        return res.status(503).json({ error: "데이터 준비 중입니다.", requestId });
    }

    // ★ 수정: 남은 개수가 비어갈 때 백그라운드에서 조용히 채우되, 사용자를 붙잡지 않습니다.
    if (QUIZ_CACHE.length < CACHE_SIZE / 2 && !isCaching) {
        fillCache(); // await를 빼서 백그라운드로 돌림
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
