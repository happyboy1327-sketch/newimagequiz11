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
// 4) [강력 필터] 사람 사진 판별기 (깃털 아이콘 완벽 저격)
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
        "picto", "auteur", "button", "arrow", "quill" // 🔥 'picto'(픽토그램), 'auteur'(저자) 추가해서 깃털 아이콘 원천 차단
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

    // 예외적인 옛날 인물화 파일명(예: Hyakuninisshu_060.jpg)을 살리기 위해 true 유지
    // 대신 아래 HTML 구조 파싱에서 쩌리 아이콘들을 완벽하게 걸러냄
    return true; 
}

                
// ===============================
// 5) getStableMainImage (초고속 배치 요청 버전)
// ===============================
async function getStableMainImage(title) {
    const aliases = makeNameAliases(title);
    
    // 1) 위키 API 메인 썸네일 (가장 빠름)
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

    // 2) HTML 내부 이미지 분석 (정밀 타격)
    try {
        const htmlRes = await axios.get(
            `https://ko.wikipedia.org/wiki/${encodeURIComponent(title)}`,
            { headers: WIKI_HEADERS }
        );
        const html = htmlRes.data;

        const ogImage = extractOgImage(html);
        if (ogImage && isValidImageUrl(ogImage)) {
            const ogFileName = decodeURIComponent(ogImage.split('/').pop());
            if (isHumanPhoto(ogFileName, aliases)) return ogImage;
        }

        // 인포박스 이미지 전용 칸 정밀 매칭
        const infoboxImageMatch = html.match(/<td[^>]+class="[^"]*infobox-image[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
        if (infoboxImageMatch) {
            const imgMatch = infoboxImageMatch[1].match(/<img[^>]+>/i);
            if (imgMatch) {
                let src = "";
                const dataSrcMatch = imgMatch[0].match(/data-src\s*=\s*["']([^"']+)["']/i);
                const srcMatch = imgMatch[0].match(/src\s*=\s*["']([^"']+)["']/i);

                if (dataSrcMatch && dataSrcMatch[1]) src = dataSrcMatch[1];
                else if (srcMatch && srcMatch[1]) src = srcMatch[1];

                if (src && !/pixel\.gif|blank\.gif|data:image/i.test(src)) {
                    if (src.startsWith("//")) src = "https:" + src;
                    if (isValidImageUrl(src)) {
                        const infoFileName = decodeURIComponent(src.split('/').pop());
                        if (isHumanPhoto(infoFileName, aliases)) return src;
                    }
                }
            }
        }
    } catch (e) {}

    // 3) 문서 전체 이미지 목록 뒤지기 (★병목 해결: 배치 요청 처리)
    try {
        const imgListRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
            headers: WIKI_HEADERS,
            params: {
                action: "query",
                titles: title,
                prop: "images",
                imlimit: 50, // 최대 50개까지만 조사
                format: "json",
                origin: "*"
            }
        });

        const page = Object.values(imgListRes.data.query.pages)[0];
        const imgs = page.images || [];
        const candidates = imgs.filter(i => isHumanPhoto(i.title, aliases));

        // 💡 [핵심 최적화] loop 돌면서 await 하지 말고, 한 번에 묶어서 보냅니다.
        if (candidates.length > 0) {
            // 위키백과 API 스펙상 최대 50개까지 파이프(|)로 묶어서 한 번에 요청 가능
            const batchTitles = candidates.slice(0, 50).map(c => c.title).join('|');

            const infoRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                headers: WIKI_HEADERS,
                params: {
                    action: "query",
                    titles: batchTitles, // ◀ 예: "File:A.jpg|File:B.jpg|File:C.jpg"
                    prop: "imageinfo",
                    iiprop: "url",
                    format: "json",
                    origin: "*"
                }
            });

            const pages = Object.values(infoRes.data.query.pages || {});
            
            // 결과 배열을 돌면서 유효한 첫 번째 이미지 주소를 즉시 반환
            for (const p of pages) {
                const url = p.imageinfo?.[0]?.url;
                if (url && isValidImageUrl(url)) {
                    return url; 
                }
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

            // =======================================================
// 퀴즈 캐시 충전 함수 (30명 단위 초고속 배치 스캔 버전)
// =======================================================
async function fillCache() {
    // 캐시가 이미 꽉 차 있으면 실행 안 하고 패스
    if (QUIZ_CACHE.length >= CACHE_SIZE) return;

    console.log(`🔄 퀴즈 캐시 충전 시작... (현재: ${QUIZ_CACHE.length}/${CACHE_SIZE})`);

    let randomSearchAttempts = 0;

    // 캐시가 다 찰 때까지 혹은 시도 횟수가 끝날 때까지 반복
    while (QUIZ_CACHE.length < CACHE_SIZE && randomSearchAttempts < 3) {
        // 500년부터 2000년 사이의 랜덤 연도 지정
        const year = Math.floor(Math.random() * (2000 - 500 + 1)) + 500;
        console.log(`📅 랜덤 연도 탐색 중: ${year}년 출생자 스캔`);

        try {
            // 1) 해당 연도 출생자 목록 넉넉하게 가져오기
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

            // 2) 1차 필터링 및 딱 30명으로 제한
            const filteredCandidates = candidates
                .filter(cand => {
                    if (cand.title.includes(":")) return false; 
                    if (QUIZ_CACHE.some(c => c.name === cand.title) || LAST_PLAYED.includes(cand.title)) return false;
                    return !/\(.*\)|선수|음악|작가|기업|수학|과학|독립운동|미술|의사|간호사|영화/.test(cand.title);
                })
                .sort(() => Math.random() - 0.5)
                .slice(0, 30); // 🔥 형이 말한 딱 30명 제한 구간

            if (filteredCandidates.length > 0) {
                // 3) 🔥 [핵심] 30명 인물의 본문, 대표 썸네일, 내부 이미지 목록을 한방에 요청 (네트워크 대폭 절약)
                const detailRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                    headers: WIKI_HEADERS,
                    params: {
                        action: "query",
                        titles: filteredCandidates.map(c => c.title).join('|'),
                        prop: "extracts|pageimages|images",
                        exintro: true,
                        explaintext: true,
                        pithumbsize: 600,
                        imlimit: 20,
                        format: "json",
                        origin: "*"
                    }
                });

                const pages = Object.values(detailRes.data.query?.pages || {});
                
                let imageToCandidateMap = {};
                let imageTitlesToFetch = [];
                let tempCandidateData = {};

                for (const pageData of pages) {
                    if (!pageData || !pageData.extract || pageData.extract.length < 100) continue;
                    if (/(대학교수|명예교수|석좌교수|교수|교육자)/.test(pageData.extract)) continue;

                    const aliases = makeNameAliases(pageData.title);

                    // 루트 A: 메인 대표 썸네일이 바로 존재하고 필터를 통과하는 경우
                    if (pageData.thumbnail?.source && isValidImageUrl(pageData.thumbnail.source) && isHumanPhoto(pageData.pageimage || "", aliases)) {
                        tempCandidateData[pageData.title] = {
                            name: pageData.title,
                            image: pageData.thumbnail.source,
                            hint: createMaskedHint(pageData.title, pageData.extract),
                            description: pageData.extract
                        };
                        continue;
                    }

                    // 루트 B: 메인 썸네일이 없으면, 내부 이미지 목록에서 깃털/아이콘 빼고 진짜 사진 필터링
                    const imgs = pageData.images || [];
                    const validImgs = imgs.filter(i => isHumanPhoto(i.title, aliases));

                    if (validImgs.length > 0) {
                        const targetImgTitle = validImgs[0].title;
                        imageTitlesToFetch.push(targetImgTitle);
                        imageToCandidateMap[targetImgTitle] = {
                            title: pageData.title,
                            extract: pageData.extract
                        };
                    }
                }

                // 4) 루트 B에 걸린 후보 이미지들의 실제 다운로드 URL도 단 한번의 배치 요청으로 싹 다 받아오기
                if (imageTitlesToFetch.length > 0) {
                    const infoRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                        headers: WIKI_HEADERS,
                        params: {
                            action: "query",
                            titles: imageTitlesToFetch.slice(0, 30).join('|'), // 30개 안전 슬라이스
                            prop: "imageinfo",
                            iiprop: "url",
                            format: "json",
                            origin: "*"
                        }
                    });

                    const infoPages = Object.values(infoRes.data.query?.pages || {});
                    for (const ip of infoPages) {
                        const url = ip.imageinfo?.[0]?.url;
                        const mapItem = imageToCandidateMap[ip.title];
                        if (url && isValidImageUrl(url) && mapItem) {
                            tempCandidateData[mapItem.title] = {
                                name: mapItem.title,
                                image: url,
                                hint: createMaskedHint(mapItem.title, mapItem.extract),
                                description: mapItem.extract
                            };
                        }
                    }
                }

                // 5) 수집 완료된 임시 데이터들 최종 유효성 검사 후 진짜 캐시 배열에 투하
                for (const item of Object.values(tempCandidateData)) {
                    if (QUIZ_CACHE.length < CACHE_SIZE) {
                        if (QUIZ_CACHE.some(cached => cached.name === item.name)) continue;
                        
                        // 이미지가 여전히 살아있는 링크인지 핑 때려보기
                        const isStable = await validateImage(item.image);
                        if (isStable) {
                            QUIZ_CACHE.push(item);
                            console.log(`   [캐시 추가 성공] 👤 ${item.name}`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("❌ fillCache 도중 에러 발생:", error.message);
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
