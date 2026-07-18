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
    timeout: 13000 
};

// 🔥 레거시 유명인물 (역사적 레전드 위인) 전용 VIP 풀
const LEGACY_VIP_LIST = [
    "세종대왕", "이순신", "안중근", "김구", "유관순", "방정환", "윤동주", "윤봉길", "신사임당", "이황", "광개토대왕", "장수왕", "장영실", 
    "모차르트", "베토벤", "파블로 피카소", "클로드 모네", "나폴레옹 보나파르트", "빈센트 반 고흐", "소크라테스", "플라톤", "아리스토텔레스", "공자", 
    "알베르트 아인슈타인", "토머스 에디슨", "에이브러햄 링컨", "마하트마 간디", "마리 퀴리", "맹자", "스티브 잡스", "정약용", "미켈란젤로",
    "레오나르도 다 빈치", "윌리엄 셰익스피어", "아이작 뉴턴", "갈릴레오 갈릴레이", "니콜라 테슬라", "윈스턴 처칠", "진시황", "곽재우",
    "헬렌 켈러", "잔 다르크", "조지 워싱턴", "크리스토퍼 콜럼버스", "찰스 다윈", "넬슨 만델라", "을지문덕",
    "마틴 루터 킹 주니어", "어니스트 헤밍웨이", "안네 프랑크", "쇼팽", "클레오파트라 7세", "칭기즈 칸",
    "알렉산드로스 대왕", "율리우스 카이사르", "마더 테레사", "체 게바라", "오드리 헵번"
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

function extractInfoboxImage(html) {
    const match = html.match(
        /<table[^>]*class="[^"]*infobox[\s\S]*?<img[^>]+src="([^"]+)"/i
    );

    if (!match) return null;

    let url = match[1];

    if (url.startsWith("//")) {
        url = "https:" + url;
    }

    return url;
}

const HUMAN_IMAGE_BLOCKLIST = /coin|medal|seal|flag|coat_of_arms|emblem|tomb|map|signature|statue|bust/i;
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp)$/i;
const COMMONS_BATCH_SIZE = 12;

