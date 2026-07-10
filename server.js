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
  "칭기즈 칸", "알렉산드로스 3세", "줄리어스 시저", "조지 워싱턴",
  "넬슨 만델라",
  "존 F. 케네디", "마틴 루터 킹", "윈스턴 처칠", "마더 테레사", "헬렌 켈러",
  "소크라테스", "플라톤", "공자", "맹자", "진시황", "정약용", "이황", 
  "신사임당", "방정환", "지석영", "김정호", "장영실", "허준", "왕건",
  "대조영", "광개토대왕", "장수왕", "을지문덕", "김유신", "계백", "이사부", "보고",
  "최무선", "정도전", "황희", "신숙주", "곽재우", "주시경"
];

let QUIZ_CACHE = [];
let LAST_PLAYED = [];
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
// 4) [강력 필터] 사람 사진 판별기 (최종 보루 수정 버전)
// ===============================
function isHumanPhoto(filename, aliases) {
    if (!filename || typeof filename !== "string") return false;
    const n = filename.toLowerCase();

    // 1차 거름망: 역사 인물 퀴즈에 절대 나오면 안 되는 노이즈 단어
    const BLACKLIST = [
        "svg", "gif", "coat of arms", "coat_of_arms", "coa", "stone", "tomb", "_tomb",
        "arms", "emblem", "insignia", "flag", "standard", "banner", "seal", "stamp",
        "icon", "logo", "symbol", "map", "chart", "diagram", "signature", "sign",
        "grave", "tomb", "monument", "book", "cover", "coin", "currency", "statue",
        "sculpture", "memorial", "plaque", "doctrinae", "landscape", "architectures", "penny"
    ];

    for (const badWord of BLACKLIST) {
        if (n.includes(badWord)) return false;
    }
    
    // 조건 1) 초상화, 사진 등 인물 관련 명확한 키워드가 파일명에 있으면 통과
    if (/(portrait|photo|face|profile|bust|painting|oil|canvas|headshot|crop|standing|sitting)/i.test(n)) return true;

    // 조건 2) 한국어 이름(alias)이 파일명에 매칭되면 통과
    for (const a of aliases) {
        if (!a) continue;
        const cleanName = a.replace(/[\s\-\_]/g, "");
        const cleanFile = n.replace(/[\s\-\_]/g, "");
        if (cleanFile.includes(cleanName)) return true;
    }

    // 조건 3) 위키 특성상 외국인은 영문 이름(예: Albert_Einstein.jpg)이 많으므로,
    // 블랙리스트를 피하고 단어 사이에 언더바(_)나 하이픈(-)이 들어간 정상적인 영문 파일명은 허용
    if (/[a-z]{2,}[_\-][a-z]{2,}/i.test(n)) return true;

    // 🔥 [핵심 수정] 마지막 보루 변경: 위 조건에 하나도 안 걸리는 정체불명의 파일은 국물도 없이 차단
    return false; 
}

