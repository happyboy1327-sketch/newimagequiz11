import express from "express";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
// 🌟 새롭게 작성한 서론 보강 함수 가져오기
import { buildDescription } from "./summarizer.js";

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
    timeout: 22000 
};

// VIP 풀
const LEGACY_VIP_LIST = [
    "세종대왕", "이순신", "안중근", "김구", "유관순", "방정환", "윤동주", "윤봉길", "신사임당", "이황", "광개토대왕", "장수왕", "장영실", 
    "모차르트", "베토벤", "파블로 피카소", "클로드 모네", "나폴레옹 보나파르트", "빈센트 반 고흐", "소크라테스", "플라톤", "아리스토텔레스", "공자", 
    "알베르트 아인슈타인", "토머스 에디슨", "에이브러햄 링컨", "마하트마 간디", "마리 퀴리", "맹자", "스티브 잡스", "정약용", "미켈란젤로",
    "레오나르도 다 빈치", "윌리엄 셰익스피어", "아이작 뉴턴", "갈릴레오 갈릴레이", "니콜라 테슬라", "윈스턴 처칠", "진 시황제", "곽재우",
    "헬렌 켈러", "잔 다르크", "조지 워싱턴", "크리스토퍼 콜럼버스", "찰스 다윈", "넬슨 만델라", "을지문덕",
    "마틴 루터 킹 주니어", "어니스트 헤밍웨이", "안네 프랑크", "쇼팽", "클레오파트라 7세", "칭기즈 칸",
    "알렉산드로스 대왕", "율리우스 카이사르", "마더 테레사", "체 게바라", "오드리 헾번"
];

function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

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

// 🌟 [통합 완료] isHumanPhoto + isStrictHumanImage 정밀 통합 판별 함수
function isHumanPhoto(fileInput, aliases = [], fullUrl = "", extmetadata = {}) {
    if (!fileInput) return false;

    let filename = "";
    let url = fullUrl;
    let metaData = extmetadata;

    // 객체형 입력(fileData)과 단일 문자열(filename) 입력 모두 지원
    if (typeof fileInput === "object") {
        filename = fileInput.title || fileInput.filename || "";
        url = fileInput.url || fileInput.imageinfo?.[0]?.url || fullUrl;
        metaData = fileInput.extmetadata || fileInput.imageinfo?.[0]?.extmetadata || extmetadata;
    } else {
        filename = String(fileInput);
    }

    filename = filename.replace(/^File:/i, "");

    let rawString = `${filename} ${url}`.toLowerCase();
    try { rawString = decodeURIComponent(rawString); } catch (e) {}

    const categories = (metaData.Categories?.value || "").toLowerCase();
    const description = (metaData.ImageDescription?.value || "").toLowerCase();
    const combinedMeta = `${categories} ${description}`;

    // 1. 유적지/장소 접미사 및 키워드 차단 (예: 고간원지, 생가터, 충렬비 등)
    const siteSuffixRegex = /(지|터|비|각|당|원|사|적|릉|묘|전|궁|탑|교)\.(jpg|jpeg|png|webp)$/i;
    if (siteSuffixRegex.test(rawString) && !/(가지|이지|유지)\./i.test(rawString)) {
        if (/(고간원지|유허비|생가터|기념비|사적비|비각|정려각|사당|전경|사적|유적)/i.test(rawString)) {
            return false;
        }
    }

    // 2. 파일명 끝 숫자 감지 (예: Queen_Sohye2.jpg -> 초상화 키워드가 없는 부가 유적 사진 차단)
    const hasPortraitKeyword = /(portrait|photo|face|profile|painting|oil|canvas|illustration|hyakunin|초상|어진|영정|그림)/i.test(rawString);
    if (/\d+\.(jpg|jpeg|png|webp)$/i.test(rawString) && !hasPortraitKeyword) {
        return false;
    }

    // 3. 메타데이터(카테고리/설명) 내 무덤, 유적지, 건물 관련 차단 (Beethoven.jpg 통과 / Queen_Sohye2.jpg 차단)
    const BAD_META_REGEX = /(tomb|grave|gyeongneung|seooreung|samneung|monument|cemetery|historical site|shrine|palace|building|경릉|서오릉|왕릉|묘소|사적|유적|능침|봉분|석물|정자각)/i;
    if (BAD_META_REGEX.test(combinedMeta)) {
        return false;
    }

    // 4. 블랙리스트 단어 통합 검사 (파일명, URL, 메타데이터)
    const BLACKLIST = [
        "svg", "gif", "coat of arms", "coat_of_arms", "coa", "stone", "tomb", "_tomb",
        "arms", "emblem", "insignia", "flag", "standard", "banner", "seal", "stamp",
        "icon", "logo", "symbol", "map", "chart", "diagram", "signature", "sign",
        "grave", "monument", "book", "cover", "coin", "currency", "memorial", "plaque", 
        "calligraphy", "handwriting", "manuscript", "document", "letter", "rubbing",
        "필적", "글씨", "서체", "문서", "편지", "탁본", "서간", "의궤", "집자", "현판", "비석", "묘", 
        "충렬비", "기념비", "비각", "정려각", "사당", "전경", "생가", "현충사", "사적비", "정려", "탑", "릉",
        "statue", "bust"
    ];

    for (const badWord of BLACKLIST) {
        if (rawString.includes(badWord) || combinedMeta.includes(badWord)) return false;
    }

    return true; 
}

