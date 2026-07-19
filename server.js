import express from "express";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import { buildDescription } from "./summarizer.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(process.cwd(), "public");

app.disable("x-powered-by");

app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");

    if (req.path === "/api/quiz") {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    } else {
        res.setHeader("Cache-Control", "public, max-age=3600, immutable");
    }

    next();
});

process.on("unhandledRejection", (reason) => {
    console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
});

// =======================================================
// 설정
// =======================================================
const CACHE_SIZE = 40;
const LOW_WATERMARK = 30;
const LAST_PLAYED_LIMIT = 16;

let QUIZ_CACHE = [];
let CACHE_TITLE_SET = new Set();

let LAST_PLAYED_QUEUE = [];
let LAST_PLAYED_SET = new Set();

let isCaching = false;

const WIKI_AXIOS_CONFIG = {
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
    },
    timeout: 13000
};

const LEGACY_VIP_LIST = [
    "세종대왕", "이순신", "안중근", "김구", "유관순", "방정환", "윤동주", "윤봉길", "신사임당", "이황",
    "광개토대왕", "장수왕", "장영실", "모차르트", "베토벤", "파블로 피카소", "클로드 모네",
    "나폴레옹 보나파르트", "빈센트 반 고흐", "소크라테스", "플라톤", "아리스토텔레스", "공자",
    "알베르트 아인슈타인", "토머스 에디슨", "에이브러햄 링컨", "마하트마 간디", "마리 퀴리",
    "맹자", "스티브 잡스", "정약용", "미켈란젤로", "레오나르도 다 빈치", "윌리엄 셰익스피어",
    "아이작 뉴턴", "갈릴레오 갈릴레이", "니콜라 테슬라", "윈스턴 처칠", "진 시황제", "곽재우",
    "헬렌 켈러", "잔 다르크", "조지 워싱턴", "크리스토퍼 콜럼버스", "찰스 다윈", "넬슨 만델라",
    "을지문덕", "마틴 루터 킹 주니어", "어니스트 헤밍웨이", "안네 프랑크", "쇼팽", "클레오파트라 7세",
    "칭기즈 칸", "알렉산드로스 대왕", "율리우스 카이사르", "마더 테레사", "체 게바라", "오드리 헵번"
];

const HUMAN_IMAGE_BLOCKLIST = /coin|medal|seal|flag|coat_of_arms|emblem|tomb|map|signature|statue|bust/"비문"/i;
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp)$/i;
const COMMONS_BATCH_SIZE = 12;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function chunkArray(array, size) {
    const out = [];
    for (let i = 0; i < array.length; i += size) {
        out.push(array.slice(i, i + size));
    }
    return out;
}