async function findAlternativeHumanImage(title, aliases) {
    // ===== 1순위 : 인포박스 이미지 =====
    try {
        const tInfobox = Date.now();
        const htmlRes = await axios.get("https://ko.wikipedia.org/w/index.php", {
            ...WIKI_AXIOS_CONFIG,
            params: {
                title,
                action: "render"
            }
        });
        console.log(`인포박스: ${Date.now() - tInfobox}ms`);

        const imageUrl = extractInfoboxImage(htmlRes.data);

        if (imageUrl && isValidImageUrl(imageUrl)) {
            let imageName = imageUrl.toLowerCase();

            try {
                imageName = decodeURIComponent(imageName);
            } catch (e) {
                // 디코딩 불가 URL은 원본 문자열로 판단
            }

            if (!HUMAN_IMAGE_BLOCKLIST.test(imageName)) {
                return imageUrl;
            }
        }
    } catch (e) {
        console.log(`⚠️ 인포박스 조회 실패: ${title}`);
    }

    // ===== 2순위 : 위키백과 문서 내 이미지 목록 검색 =====
    let res;
    const tImages = Date.now();

    try {
        res = await axios.get("https://ko.wikipedia.org/w/api.php", {
            ...WIKI_AXIOS_CONFIG,
            params: {
                action: "query",
                titles: title,
                prop: "images",
                imlimit: 50,
                format: "json",
                origin: "*"
            }
        });

        console.log(`Images API: ${Date.now() - tImages}ms`);
    } catch (e) {
        console.log(`Images API: ${Date.now() - tImages}ms`);
        console.log("위키 이미지 검색 오류:", e.code, e.message);
        throw e;
    }

    const page = Object.values(res.data?.query?.pages || {})[0];
    const images = page?.images;

    if (!images || images.length === 0) return null;
    const targets = images.map(img => img.title);

    for (const img of images) {
        const name = img.title.replace(/^File:/i, "");

        if (!IMAGE_EXT_RE.test(name)) {
        console.log("확장자 제외:", name);
        continue;
    }
        if (!isHumanPhoto(name, aliases)) {
    console.log("사람사진 아니라 제외:", name);
    continue;
}
        console.log("후보:", name);

        targets.push(img.title);
    }

    if (targets.length === 0) return null;
    
    // ===== 3순위 : 위키미디어 커먼즈에서 이미지 실제 URL 조회 =====
    for (let i = 0; i < targets.length; i += COMMONS_BATCH_SIZE) {
        const batch = targets.slice(i, i + COMMONS_BATCH_SIZE);
        let info;
        const tCommons = Date.now();

        try {
            info = await axios.get("https://commons.wikimedia.org/w/api.php", {
                ...WIKI_AXIOS_CONFIG,
                params: {
                    action: "query",
                    titles: batch.join("|"),
                    prop: "imageinfo",
                    iiprop: "url",
                    format: "json",
                    origin: "*"
                }
            });

            console.log(`Commons API: ${Date.now() - tCommons}ms`);
        } catch (e) {
            console.log(`Commons API: ${Date.now() - tCommons}ms`);
            console.log("Commons API 오류:", e.code, e.message);
            continue;
        }

        const commonsPages = Object.values(info.data?.query?.pages || {});
        const urlMap = new Map();

        for (const file of commonsPages) {
            const pageTitle = file.title;
            const url = file.imageinfo?.[0]?.url;

            if (url && isValidImageUrl(url)) {
                urlMap.set(pageTitle, url);
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
// 5) 투트랙 최적화 캐시 충전
// =======================================================
async function fillCache() {
    if (isCaching) return;
    if (QUIZ_CACHE.length >= CACHE_SIZE) return;

    const t0 = Date.now();

    isCaching = true;
    console.log(`🔄 투트랙 캐시 충전 가동 (현재 상태: ${QUIZ_CACHE.length}/${CACHE_SIZE})`);

    let randomSearchAttempts = 0;

    while (QUIZ_CACHE.length < CACHE_SIZE && randomSearchAttempts < 20) {
        if (QUIZ_CACHE.length >= CACHE_SIZE) break;
        randomSearchAttempts++;

        const loopStart = Date.now();
        
          try{
            let targetTitles = [];

// 1) VIP 후보
const vipTitles = shuffle(LEGACY_VIP_LIST)
    .filter(name =>
        !QUIZ_CACHE.some(c => c.name.includes(name)) &&
        !LAST_PLAYED.some(lp => lp.includes(name))
    )
    .slice(0, 8);

// 2) 신규 후보
const baseYear = Math.floor(Math.random() * (2000 - 900 + 1)) + 900;
const MAX_OFFSET = 10;

let candidates = [];

for (let offset = 0; offset <= MAX_OFFSET && candidates.length === 0; offset++) {
    const years = offset === 0
        ? [baseYear]
        : [baseYear - offset, baseYear + offset];

    for (const year of years) {
        if (year < 900 || year > 2000) continue;

        const listStart = Date.now();

        const listRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
            ...WIKI_AXIOS_CONFIG,
            params: {
                action: "query",
                list: "categorymembers",
                cmtitle: `분류:${year}년_출생`,
                cmlimit: 48,
                cmtype: "page",
                format: "json",
                origin: "*"
            }
        });

        candidates = listRes.data.query?.categorymembers || [];

        console.log(`📅 ${year}년_출생 조회: ${Date.now() - listStart}ms / ${candidates.length}명`);

        if (candidates.length > 0) break;
    }
}

const newTitles = candidates
    .filter(cand =>
        !cand.title.includes(":") &&
        !QUIZ_CACHE.some(c => c.name === cand.title) &&
        !LAST_PLAYED.includes(cand.title)
    )
    .filter(cand =>
        !/\(.*\)|선수|음악|기업|영화|배우|가수/.test(cand.title)
    )
    .sort(() => Math.random() - 0.5)
    .map(c => c.title)
    .slice(0, 8);

// 3) VIP + 신규 혼합
targetTitles = shuffle([
    ...vipTitles,
    ...newTitles
]);

console.log(
    `혼합 후보선정: VIP ${vipTitles.length}개 / 신규 ${newTitles.length}개 / 총 ${targetTitles.length}개`
);

            if (targetTitles.length > 0) {
                const batchStart = Date.now();
                let addedCount = 0;
                
                for (let i = 0; i < targetTitles.length; i += 3) { 
                    const detailStart = Date.now();
                    const batch = targetTitles.slice(i, i + 3);
                    let detailRes;

                    try {
                        detailRes = await axios.get(
                            "https://ko.wikipedia.org/w/api.php",
                            {
                                ...WIKI_AXIOS_CONFIG,
                                params: {
                                    action: "query",
                                    titles: batch.join("|"),
                                    prop: "extracts|pageimages",
                                    explaintext: true,
                                    pithumbsize: 800,
                                    format: "json",
                                    origin: "*"
                                }
                            }
                        );
                    } catch (e) {
    console.log(`❌ 상세조회 실패 (${Date.now() - detailStart}ms)`);
    console.log(`배치: ${batch.join(", ")}`);
    console.log(`코드: ${e.code}`);
    console.log(`메시지: ${e.message}`);

    if (e.response?.status === 429 || e.code === "ECONNABORTED") {
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    continue;
}

                    const pages = Object.values(detailRes.data.query?.pages || {});
                    console.log(`상세조회(${batch.join(", ")}): ${Date.now() - detailStart}ms / 페이지 ${pages.length}개`);

                    for (const pageData of pages) {
                        console.log("TITLE:", pageData.title);
console.log("EXTRACT:", pageData.extract);
console.log("EXTRACT LEN:", pageData.extract?.length);
console.log("----------------");
    if (QUIZ_CACHE.length >= CACHE_SIZE) break;

    if (!pageData) {
        console.log("❌ pageData 없음");
        continue;
    }

    if (!pageData.extract || pageData.extract.length < 100) {
        console.log(`❌ ${pageData.title} → extract 부족`);
        continue;
    }

    if (/(대학교수|명예교수|석좌교수|교수|교육자)/.test(pageData.extract)) {
        console.log(`❌ ${pageData.title} → 교수 제외`);
        continue;
    }
    const aliases = makeNameAliases(pageData.title);
    console.log(pageData.title, "=>", pageData.pageimage);

    let imageUrl = pageData.thumbnail?.source;

    if (!imageUrl) {
        console.log(`❌ ${pageData.title} → 썸네일 없음`);
        continue;
    }

    if (!isValidImageUrl(imageUrl)) {
        console.log(`🔍 ${pageData.title} → 대표 이미지 제외, 대체 이미지 탐색`);
        const t1 = Date.now();

        imageUrl = await findAlternativeHumanImage(pageData.title, aliases);

        console.log(`findAlternativeHumanImage: ${Date.now() - t1}ms`);

        if (!imageUrl) {
            console.log(`❌ ${pageData.title} → 사람사진 없음`);
            continue;
        }
    } else if (!isHumanPhoto(pageData.pageimage || "", aliases)) {
        console.log(`❌ ${pageData.title} → 사람사진 판정 실패`);
        continue;
    }

    const imageName = (pageData.pageimage || "").toLowerCase();

    if (
        imageUrl === pageData.thumbnail?.source &&
        /coin|medal|seal|flag|coat_of_arms|emblem|tomb|map|signature|statue|bust/i.test(imageName)
    ) {
        console.log(`⛔ 사람 사진 없음으로 제외: ${pageData.title}`);
        continue;
    }

    if (imageUrl) {
        if (LAST_PLAYED.includes(pageData.title)) {
            console.log(`최근 출제 제외: ${pageData.title}`);
            continue;
        }

        if (QUIZ_CACHE.some(cached => cached.name === pageData.title)) {
            console.log(`중복 제외: ${pageData.title}`);
            continue;
        }

        let rawText = pageData.extract;
        const cutIndex = rawText.search(/==\s*(각주|같이 보기|참고 문헌|외부 링크)\s*==/i);

        if (cutIndex !== -1) {
            rawText = rawText.substring(0, cutIndex);
        }

        rawText = rawText
            .substring(0, 1200)
            .replace(/=+\s*.*?\s*=+/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        if (rawText.length < 100) continue;

        console.log(`추가 후보: ${pageData.title}`);

        QUIZ_CACHE.push({
            name: pageData.title,
            image: imageUrl,
            hint: createMaskedHint(pageData.title, rawText),
            description:
                rawText.length > 1000
                    ? rawText.substring(0, 1000) + "..."
                    : rawText
        });

        addedCount++;
    }
}
                }
                console.log(`캐시 적재: ${addedCount}개 / ${Date.now() - batchStart}ms`);
                await new Promise(resolve => setTimeout(resolve, 800));
            } else {
                console.log(`후보 없음 / ${Date.now() - loopStart}ms`);
            }
        } catch (e) {
            console.warn("⚠️ 검색 시도 중 에러");
            console.warn("URL:", e.config?.url);
            console.warn("Params:", e.config?.params);
            console.warn("Message:", e.message);
            console.error(e.stack);

            if (e.response?.status === 429) {
    console.log("🚫 위키 429 발생, 10초 대기");
    await new Promise(resolve => setTimeout(resolve, 10000));
    continue;
}
        }

        console.log(`루프 1회 종료: ${Date.now() - loopStart}ms / 현재 캐시 ${QUIZ_CACHE.length}`);
    }

    QUIZ_CACHE = shuffle(QUIZ_CACHE);
    isCaching = false;

    console.log(
        `✅ 현재 최종 캐시량: ${QUIZ_CACHE.length}/${CACHE_SIZE} / 총 ${Date.now() - t0}ms`
    );

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
        if (!isCaching) {
            fillCache();
        }

        while (QUIZ_CACHE.length === 0 && attempts < 15) {
            await new Promise(resolve => setTimeout(resolve, 400));
            attempts++;
        }
    }

    const item = QUIZ_CACHE.shift();

    if (!item) {
        return res.status(503).json({
            error: "데이터 준비 중입니다. 잠시 후 새로고침 해주세요.",
            requestId
        });
    }

        // 캐시가 5개 이하로 떨어지면 백그라운드 자동 충전
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

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
