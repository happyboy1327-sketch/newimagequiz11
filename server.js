import express from "express";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// [보안/성능 개선] Express 관련 헤더 설정
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
// 2) 이미지 URL 유효성 검사
// ===============================
function isValidImageUrl(url) {
    if (!url || typeof url !== "string") return false;
    if (/\.svg(\?.*)?$/i.test(url) || /\/svg\//i.test(url)) return false;
    
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes("coat_of_arms") || lowerUrl.includes("emblem") || lowerUrl.includes("flag") || lowerUrl.includes("icon")) return false;
    
    return /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url);
}

// ===============================
// 3) 사람 사진 판별기
// ===============================
function isHumanPhoto(filename, aliases) {
    if (!filename || typeof filename !== "string") return false;
    const n = filename.toLowerCase();

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
        const res = await axios.head(url, { headers: WIKI_HEADERS, timeout: 800 });
        return res.status === 200;
    } catch (e) {
        try {
            const res = await axios.get(url, { headers: WIKI_HEADERS, timeout: 800, responseType: "stream" });
            return res.status === 200;
        } catch(err) {
            return false; 
        }
    }
}

async function validateImage(url) {
    for (let i = 0; i < VALIDATION_TRY; i++) {
        if (await checkUrlStability(url)) return true;
        if (i < VALIDATION_TRY - 1) await new Promise(resolve => setTimeout(resolve, 200));
    }
    return false;
}

// =======================================================
// 4) 힌트 마스킹 함수
// =======================================================
function createMaskedHint(title, extract) {
    let hintText = extract.substring(0, 350);
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
            const safeWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            hintText = hintText.replace(new RegExp(safeWord, 'gi'), "OOO");
            if (word.length >= 3 && !/\s/.test(word)) { 
                for(let i = 0; i <= word.length - 2; i++) {
                    const chunk = word.substring(i, i + 2);
                    const safeChunk = chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    hintText = hintText.replace(new RegExp(safeChunk, 'gi'), "OOO");
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

    return hintText.substring(0, 130).trim() + "...";
}

// =======================================================
// 5) 퀴즈 캐시 충전 함수 (대폭 최적화 버전)
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
                        cmlimit: 80, 
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
                    .slice(0, 25); 

                if (filteredCandidates.length > 0) {
                    const detailRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                        headers: WIKI_HEADERS,
                        params: {
                            action: "query",
                            titles: filteredCandidates.map(c => c.title).join('|'),
                            prop: "extracts|pageimages", 
                            explaintext: true,
                            pithumbsize: 600,
                            format: "json",
                            origin: "*"
                        }
                    });

                    const pages = Object.values(detailRes.data.query?.pages || {});
                    let tempCandidateList = [];

                    for (const pageData of pages) {
                        if (!pageData || !pageData.extract || pageData.extract.length < 100) continue;
                        if (/(대학교수|명예교수|석좌교수|교수|교육자)/.test(pageData.extract)) continue;

                        const aliases = makeNameAliases(pageData.title);

                        if (pageData.thumbnail?.source && isValidImageUrl(pageData.thumbnail.source) && isHumanPhoto(pageData.pageimage || "", aliases)) {
                            
                            let rawText = pageData.extract;
                            
                            // 1단계: 필요 없는 하위 섹션 자르기
                            const cutIndex = rawText.search(/==\s*(각주|같이 보기|참고 문헌|외부 링크)\s*==/i);
                            if (cutIndex !== -1) {
                                rawText = rawText.substring(0, cutIndex);
                            }
                            
                            // 🔥 [초강력 속도 최적화] 수만 자짜리 전체 텍스트를 들고 정규식을 돌리면 대폭 느려짐.
                            // 어차피 해설은 최대 1000자만 쓸 거니 미리 1500자로 싹둑 자른 후 정규식을 돌려 연산량 차단!
                            rawText = rawText.substring(0, 1500);
                            
                            // 2단계: 모든 중제목/소제목 기호를 박멸하고 자연스럽게 문장 연결
                            rawText = rawText.replace(/=+\s*.*?\s*=+/g, " ").replace(/\s+/g, " ").trim();

                            if (rawText.length < 100) continue;

                            let cleanDescription = rawText;
                            if (cleanDescription.length > 1000) {
                                cleanDescription = cleanDescription.substring(0, 1000) + "...";
                            }

                            tempCandidateList.push({
                                name: pageData.title,
                                image: pageData.thumbnail.source,
                                hint: createMaskedHint(pageData.title, rawText), 
                                description: cleanDescription 
                            });
                        }
                    }

                    // 🔥 [지옥의 동기루프 해결] 한 명씩 대기타며 검사하던 루프를 Promise.all 병렬 멀티태스킹으로 교체
                    const validatedResults = await Promise.all(
                        tempCandidateList.map(async (item) => {
                            const isStable = await validateImage(item.image);
                            return isStable ? item : null;
                        })
                    );

                    // 유효성 통과한 아이템만 최종 캐시에 순식간에 푸시
                    for (const item of validatedResults) {
                        if (item && QUIZ_CACHE.length < CACHE_SIZE) {
                            if (QUIZ_CACHE.some(cached => cached.name === item.name)) continue;
                            QUIZ_CACHE.push(item);
                            console.log(`   [캐시 추가 성공] 👤 ${item.name}`);
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
    if (LAST_PLAYED.length > 10) LAST_PLAYED.shift(); 

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

app.use(express.static(path.join(process.cwd(), "public")));
app.get("/", (req, res) => res.sendFile(path.join(process.cwd(), "public", "index.html")));

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