function extractInfoboxImage(html) {
    const match = html.match(/<table[^>]*class="[^"]*infobox[\s\S]*?<img[^>]+src="([^"]+)"/i);
    if (!match) return null;
    let url = match[1];
    if (url.startsWith("//")) url = "https:" + url;
    return url;
}

const HUMAN_IMAGE_BLOCKLIST = /coin|medal|seal|flag|coat_of_arms|emblem|tomb|map|signature|statue|bust/i;
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp)$/i;
const COMMONS_BATCH_SIZE = 12;

async function findAlternativeHumanImage(title, aliases) {
    try {
        const htmlRes = await axios.get("https://ko.wikipedia.org/w/index.php", {
            ...WIKI_AXIOS_CONFIG,
            params: { title, action: "render" }
        });
        const imageUrl = extractInfoboxImage(htmlRes.data);
        if (imageUrl && isValidImageUrl(imageUrl)) {
            let imageName = imageUrl.toLowerCase();
            try { imageName = decodeURIComponent(imageName); } catch (e) {}
            if (!HUMAN_IMAGE_BLOCKLIST.test(imageName) && isHumanPhoto(imageName, aliases, imageUrl)) {
                return imageUrl;
            }
        }
    } catch (e) {
        console.log(`⚠️ 인포박스 조회 실패: ${title}`);
    }

    let res;
    try {
        res = await axios.get("https://ko.wikipedia.org/w/api.php", {
            ...WIKI_AXIOS_CONFIG,
            params: { action: "query", titles: title, prop: "images", imlimit: 50, format: "json", origin: "*" }
        });
    } catch (e) {
        return null;
    }

    const page = Object.values(res.data?.query?.pages || {})[0];
    const images = page?.images;
    if (!images || images.length === 0) return null;
    const targets = [];

    for (const img of images) {
        const name = img.title.replace(/^File:/i, "");
        if (!IMAGE_EXT_RE.test(name)) continue;
        if (!isHumanPhoto(name, aliases)) continue;
        targets.push(img.title);
    }

    if (targets.length === 0) return null;
    
    for (let i = 0; i < targets.length; i += COMMONS_BATCH_SIZE) {
        const batch = targets.slice(i, i + COMMONS_BATCH_SIZE);
        let info;
        try {
            // 🌟 iiprop에 extmetadata 추가 (카테고리/설명 메타데이터 동시 수신)
            info = await axios.get("https://commons.wikimedia.org/w/api.php", {
                ...WIKI_AXIOS_CONFIG,
                params: { action: "query", titles: batch.join("|"), prop: "imageinfo", iiprop: "url|extmetadata", format: "json", origin: "*" }
            });
        } catch (e) { continue; }

        const commonsPages = Object.values(info.data?.query?.pages || {});
        const urlMap = new Map();

        for (const file of commonsPages) {
            const url = file.imageinfo?.[0]?.url;
            if (url && isValidImageUrl(url) && isHumanPhoto(file, aliases)) {
                urlMap.set(file.title, url);
            }
        }

        for (const target of batch) {
            const url = urlMap.get(target);
            if (url) return url;
        }
    }
    return null;
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
// 캐시 충전 및 데이터 가공 로직
// =======================================================
async function fillCache() {
    if (isCaching) return;
    if (QUIZ_CACHE.length >= CACHE_SIZE) return;

    isCaching = true;
    console.log(`🔄 캐시 충전 가동 (${QUIZ_CACHE.length}/${CACHE_SIZE})`);

    let randomSearchAttempts = 0;

    while (QUIZ_CACHE.length < CACHE_SIZE && randomSearchAttempts < 20) {
        if (QUIZ_CACHE.length >= CACHE_SIZE) break;
        randomSearchAttempts++;

        try {
            let targetTitles = [];

            // 1) VIP 후보
            const vipTitles = shuffle(LEGACY_VIP_LIST)
                .filter(name => !QUIZ_CACHE.some(c => c.name.includes(name)) && !LAST_PLAYED.some(lp => lp.includes(name)))
                .slice(0, 8);

            // 2) 신규 인물 후보
            const baseYear = Math.floor(Math.random() * (2000 - 900 + 1)) + 900;
            let candidates = [];

            for (let offset = 0; offset <= 10 && candidates.length === 0; offset++) {
                const years = offset === 0 ? [baseYear] : [baseYear - offset, baseYear + offset];
                for (const year of years) {
                    if (year < 900 || year > 2000) continue;
                    const listRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                        ...WIKI_AXIOS_CONFIG,
                        params: { action: "query", list: "categorymembers", cmtitle: `분류:${year}년_출생`, cmlimit: 48, cmtype: "page", format: "json", origin: "*" }
                    });
                    candidates = listRes.data.query?.categorymembers || [];
                    if (candidates.length > 0) break;
                }
            }

            const newTitles = candidates
                .filter(cand => !cand.title.includes(":") && !QUIZ_CACHE.some(c => c.name === cand.title) && !LAST_PLAYED.includes(cand.title))
                .filter(cand => !/\(.*\)|선수|음악|기업|영화|배우|가수/.test(cand.title))
                .sort(() => Math.random() - 0.5)
                .map(c => c.title)
                .slice(0, 8);

            targetTitles = shuffle([...vipTitles, ...newTitles]);

            if (targetTitles.length > 0) {
                for (let i = 0; i < targetTitles.length; i += 3) { 
                    const batch = targetTitles.slice(i, i + 3);
                    let detailRes;

                    try {
                        detailRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                            ...WIKI_AXIOS_CONFIG,
                            params: {
                                action: "query",
                                titles: batch.join("|"),
                                prop: "extracts|pageimages",
                                explaintext: 1,   
                                redirects: 1,
                                pithumbsize: 800,
                                format: "json",
                                origin: "*"
                            }
                        });
                    } catch (e) {
                        if (e.response?.status === 429 || e.code === "ECONNABORTED") {
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        }
                        continue;
                    }

                    const pages = Object.values(detailRes.data.query?.pages || {});
                    const normalizedPages = pages.filter(p => !p.missing);

                    for (const pageData of normalizedPages) {
                        if (QUIZ_CACHE.length >= CACHE_SIZE) break;

                        if (!pageData.extract || pageData.extract.length < 60) continue;
                        if (/(대학교수|명예교수|석좌교수|교수|교육자)/.test(pageData.extract)) continue;

                        const aliases = makeNameAliases(pageData.title);
                        let imageUrl = pageData.thumbnail?.source;

                        if (!imageUrl) continue;

                        if (!isValidImageUrl(imageUrl) || !isHumanPhoto(pageData.pageimage || "", aliases, imageUrl)) {
                            imageUrl = await findAlternativeHumanImage(pageData.title, aliases);
                            if (!imageUrl) continue;
                        }

                        if (imageUrl) {
                            if (LAST_PLAYED.includes(pageData.title)) continue;
                            if (QUIZ_CACHE.some(cached => cached.name === pageData.title)) continue;

                            const fullExtract = pageData.extract;
                            const firstHeaderIndex = fullExtract.search(/==+/);
                            
                            let exintro = fullExtract;
                            let extractBody = "";

                            if (firstHeaderIndex !== -1) {
                                exintro = fullExtract.substring(0, firstHeaderIndex).trim();
                                extractBody = fullExtract.substring(firstHeaderIndex).trim();
                            }

                            const cutIndex = extractBody.search(/==\s*(각주|같이 보기|참고 문헌|외부 링크)\s*==/i);
                            if (cutIndex !== -1) {
                                extractBody = extractBody.substring(0, cutIndex);
                            }

                            let cleanExtract = extractBody
                                .replace(/=+\s*.*?\s*=+/g, " ")
                                .replace(/\s+/g, " ")
                                .trim();

                            let cleanIntro = exintro.replace(/\s+/g, " ").trim();

                            const finalDescription = buildDescription(
                                cleanIntro, 
                                cleanExtract, 
                                aliases, 
                                3,   
                                150, 
                                1100  
                            );

                            if (finalDescription) {
                                QUIZ_CACHE.push({
                                    name: pageData.title,
                                    image: imageUrl,
                                    hint: createMaskedHint(pageData.title, finalDescription),
                                    description: finalDescription 
                                });
                            }
                        }
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 800));
            }
        } catch (e) {
            if (e.response?.status === 429) {
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }
    }

    QUIZ_CACHE = shuffle(QUIZ_CACHE);
    isCaching = false;

    if (QUIZ_CACHE.length <= 22) {
        setTimeout(fillCache, 4000);
    }
}

fillCache();

// --- API ---
app.get("/api/quiz", async (req, res) => {
    try {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        let attempts = 0;

        if (QUIZ_CACHE.length === 0) {
            if (!isCaching) fillCache();
            while (QUIZ_CACHE.length === 0 && attempts < 15) {
                await new Promise(resolve => setTimeout(resolve, 400));
                attempts++;
            }
        }

        const item = QUIZ_CACHE.shift();
        if (!item) {
            return res.status(503).json({ error: "데이터 준비 중입니다. 잠시 후 새로고침 해주세요.", requestId });
        }

        if (QUIZ_CACHE.length <= 30) fillCache(); 

        LAST_PLAYED.push(item.name);
        if (LAST_PLAYED.length > 16) LAST_PLAYED.shift(); 

        res.json({ ...item, imageUrl: item.image, requestId });

    } catch (error) {
        console.error("API 오류 발생:", error);
        res.status(500).json({ error: "서버 내부 오류", errorId: `err_${Date.now()}` });
    }
});

app.use(express.static(path.join(process.cwd(), "public")));
app.get("/", (req, res) => res.sendFile(path.join(process.cwd(), "public", "index.html")));

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

export default app;
