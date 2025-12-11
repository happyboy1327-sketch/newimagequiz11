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
        lowerKo.replace(/\s+/g, "-")
    ];

    if (/모차르트/.test(cleanKo)) {
        aliases.push("Wolfgang Amadeus Mozart".toLowerCase());
        aliases.push("mozart");
    }
    if (/베토벤/.test(cleanKo)) {
        aliases.push("Ludwig van Beethoven");
    }
    if (/피카소/.test(cleanKo)) {
        aliases.push("Pablo Picasso");
        aliases.push("picasso");
    }
    if (/간디/.test(cleanKo)) {
        aliases.push("Mahatma Gandhi");
        aliases.push("gandhi");
    }

    return [...new Set(aliases)];
}

// ===============================
// 2) infobox 이미지 추출 (모든 img 태그 스캔, SVG 완벽 제외)
// ===============================
function extractInfoboxImage(html) {
    // infobox table/div 강제 추출
    const infoboxMatch = html.match(/<table[^>]*class="[^"]*infobox[^"]*"[^>]*>[\s\S]*?<\/table>/i)
                        || html.match(/<div[^>]*class="[^"]*infobox[^"]*"[^>]*>[\s\S]*?<\/div>/i);

    if (!infoboxMatch) return null;
    const area = infoboxMatch[0];

    // img 태그의 src / data-src / srcset 등 모두 검사
    const srcRegex = /<img[^>]*(?:src|data-src|data-srcset|srcset)\s*=\s*"(.*?)"/gi;
    let m;
    while ((m = srcRegex.exec(area)) !== null) {
        let src = m[1].trim();
        if (!src) continue;
        // 프로토콜 보정
        if (!/^https?:\/\//i.test(src)) {
            if (src.startsWith("//")) src = "https:" + src;
            else src = "https:" + src;
        }

        // --- SVG 관련 모든 형태 배제 ---
        // - 직접 .svg
        // - .svg 뒤에 슬래시로 크기/변환 경로가 붙는 경우 (예: ...file.svg/300px-...)
        // - 경로에 '/svg/' 또는 파일명에 'svg' 키워드가 섞인 경우(안전하게 배제)
        if (/\.svg(\?.*)?$/i.test(src)) continue;
        if (/\/[^\/]*\.svg\//i.test(src)) continue;
        if (/\/svg\//i.test(src)) continue;
        if (/(\?|&)format=svg/i.test(src)) continue;
        if (/(\.svg)[^a-z0-9]/i.test(src)) continue;

        // 유효 확장자만 허용
        if (/\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(src)) return src;
    }

    return null;
}

// --- 2) 이미지 URL 유효성 검사: SVG 계열 완전 거부, 확장자+파라미터 허용
function isValidImageUrl(url) {
    if (!url || typeof url !== "string") return false;
    // 1) 어떤 형태의 svg가 섞여있으면 무조건 거부
    if (/\.svg(\?.*)?$|\/[^\/]*\.svg\/|\/svg\//i.test(url)) return false;

    // 2) 실제 이미지 확장자 허용 (파라미터 허용)
    return /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url);
}

// --- 3) 사람 사진 후보 필터: title/filename에 svg 포함시 확실히 제외
function isHumanPhoto(filename, aliases) {
    if (!filename || typeof filename !== "string") return false;
    const n = filename.toLowerCase();

    // SVG 파일명/경로 포함시 무조건 제외
    if (/\.svg$/i.test(n)) return false;
    if (/\bsvg\b/i.test(n)) return false;

    // 이미지 확장자 확인
    if (!/\.(jpg|jpeg|png|webp)$/i.test(n)) return true;

    // 기념비/상징류 제외
    if (/(memorial|statue|grave|coat|tomb|plaque|museum)/i.test(n)) return false;
    if (/(emblem|flag|symbol|seal|arms|imperial|logo|icon|painting|group photo)/i.test(n)) return false;
    if (/signature/i.test(n)) return false;

    // 긍정 단서
    if (/(portrait|photo|face)/i.test(n)) return true;

    // alias 기반 이름 매칭 (파일명에 이름 포함 여부)
    for (const a of aliases) {
        if (!a) continue;
        const clean = a.toLowerCase().replace(/\s+/g, "_");
        if (n.includes(clean) || n.includes(a.toLowerCase())) return true;
    }

    return false;
}
// ===============================
// 5) getStableMainImage - 개선된 버전
// ===============================
async function getStableMainImage(title) {
    const aliases = makeNameAliases(title);
    const baseParams = {
        action: "query",
        format: "json",
        origin: "*",
        titles: title
    };

    // =============================================
    // 1) HTML 크롤링 → infobox 이미지 강제 우선
    // =============================================
    try {
        const htmlRes = await axios.get(
            `https://ko.wikipedia.org/wiki/${encodeURIComponent(title)}`,
            { headers: WIKI_HEADERS }
        );

        const infobox = extractInfoboxImage(htmlRes.data);

        if (infobox && isValidImageUrl(infobox)) {
            console.log(`✔ Infobox 이미지 확정: ${title}`);
            return infobox;
        }
    } catch (e) {
        console.log(`✖ infobox 크롤링 실패: ${title}`);
    }

    // =============================================
    // 2) 이미지 목록 API → 사람 사진만 필터링
    // =============================================
    try {
        const imgListRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
            headers: WIKI_HEADERS,
            params: {
                ...baseParams,
                prop: "images",
                imlimit: 100
            }
        });

        const page = Object.values(imgListRes.data.query.pages)[0];
        const imgs = page.images || [];

        const candidates = imgs
            .filter(i => isHumanPhoto(i.title, aliases))
            .slice(0, 5);

        for (const c of candidates) {
            try {
                const infoRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                    headers: WIKI_HEADERS,
                    params: {
                        action: "query",
                        format: "json",
                        titles: c.title,
                        prop: "imageinfo",
                        iiprop: "url",
                        iiurlwidth: 700,
                        origin: "*"
                    }
                });
                const info = Object.values(infoRes.data.query.pages)[0];
                const url = info.imageinfo?.[0]?.thumburl || info.imageinfo?.[0]?.url;

                if (isValidImageUrl(url)) {
                    console.log(`✔ 이미지 리스트에서 대체 이미지 획득: ${title}`);
                    return url;
                }
            } catch {}
        }
    } catch (e) {
        console.log(`✖ 이미지 리스트 실패: ${title}`);
    }

    // =============================================
    // 3) Thumbnail (최후의 수단)
    // =============================================
    try {
        const thumbRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
            headers: WIKI_HEADERS,
            params: {
                ...baseParams,
                prop: "pageimages",
                piprop: "thumbnail",
                pithumbsize: 800
            }
        });

        const page = Object.values(thumbRes.data.query.pages)[0];
        const thumb = page.thumbnail?.source;

        if (thumb && isValidImageUrl(thumb)) {
            console.log(`✔ Thumbnail fallback: ${title}`);
            return thumb;
        }
    } catch (e) {
        console.log(`✖ Thumbnail 실패: ${title}`);
    } function isHumanTitle(title) {
    // 완벽할 필요 없음 — 인명만 걸러도 충분
    return /^[A-Za-z가-힣·\s]+$/.test(title);
}
    console.log(`✖ 최종 실패: ${title}`);
    
