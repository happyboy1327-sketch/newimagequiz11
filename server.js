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
// 2) 이미지 URL 유효성 검사 (SVG 및 키워드 차단)
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
// 3) [강력 필터] 사람 사진 판별기 (필적/문서 철저 차단)
// ===============================
function isHumanPhoto(filename, aliases) {
    if (!filename || typeof filename !== "string") return false;
    const n = filename.toLowerCase();

    // 🔥 양사언 필적 같은 예외 케이스 저격을 위해 글씨, 탁본, 문서 관련 키워드 대거 추가
    const BLACKLIST = [
        "svg", "gif", "coat of arms", "coat_of_arms", "coa", "stone", "tomb", "_tomb",
        "arms", "emblem", "insignia", "flag", "standard", "banner", "seal", "stamp",
        "icon", "logo", "symbol", "map", "chart", "diagram", "signature", "sign",
        "grave", "tomb", "monument", "book", "cover", "coin", "currency", "statue",
        "sculpture", "memorial", "plaque", "doctrinae", "landscape", "architectures", "penny",
        "picto", "auteur", "button", "arrow", "quill",
        "calligraphy", "handwriting", "writing", "manuscript", "document", "letter", "text", "rubbing",
        "필적", "글씨", "서체", "문서", "편지", "탁본", "서간", "간찰", "의궤", "집자", "현판", "비석"
    ];

    for (const badWord of BLACKLIST) {
        if (n.includes(badWord)) return false;
    }
    
    if (/(portrait|photo|face|profile|bust|painting|oil|canvas|illustration|hyakunin)/i.test(n)) return true;

    for (const a of aliases) {
        if (!a) continue;
        const cleanName = a.replace(/[\s\-\_]/g, "");
        const cleanFile = n.replace(/[\s\-\_]/g, "");
        if (cleanFile.includes(cleanName)) return true;
    }

    return true; 
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
// 퀴즈 캐시 충전 함수 (토막글 짜바리 아이콘 철저히 배제 버전)
// =======================================================
function fillCache() {
    if (isCaching) return cachePromise;
    if (QUIZ_CACHE.length >= CACHE_SIZE) return Promise.resolve();

    isCaching = true;

    cachePromise = new Promise(async (resolve) => {
        console.log(`🔄 퀴즈 캐시 충전 시작... (현재: ${QUIZ_CACHE.length}/${CACHE_SIZE})`);
        let randomSearchAttempts = 0;

        try {
            while (QUIZ_CACHE.length < CACHE_SIZE && randomSearchAttempts < 3) {
                const year = Math.floor(Math.random() * (2000 - 500 + 1)) + 500;
                console.log(`📅 랜덤 연도 탐색 중: ${year}년 출생자 스캔`);

                const listRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                    headers: WIKI_HEADERS,
                    params: {
                        action: "query",
                        list: "categorymembers",
                        cmtitle: `분류:${year}년_출생`,
                        cmlimit: 100, 
                        cmtype: "page",
                        format: "json",
                        origin: "*"
                    }
                });

                const candidates = listRes.data.query?.categorymembers || [];

                const filteredCandidates = candidates
                    .filter(cand => {
                        if (cand.title.includes(":")) return false; 
                        if (QUIZ_CACHE.some(c => c.name === cand.title) || LAST_PLAYED.includes(cand.title)) return false;
                        return !/\(.*\)|선수|음악|작가|기업|수학|과학|독립운동|미술|의사|간호사|영화/.test(cand.title);
                    })
                    .sort(() => Math.random() - 0.5)
                    .slice(0, 30); 

                if (filteredCandidates.length > 0) {
                    const detailRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                        headers: WIKI_HEADERS,
                        params: {
                            action: "query",
                            titles: filteredCandidates.map(c => c.title).join('|'),
                            prop: "extracts|pageimages", // 🔥 'images' 제거! 문서 내부 쩌리 이미지들을 아예 요청조차 안 함
                            exintro: true,
                            explaintext: true,
                            pithumbsize: 600,
                            format: "json",
                            origin: "*"
                        }
                    });

                    const pages = Object.values(detailRes.data.query?.pages || {});
                    let tempCandidateData = {};

                    for (const pageData of pages) {
                        if (!pageData || !pageData.extract || pageData.extract.length < 100) continue;
                        if (/(대학교수|명예교수|석좌교수|교수|교육자)/.test(pageData.extract)) continue;

                        const aliases = makeNameAliases(pageData.title);

                        // 🔥 위키백과가 보장하는 우측 인포박스 전용 '메인 대표 썸네일'이 있을 때만 수집
                        // 이렇게 하면 본문 하단 토막글 템플릿의 엉뚱한 아이콘들을 완벽히 무시함
                        if (pageData.thumbnail?.source && isValidImageUrl(pageData.thumbnail.source) && isHumanPhoto(pageData.pageimage || "", aliases)) {
                            tempCandidateData[pageData.title] = {
                                name: pageData.title,
                                image: pageData.thumbnail.source,
                                hint: createMaskedHint(pageData.title, pageData.extract),
                                description: pageData.extract
                            };
                        }
                    }

                    for (const item of Object.values(tempCandidateData)) {
                        if (QUIZ_CACHE.length < CACHE_SIZE) {
                            if (QUIZ_CACHE.some(cached => cached.name === item.name)) continue;
                            
                            const isStable = await validateImage(item.image);
                            if (isStable) {
                                QUIZ_CACHE.push(item);
                                console.log(`   [캐시 추가 성공] 👤 ${item.name}`);
                            }
                        }
                    }
                }
                randomSearchAttempts++;
            }
        } catch (e) {
            console.error("❌ 채굴 중 오류 발생:", e.message);
        } finally {
            isCaching = false;
            console.log(`✅ 캐시 충전 프로세스 종료. 현재 캐시: ${QUIZ_CACHE.length}/${CACHE_SIZE}`);
            if (QUIZ_CACHE.length < 5) setTimeout(fillCache, 3000);
            resolve();
        }
    });

    return cachePromise;
}

// 최초 구동 시 캐시 충전
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

    LAST_PLAYED.push(item.name);
    
    if (LAST_PLAYED.length > 10) {
        LAST_PLAYED.shift(); 
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

// --- 정적 파일 ---
app.use(express.static(path.join(process.cwd(), "public")));
app.get("/", (req, res) => res.sendFile(path.join(process.cwd(), "public", "index.html")));

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