// ===============================
// 5) getStableMainImage (인포박스 전수 조사 및 크기 필터 적용 버전)
// ===============================
async function getStableMainImage(title) {
    const aliases = makeNameAliases(title);
    
    // 1) 위키 API 메인 썸네일
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

    // 2) HTML 내부 이미지 분석 (★깃털 아이콘 우회 저격 수정)
    try {
        const htmlRes = await axios.get(
            `https://ko.wikipedia.org/wiki/${encodeURIComponent(title)}`,
            { headers: WIKI_HEADERS }
        );
        const html = htmlRes.data;

        // OG 이미지 우선 처리
        const ogImage = extractOgImage(html);
        if (ogImage && isValidImageUrl(ogImage)) {
            const ogFileName = decodeURIComponent(ogImage.split('/').pop());
            if (isHumanPhoto(ogFileName, aliases)) {
                return ogImage;
            }
        }

        // 인포박스 처리 고도화
        const infoboxMatch = html.match(/<table[^>]*class="[^"]*infobox[^"]*"[^>]*>[\s\S]*?<\/table>/i);
        if (infoboxMatch) {
            // 🔥 [수정] 딱 하나만 찾던 매칭 대신, 인포박스 안의 모든 img 태그를 배열로 추출합니다.
            const imgTags = infoboxMatch[0].match(/<img[^>]+>/gi) || [];
            
            for (const tag of imgTags) {
                // 무의미한 투명 픽셀 패스
                if (/pixel\.gif|blank\.gif/i.test(tag)) continue;

                // 🛠️ [핵심] 가로 크기(width) 검사 추가
                // 위키피디아의 데코용 아이콘(깃털, 수정 아이콘 등)은 보통 가로가 15~25px 내외입니다.
                // 진짜 인물 초상화/사진은 최소 180~300px 이므로, 100px 미만의 자잘한 소형 이미지는 무조건 패스합니다.
                const widthMatch = tag.match(/width=["'](\d+)["']/i);
                if (widthMatch) {
                    const width = parseInt(widthMatch[1], 10);
                    if (width < 100) continue; // ◀ 깃털 아이콘은 여기서 걸러져서 다음 이미지로 넘어감!
                }

                // 크기 필터를 통과한 정상 크기 이미지의 src 추출
                const srcMatch = tag.match(/src\s*=\s*["']([^"']+)["']/i);
                if (srcMatch && srcMatch[1]) {
                    let src = srcMatch[1];
                    if (src.startsWith("//")) src = "https:" + src;
                    
                    if (isValidImageUrl(src)) {
                        const infoFileName = decodeURIComponent(src.split('/').pop());
                        if (isHumanPhoto(infoFileName, aliases)) {
                            return src; // 드디어 진짜 하단의 인물 초상화가 정상 반환됩니다!
                        }
                    }
                }
            }
        }
    } catch (e) {}

    // 3) 문서 전체 이미지 목록 뒤지기
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
                     .filter(name => !QUIZ_CACHE.some(c => c.name === name) && !LAST_PLAYED.includes(name)) // 👈 이 필터로 교체
                     .sort(() => Math.random() - 0.5)
                     .slice(0, 5); 

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
                        if (QUIZ_CACHE.some(cached => cached.name === item.name)) continue;
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
        
                           // ⚡ [속도 최적화 1] 무의미하게 API 쏘기 전에 이미 캐시에 있거나 나온 사람은 미리 탈락시킵니다.
                           if (QUIZ_CACHE.some(c => c.name === cand.title) || LAST_PLAYED.includes(cand.title)) return false;

                           return !/\(.*\)|선수|음악|작가|기업|수학|과학|독립운동|미술|의사|간호사|영화/.test(cand.title);
                         })
                        .sort(() => Math.random() - 0.5)
                        .slice(0, 5); // ⚡ [속도 최적화 2] 15명 -> 6명으로

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
                            if (QUIZ_CACHE.some(cached => cached.name === item.name)) continue;
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
  
    // 1개의 문제를 큐에서 꺼냅니다.
    const item = QUIZ_CACHE.shift();
  
    if (!item) {
        return res.status(503).json({ error: "데이터 준비 중입니다.", requestId });
    }

    if (QUIZ_CACHE.length < CACHE_SIZE / 2 && !isCaching) {
        fillCache(); 
    }

    // 🛑 [수정 1] 방금 뽑힌 인물의 이름을 LAST_PLAYED 배열에 넣습니다.
    LAST_PLAYED.push(item.name);
    
    // 유저가 한 문제씩 풀기 때문에, 최근 나온 '5명'까지만 기억하고 옛날 사람은 지웁니다.
    // 이렇게 해야 유명인 후보군(32명)이 마르지 않고 로딩 속도가 유지됩니다.
    if (LAST_PLAYED.length > 10) {
        LAST_PLAYED.shift(); 
    }

    // 🛑 [수정 2] 중복되던 res.json(sendQuiz)를 지우고 최종 응답 딱 하나만 안전하게 보냅니다.
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