if (!infoboxImage && !bestFace && !bestThumb && page) {
    const rawOriginal = page?.originalimage?.source || null;
    const rawThumb = page?.thumbnail?.source || null;

    const fixed = [rawOriginal, rawThumb].find(u =>
        typeof u === "string" &&
        /^https?:\/\//i.test(u) &&                    // URL 형식 보정
        /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(u)      // 확장자 뒤 파라미터 허용
    );

    if (fixed) return fixed;
}
    

// 그다음 infobox
if (infoboxImage) return infoboxImage;
if (!infoboxImage) return bestThumb;
    
// 사람 문서일 경우 — infobox/thumbnail 둘 다 실패하면 여기서 중단
if (isHumanTitle(title)) {
    return null;
}

// 사람이 아닌 경우에만 fallback 허용
if (bestFace) return bestFace;

return null;
}


// --- [핵심] 이미지 URL 안정성 체크 ---
async function checkUrlStability(url) {
    if (!url) return false;
    
    for (let i = 1; i <= VALIDATION_TRY; i++) {
        try {
            const res = await axios.get(url, {
                headers: WIKI_HEADERS,
                timeout: 2000,
                responseType: "arraybuffer"
            });
            
            const contentType = res.headers['content-type'] || '';
            if (res.status !== 200 || !contentType.includes('image')) {
                return false;
            }
            await new Promise(r => setTimeout(r, 100));
        } catch (e) {
            return false; 
        }
    }
    return true;
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
                process.stdout.write(`[유명인] 검색 시도... `);

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
                                prop: "pageimages|extracts",
                                pithumbsize: 500,
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

                    // 🔥 대표 이미지 확보 후, 없으면 명확하게 스킵
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
                process.stdout.write(`[랜덤] ${year}년도 탐색... `);

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

                    // 🔥 이미지 없으면 명확하게 스킵
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

    if (isCaching && cachePromise) {
        await cachePromise; 
    }
  
    if (QUIZ_CACHE.length === 0) {
        await fillCache(); 
        await cachePromise;
    }
  
    const item = QUIZ_CACHE.shift();
  
    if (!item) {
        fillCache(); 
        return res.status(503).json({ error: "데이터 준비 중입니다. 잠시만 기다려주세요.", requestId });
    }

    if (QUIZ_CACHE.length < CACHE_SIZE / 2) fillCache();

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