function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function normalizeKey(text = "") {
    return String(text)
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[()[\]{}.,'"“”‘’`~!@#$%^&*_+=|\\/:;?-]/g, "");
}

function isAlreadyUsed(title) {
    const key = normalizeKey(title);
    return CACHE_TITLE_SET.has(key) || LAST_PLAYED_SET.has(key);
}

function rememberCachedTitle(title) {
    CACHE_TITLE_SET.add(normalizeKey(title));
}

function popCacheItem() {
    const item = QUIZ_CACHE.shift();
    if (item?.name) {
        CACHE_TITLE_SET.delete(normalizeKey(item.name));
    }
    return item;
}

function rememberPlayedTitle(title) {
    const key = normalizeKey(title);
    LAST_PLAYED_QUEUE.push(key);
    LAST_PLAYED_SET.add(key);

    if (LAST_PLAYED_QUEUE.length > LAST_PLAYED_LIMIT) {
        const old = LAST_PLAYED_QUEUE.shift();
        if (old) LAST_PLAYED_SET.delete(old);
    }
}

function makeNameAliases(title) {
    const clean = title.replace(/\(.+?\)/g, "").trim();
    const lower = clean.toLowerCase();

    const aliases = [
        clean,
        lower,
        lower.replace(/\s+/g, "_"),
        lower.replace(/\s+/g, "-")
    ];

    if (/모차르트/.test(clean)) aliases.push("mozart");
    if (/베토벤/.test(clean)) aliases.push("beethoven");
    if (/피카소/.test(clean)) aliases.push("picasso");
    if (/간디/.test(clean)) aliases.push("gandhi");
    if (/고흐/.test(clean)) aliases.push("gogh");
    if (/나폴레옹/.test(clean)) aliases.push("napoleon");
    if (/아인슈타인/.test(clean)) aliases.push("einstein");
    if (/뉴턴/.test(clean)) aliases.push("newton");

    return [...new Set(aliases.map(x => String(x).trim()).filter(Boolean))];
}

function isValidImageUrl(url) {
    if (!url || typeof url !== "string") return false;
    if (/\.svg(\?.*)?$/i.test(url) || /\/svg\//i.test(url)) return false;

    const lower = url.toLowerCase();
    if (
        lower.includes("coat_of_arms") ||
        lower.includes("emblem") ||
        lower.includes("flag") ||
        lower.includes("icon")
    ) {
        return false;
    }

    return /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url);
}

function isLikelyHumanImageUrl(url) {
    if (!isValidImageUrl(url)) return false;
    let probe = url.toLowerCase();

    try {
        probe = decodeURIComponent(probe);
    } catch (_) {}

    return !HUMAN_IMAGE_BLOCKLIST.test(probe);
}

function isHumanPhoto(filename, aliases) {
    if (!filename || typeof filename !== "string") return false;
    const n = filename.toLowerCase();

    const BLACKLIST = [
        "svg", "gif", "coat of arms", "coat_of_arms", "coa", "stone", "tomb", "_tomb",
        "arms", "emblem", "insignia", "flag", "standard", "banner", "seal", "stamp",
        "icon", "logo", "symbol", "map", "chart", "diagram", "signature", "sign",
        "grave", "monument", "book", "cover", "coin", "currency", "memorial", "plaque",
        "calligraphy", "handwriting", "manuscript", "document", "letter", "rubbing",
        "필적", "글씨", "서체", "문서", "편지", "탁본", "서간", "의궤", "집자", "현판",
        "비석", "묘", "충렬비", "기념비", "비각", "정려각", "사당", "전경", "생가",
        "현충사", "사적비", "정려", "탑", "릉"
    ];

    for (const bad of BLACKLIST) {
        if (n.includes(bad)) return false;
    }

    if (/(portrait|photo|face|profile|bust|painting|oil|canvas|illustration|statue)/i.test(n)) {
        return true;
    }

    for (const a of aliases) {
        if (!a) continue;
        const cleanName = normalizeKey(a);
        const cleanFile = normalizeKey(n);
        if (cleanFile.includes(cleanName)) return true;
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

function cleanExtractText(text) {
    if (!text) return "";

    let t = String(text).replace(/\r/g, "\n").trim();

    const cutIndex = t.search(/^\s*==\s*(각주|같이 보기|참고 문헌|외부 링크)\s*==/im);
    if (cutIndex !== -1) {
        t = t.slice(0, cutIndex);
    }

    t = t
        .replace(/=+\s*.*?\s*=+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    return t;
}

function normalizeResponsePages(resData) {
    return Object.values(resData?.query?.pages || {}).filter(p => !p.missing);
}

async function fetchWikiPagesByTitles(titles, introOnly = false) {
    if (!titles || titles.length === 0) return [];

    const params = {
        action: "query",
        titles: titles.join("|"),
        prop: "extracts|pageimages",
        redirects: 1,
        explaintext: 1,
        pithumbsize: 800,
        format: "json",
        origin: "*"
    };

    if (introOnly) {
        params.exintro = 1;
    }

    const res = await axios.get("https://ko.wikipedia.org/w/api.php", {
        ...WIKI_AXIOS_CONFIG,
        params
    });

    return normalizeResponsePages(res.data);
}

async function fetchCandidateTitlesByYear() {
    const baseYear = Math.floor(Math.random() * (2000 - 900 + 1)) + 900;
    const MAX_OFFSET = 10;
    let candidates = [];

    for (let offset = 0; offset <= MAX_OFFSET && candidates.length === 0; offset++) {
        const years = offset === 0 ? [baseYear] : [baseYear - offset, baseYear + offset];

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

    return candidates;
}

function createMaskedHint(title, extract) {
    let hintText = String(extract || "").substring(0, 350);
    const cleanTitle = String(title || "").trim();

    const parenMatch = cleanTitle.match(/\((.*?)\)/);
    if (parenMatch) {
        parenMatch[1].split(/[\s\.\,\-]+/).forEach((part) => {
            if (part.length > 1) {
                hintText = hintText.replace(
                    new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
                    "OOO"
                );
            }
        });
    }

    const baseName = cleanTitle.replace(/\s*\(.*?\)\s*/g, "");
    baseName.split(" ").forEach((word) => {
        if (word.length >= 2) {
            hintText = hintText.replace(
                new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
                "OOO"
            );

            if (word.length >= 3 && !/\s/.test(word)) {
                for (let i = 0; i <= word.length - 2; i++) {
                    const part = word.substring(i, i + 2);
                    hintText = hintText.replace(
                        new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
                        "OOO"
                    );
                }
            }
        }
    });

    hintText = hintText.replace(/([a-zA-Z\d\.\,\:\-\s'\[\]\/\(\)ˌˈɛɔ]+)/g, (match, p1) => {
        const cleaned = p1.trim();
        return (cleaned.length > 1 && /[a-zA-Z]/.test(cleaned)) ? "OOO" : match;
    });

    return hintText.substring(0, 130).trim() + "...";
}

async function findAlternativeHumanImage(title, aliases) {
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
        if (imageUrl && isValidImageUrl(imageUrl) && isLikelyHumanImageUrl(imageUrl)) {
            return imageUrl;
        }
    } catch (e) {
        console.log(`⚠️ 인포박스 조회 실패: ${title}`);
    }

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
    const images = page?.images || [];
    if (images.length === 0) return null;

    const targets = [];
    for (const img of images) {
        const name = img.title.replace(/^File:/i, "");
        if (!IMAGE_EXT_RE.test(name)) continue;
        if (!isHumanPhoto(name, aliases)) continue;
        targets.push(img.title);
    }

    if (targets.length === 0) return null;

    for (const batch of chunkArray(targets, COMMONS_BATCH_SIZE)) {
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

            if (url && isValidImageUrl(url) && isLikelyHumanImageUrl(url)) {
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

async function fillCache() {
    if (isCaching) return;
    if (QUIZ_CACHE.length >= CACHE_SIZE) return;

    const t0 = Date.now();
    isCaching = true;
    console.log(`🔄 투트랙 캐시 충전 가동 (현재 상태: ${QUIZ_CACHE.length}/${CACHE_SIZE})`);

    let randomSearchAttempts = 0;

    try {
        while (QUIZ_CACHE.length < CACHE_SIZE && randomSearchAttempts < 20) {
            randomSearchAttempts++;
            const loopStart = Date.now();

            try {
                const vipTitles = shuffle(LEGACY_VIP_LIST)
                    .filter(name => !isAlreadyUsed(name))
                    .slice(0, 8);

                const candidates = await fetchCandidateTitlesByYear();

                const newTitles = candidates
                    .map(c => c.title)
                    .filter(title =>
                        title &&
                        !title.includes(":") &&
                        !isAlreadyUsed(title) &&
                        !/\(.*\)|선수|음악|기업|영화|배우|가수/.test(title)
                    )
                    .sort(() => Math.random() - 0.5)
                    .slice(0, 8);

                const targetTitles = shuffle([...vipTitles, ...newTitles]);

                console.log(
                    `혼합 후보선정: VIP ${vipTitles.length}개 / 신규 ${newTitles.length}개 / 총 ${targetTitles.length}개`
                );

                if (targetTitles.length === 0) {
                    console.log(`후보 없음 / ${Date.now() - loopStart}ms`);
                    continue;
                }

                const batchStart = Date.now();
                let addedCount = 0;

                // 1) intro만 먼저 가져오기
                const introPages = [];
                for (const batch of chunkArray(targetTitles, 4)) {
                    if (QUIZ_CACHE.length >= CACHE_SIZE) break;

                    const detailStart = Date.now();
                    try {
                        const pages = await fetchWikiPagesByTitles(batch, true);
                        introPages.push(...pages);
                        console.log(`intro조회(${batch.join(", ")}): ${Date.now() - detailStart}ms`);
                    } catch (e) {
                        console.log(`❌ intro 상세조회 실패 (${Date.now() - detailStart}ms)`);
                        console.log(`배치: ${batch.join(", ")}`);
                        console.log(`코드: ${e.code}`);
                        console.log(`메시지: ${e.message}`);

                        if (e.response?.status === 429 || e.code === "ECONNABORTED") {
                            await delay(3000);
                        }
                    }

                    await delay(80);
                }

                const pending = [];
                const needFullTitles = [];

                for (const pageData of introPages) {
                    if (QUIZ_CACHE.length >= CACHE_SIZE) break;
                    if (!pageData?.title) continue;

                    const title = pageData.title;
                    const aliases = makeNameAliases(title);
                    const introText = cleanExtractText(pageData.extract || "");

                    if (!introText || introText.length < 20) {
                        console.log(`❌ ${title} → intro 부족`);
                        continue;
                    }

                    if (/(대학교수|명예교수|석좌교수|교수|교육자)/.test(introText)) {
                        console.log(`❌ ${title} → 교수 제외`);
                        continue;
                    }

                    let imageUrl = pageData.thumbnail?.source || null;
                    if (imageUrl && !isLikelyHumanImageUrl(imageUrl)) {
                        imageUrl = null;
                    }

                    if (!imageUrl) {
                        console.log(`🔍 ${title} → 대표 이미지 없음/부적절, 대체 이미지 탐색`);
                        const t1 = Date.now();
                        imageUrl = await findAlternativeHumanImage(title, aliases);
                        console.log(`findAlternativeHumanImage: ${Date.now() - t1}ms`);
                    }

                    if (!imageUrl) {
                        console.log(`❌ ${title} → 사람사진 없음`);
                        continue;
                    }

                    if (isAlreadyUsed(title)) {
                        console.log(`중복 제외: ${title}`);
                        continue;
                    }

                    pending.push({
                        title,
                        aliases,
                        introText,
                        imageUrl
                    });

                    if (introText.length < 150) {
                        needFullTitles.push(title);
                    }
                }

                // 2) intro가 짧은 것만 본문 전체를 추가 조회
                const fullMap = new Map();
                const uniqueNeedFull = [...new Set(needFullTitles.map(t => t.trim()).filter(Boolean))];

                for (const batch of chunkArray(uniqueNeedFull, 6)) {
                    const fullStart = Date.now();
                    try {
                        const fullPages = await fetchWikiPagesByTitles(batch, false);
                        for (const p of fullPages) {
                            if (p?.title && !p.missing) {
                                fullMap.set(normalizeKey(p.title), cleanExtractText(p.extract || ""));
                            }
                        }
                        console.log(`full조회(${batch.join(", ")}): ${Date.now() - fullStart}ms`);
                    } catch (e) {
                        console.log(`⚠️ full extract 조회 실패 (${Date.now() - fullStart}ms)`);
                        console.log("메시지:", e.message);

                        if (e.response?.status === 429 || e.code === "ECONNABORTED") {
                            await delay(3000);
                        }
                    }

                    await delay(80);
                }

                // 3) 최종 설명 생성
                for (const item of pending) {
                    if (QUIZ_CACHE.length >= CACHE_SIZE) break;

                    const fullText = fullMap.get(normalizeKey(item.title)) || item.introText;
                    const description = buildDescription(
                        item.introText,
                        fullText,
                        item.aliases,
                        3,
                        150,
                        1000
                    );

                    if (!description || description.length < 100) {
                        console.log(`❌ ${item.title} → 설명 부족`);
                        continue;
                    }

                    QUIZ_CACHE.push({
                        name: item.title,
                        image: item.imageUrl,
                        hint: createMaskedHint(item.title, description),
                        description: description.length > 1000
                            ? description.substring(0, 1000) + "..."
                            : description
                    });

                    rememberCachedTitle(item.title);
                    addedCount++;
                    console.log(`추가 후보: ${item.title}`);
                }

                console.log(`캐시 적재: ${addedCount}개 / ${Date.now() - batchStart}ms`);
                await delay(800);
            } catch (e) {
                console.warn("⚠️ 검색 시도 중 에러");
                console.warn("URL:", e.config?.url);
                console.warn("Params:", e.config?.params);
                console.warn("Message:", e.message);
                console.error(e.stack);

                if (e.response?.status === 429) {
                    console.log("🚫 위키 429 발생, 10초 대기");
                    await delay(10000);
                }
            }

            console.log(`루프 1회 종료: ${Date.now() - loopStart}ms / 현재 캐시 ${QUIZ_CACHE.length}`);
        }
    } finally {
        QUIZ_CACHE = shuffle(QUIZ_CACHE);
        isCaching = false;

        console.log(`✅ 현재 최종 캐시량: ${QUIZ_CACHE.length}/${CACHE_SIZE} / 총 ${Date.now() - t0}ms`);

        if (QUIZ_CACHE.length <= 22) {
            setTimeout(fillCache, 4000);
        }
    }
}

fillCache();

// =======================================================
// API
// =======================================================
app.get("/api/quiz", async (req, res) => {
    try {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        let attempts = 0;

        if (QUIZ_CACHE.length === 0) {
            if (!isCaching) {
                fillCache();
            }

            while (QUIZ_CACHE.length === 0 && attempts < 15) {
                await delay(400);
                attempts++;
            }
        }

        const item = popCacheItem();

        if (!item) {
            return res.status(503).json({
                error: "데이터 준비 중입니다. 잠시 후 새로고침 해주세요.",
                requestId
            });
        }

        if (QUIZ_CACHE.length <= LOW_WATERMARK) {
            fillCache();
        }

        rememberPlayedTitle(item.name);

        return res.json({
            ...item,
            imageUrl: item.image,
            requestId
        });
    } catch (error) {
        console.error("API 오류 발생:", error);
        return res.status(500).json({
            error: "서버 내부 오류",
            errorId: `err_${Date.now()}`
        });
    }
});

app.use(express.static(PUBLIC_DIR));
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
