import express from "express";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import { load } from "cheerio";
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
process.on('exit', (code) => {
    console.log("PROCESS EXIT", code);
});

process.on('SIGTERM', () => {
    console.log("SIGTERM RECEIVED");
});

// --- 설정 ---
const CACHE_SIZE = 40;
const SERVER_ID = Math.random().toString(36).slice(2,8);
let QUIZ_CACHE = [];
let LAST_PLAYED = [];
let isCaching = false;

const WIKI_AXIOS_CONFIG = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
    },
    timeout: 36000 
};

// VIP 풀
const LEGACY_VIP_LIST = [
    "세종대왕", "이순신", "안중근", "김구", "유관순", "방정환", "윤동주", "윤봉길", "신사임당", "이황", "광개토대왕", "장영실", 
    "모차르트", "베토벤", "파블로 피카소", "클로드 모네", "나폴레옹 보나파르트", "빈센트 반 고흐", "소크라테스", "플라톤", "아리스토텔레스", "공자", 
    "알베르트 아인슈타인", "토머스 에디슨", "에이브러햄 링컨", "마하트마 간디", "마리 퀴리", "맹자", "스티브 잡스", "정약용", "미켈란젤로",
    "레오나르도 다 빈치", "윌리엄 셰익스피어", "아이작 뉴턴", "갈릴레오 갈릴레이", "니콜라 테슬라", "윈스턴 처칠", "진 시황제", "곽재우",
    "헬렌 켈러", "잔 다르크", "조지 워싱턴", "크리스토퍼 콜럼버스", "찰스 다윈", "넬슨 만델라", "을지문덕",
    "마틴 루터 킹 주니어", "어니스트 헤밍웨이", "안네 프랑크", "쇼팽", "클레오파트라 7세", "칭기즈 칸",
    "알렉산드로스 대왕", "율리우스 카이사르", "마더 테레사", "체 게바라", "오드리 헵번"
];

const HUMAN_IMAGE_BLOCKLIST = /(?:^|[\s_./\\-])(?:coin|medal|seal|flag|coat_of_arms|emblem|tomb|temple|grave|map|signature|sabre|poem|feather|quill|pen|symbol|icon|picto|insignia|rank|award|handwriting|drawing|sketch|illustration|calligraphy|landscape|gardenshield)(?:$|[\s_./\\-])|(?:^|[\s_./\\-])(?:청|적|백|황|녹|파|남|흑|blue|red|green|yellow)\d+(?:px)?(?:\.|[\s_.-]|$)/i;
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp)$/i;
const COMMONS_BATCH_SIZE = 14;

const VIP_IMAGE_FALLBACKS = {
    "이순신": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/%EC%9D%B4%EC%88%9C%EC%8B%A0.jpg/1280px-%EC%9D%B4%EC%88%9C%EC%8B%A0.jpg"
};

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

    // 🛠️ [수정] 원본 cleanKo도 포함하여 filterOtherPerson의 대소문자 검사 통과 보장
    let aliases = [cleanKo, lowerKo, lowerKo.replace(/\s+/g, "_"), lowerKo.replace(/\s+/g, "-")];
    
    if (/모차르트/.test(cleanKo)) aliases.push("mozart", "Mozart");
    if (/베토벤/.test(cleanKo)) aliases.push("beethoven", "Beethoven");
    if (/피카소/.test(cleanKo)) aliases.push("picasso", "Picasso");
    if (/간디/.test(cleanKo)) aliases.push("gandhi", "Gandhi");
    if (/고흐/.test(cleanKo)) aliases.push("gogh", "Gogh");
    if (/나폴레옹/.test(cleanKo)) aliases.push("napoleon", "Napoleon");
    
    return [...new Set(aliases)];
}

function isCulturalSiteImage(url) {
    if (!url || typeof url !== "string") return false;

    let filename = url.split('?')[0];

    let decoded = filename;
    try {
        while (decoded.includes('%')) {
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
        }
    } catch (e) {}

    let clean = decoded
        .replace(/^.*[\\/]/, '')
        .replace(/^파일:/i, '')
        .replace(/\.[^/.]+$/, '')
        .replace(/[\s_.-]+\d+$/g, '')
        .trim();

    const absoluteSiteRegex = /(palace|temple|shrine|tomb|heritage|sanctuary|sadaang|gyeongbok|bulguk|seokguram)/i;
    if (absoluteSiteRegex.test(clean)) return true;

    const otherSiteRegex = /([가-힣]{2,}(궁|능|릉|묘|각|루)$|사찰|서원|신도비|유적지|행궁|[宮陵墓寺閣樓])/;
    if (otherSiteRegex.test(clean)) return true;

    const tokens = clean.split(/[\s_.-]+/).filter(Boolean);

    const personTitles = new Set(['mother', 'king', 'queen', 'saint', 'president', 'actor', 'doctor', 'prof']);
    if (tokens.some(t => personTitles.has(t.toLowerCase()))) return false;

    const koreanSaRegex = /^[가-힣]{1,3}사$/;
    const englishSiteSuffix = /(gung|neung|reung|myo|sadaang|hyeonsa|guksa)$/i;

    return tokens.some(token => 
        koreanSaRegex.test(token) || 
        englishSiteSuffix.test(token)
    );
}

function hasForbiddenDescription(file) {
    const desc = file.imageinfo?.[0]?.extmetadata?.ImageDescription?.value;
    return desc?.includes("陵");
}


function isValidImageUrl(url) {
    if (!url || typeof url !== "string") return false;

    let decodedUrl = url.toLowerCase();
    try {
        decodedUrl = decodeURIComponent(decodedUrl);
    } catch (e) {}

    if (decodedUrl.includes(".svg") || decodedUrl.includes("picto")) return false;

    const Keywords = [
        "coat_of_arms", "emblem", "flag", "icon", "grave", "tomb", "map", "moon",
        "signature", "sword", "sabre", "saber", "weapon", "monument",
        "feather", "quill", "symbol", "insignia", "coin", "cross",
        "black dot", "black_dot", "black-dot", "placeholder", "no image", "no_image",
        "question", "default", "missing",
        "깃털", "훈장", "계급", "상징", "지도", 
        "묘", "도장", "서명", "깃발", "휘장", "문장"
    ];

    const hasKeyword = Keywords.some(keyword => {
        if (/^[a-z0-9_-]+$/i.test(keyword)) {
            const regex = new RegExp(`(?:^|[\\s_./\\\\-])${keyword}(?:$|[\\s_./\\\\-])`, 'i');
            return regex.test(decodedUrl);
        }
        return decodedUrl.includes(keyword);
    });

    if (hasKeyword) return false;

    return /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(decodedUrl);
}

function extractInfoboxImage(html) {
    const $ = load(html);
    const infobox = $("table.infobox").first();
    if (!infobox.length) return null;

    for (const img of infobox.find("img")) {
        let url = $(img).attr("src");
        if (!url) continue;

        if (url.startsWith("//")) {
            url = "https:" + url;
        }

        const name = decodeURIComponent(url.toLowerCase());

        if (name.includes("picto_infobox") || name.includes("signature") || name.endsWith(".svg")) {
            continue;
        }

        if (!isValidImageUrl(url) || isCulturalSiteImage(url)) {
            continue;
        }

        return url;
    }

    return null;
}

async function findAlternativeHumanImage(title, aliases) {
    console.time(`🖼️ 이미지 탐색 ${title}`);
    try {
        const htmlRes = await axios.get("https://ko.wikipedia.org/w/index.php", {
            ...WIKI_AXIOS_CONFIG,
            params: { title, action: "render" }
        });
        const imageUrl = extractInfoboxImage(htmlRes.data);
        
        if (imageUrl && isValidImageUrl(imageUrl) && !isCulturalSiteImage(imageUrl)) {
            console.timeEnd(`🖼️ 이미지 탐색 ${title}`);
            return imageUrl;
        }
    } catch (e) {
        console.log(`⚠️ 인포박스 조회 실패:`, title, e.message);
    }

    let res;
    try {
        res = await axios.get("https://ko.wikipedia.org/w/api.php", {
            ...WIKI_AXIOS_CONFIG,
            params: { action: "query", titles: title, prop: "images", iiprop: "url|extmetadata", imlimit: 50, format: "json", origin: "*" }
        });
    } catch (e) {
        console.timeEnd(`🖼️ 이미지 탐색 ${title}`);
        return null;
    }

    const page = Object.values(res.data?.query?.pages || {})[0];
    const images = page?.images;
    if (!images || images.length === 0) {
        console.timeEnd(`🖼️ 이미지 탐색 ${title}`);
        return null;
    }

    const targets = [];
    for (const img of images) {
        const name = img.title.replace(/^File:/i, "");
        if (!IMAGE_EXT_RE.test(name) || HUMAN_IMAGE_BLOCKLIST.test(name) || isCulturalSiteImage(name)) continue;
        targets.push(img.title);
    }

    if (targets.length === 0) {
        console.timeEnd(`🖼️ 이미지 탐색 ${title}`);
        return null;
    }
    
    for (let i = 0; i < targets.length; i += COMMONS_BATCH_SIZE) {
        const batch = targets.slice(i, i + COMMONS_BATCH_SIZE);
        let info;
        try {
            info = await axios.get("https://commons.wikimedia.org/w/api.php", {
                ...WIKI_AXIOS_CONFIG,
                params: {action: "query", titles: batch.join("|"), prop: "imageinfo", iiprop: "url|extmetadata", iiextmetadatafilter: "ImageDescription",
                   iiurlwidth: 800, format: "json", origin: "*"}});
        } catch (e) { continue; }

        const commonsPages = Object.values(info.data?.query?.pages || {});
        for (const file of commonsPages) {
            const url = file.imageinfo?.[0]?.url;
            if (url && !hasForbiddenDescription(file) && isValidImageUrl(url) && !isCulturalSiteImage(url)) {
                console.timeEnd(`🖼️ 이미지 탐색 ${title}`);
                return url;
            }
        }
    }
    console.timeEnd(`🖼️ 이미지 탐색 ${title}`);
    return null;
}

function createMaskedHint(title, extract = "") {
    if (!extract) return "";
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
    console.log("SERVER_ID:", SERVER_ID, "PID:", process.pid);
    if (isCaching) return;
    if (QUIZ_CACHE.length >= CACHE_SIZE) return;

    isCaching = true;
    console.log(`🔄 캐시 충전 가동 (${QUIZ_CACHE.length}/${CACHE_SIZE})`);

    let randomSearchAttempts = 0;

    while (QUIZ_CACHE.length < 20 && randomSearchAttempts < 20) {
        if (QUIZ_CACHE.length >= CACHE_SIZE) break;
        randomSearchAttempts++;

        try {
            let targetTitles = [];

            // 1) VIP 후보
            const vipTitles = shuffle(LEGACY_VIP_LIST)
                .filter(name => {
                    const isCached = QUIZ_CACHE.some(c => c.name.includes(name) || (c.rawName && c.rawName === name));
                    const isPlayed = LAST_PLAYED.some(lp => lp.includes(name));
                    return !isCached && !isPlayed;
                })
                .slice(0, 10);

            // 2) 신규 인물 후보
            const baseYear = Math.floor(Math.random() * (1970 - 900 + 1)) + 900;
            let candidates = [];

            for (let offset = 0; offset <= 10 && candidates.length === 0; offset++) {
                const years = offset === 0 ? [baseYear] : [baseYear - offset, baseYear + offset];
                for (const year of years) {
                    if (year < 900 || year > 1970) continue;
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
                .sort(() => Math.random() - 0.4)
                .map(c => c.title)
                .slice(0, 8);

            targetTitles = shuffle([...vipTitles, ...newTitles]);

            if (targetTitles.length > 0) {
                for (let i = 0; i < targetTitles.length; i += 4) { 
                    const batch = targetTitles.slice(i, i + 4);
                    let detailRes;

                    try {
                        // 🛠️ [수정] 개별 async 함수 내부 try-catch를 적용하여 1개 실패 시 나머지 성공 항목 유지
                        const results = await Promise.all(
                            batch.map(async (title) => {
                                try {
                                    const res = await axios.get("https://ko.wikipedia.org/w/api.php", {
                                        ...WIKI_AXIOS_CONFIG,
                                        params: {
                                            action: "query",
                                            titles: title,
                                            prop: "extracts|pageimages",
                                            explaintext: 1,
                                            redirects: 1,
                                            pithumbsize: 800,
                                            format: "json",
                                            origin: "*"
                                        }
                                    });
                                    return res.data.query?.pages || {};
                                } catch (e) {
                                    return {};
                                }
                            })
                        );

                        detailRes = {
                            data: {
                                query: {
                                    pages: Object.assign({}, ...results)
                                }
                            }
                        };
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

                        if (!pageData.extract || pageData.extract.length < 20) {
                            console.log("탈락: extract 부족", pageData.title, pageData.extract?.length);
                            continue;
                        }

                        const aliases = makeNameAliases(pageData.title);
                        const pageImageName = (pageData.pageimage || "").toLowerCase();

                        let imageUrl = pageData?.thumbnail?.source || null;

                        if (!imageUrl || (pageImageName && HUMAN_IMAGE_BLOCKLIST.test(pageImageName)) || !isValidImageUrl(imageUrl)) {
                            try {
                                imageUrl = await findAlternativeHumanImage(pageData.title, aliases);
                            } catch (err) {
                                console.warn(`[이미지 탐색 실패] ${pageData.title}:`, err.message);
                                imageUrl = null;
                            }
                        }

                        if (VIP_IMAGE_FALLBACKS[pageData.title]) {
                            imageUrl = VIP_IMAGE_FALLBACKS[pageData.title];
                        }

                        imageUrl = imageUrl || null;

                        if (!isValidImageUrl(imageUrl)) {
                            console.log("최종탈락: isValidImageUrl", pageData.title, imageUrl);
                            continue;
                        }

                        if (isCulturalSiteImage(imageUrl)) {
                            console.log("최종탈락 (문화재 썸네일 감지됨):", pageData.title, imageUrl);
                            continue;
                        }

                        if (LAST_PLAYED.includes(pageData.title)) continue;
                        if (QUIZ_CACHE.some(cached => cached.name === pageData.title)) continue;

                        const fullExtract = pageData.extract || "";

                       if (!fullExtract.trim()) {
                        console.log(`탈락: 본문 데이터 없음 (${pageData.title})`);
                       } else {
                        // 1. 첫 번째 목차(==) 기준으로 서론과 본문 분리
                        const firstHeaderIndex = fullExtract.search(/==+/);
                           let exintro = fullExtract;
                           let extractBody = "";

                           if (firstHeaderIndex !== -1) {
                               exintro = fullExtract.substring(0, firstHeaderIndex).trim();
                               extractBody = fullExtract.substring(firstHeaderIndex).trim();
                           }

    // 2. 불필요한 하단 섹션 및 TMI/타인 정보 섹션 완전 절단
                           const cutIndex = extractBody.search(/(?:^|\n)\s*={2,}\s*(각주|가족|같이 보기|참고 문헌|참고 자료|기타|외부 링크|[가-힣\s]*작품(?:\s*목록)?|[가-힣\s]*저서|주석|여담|갤러리|가계도|계보)\s*={2,}/i);
   
                           if (cutIndex !== -1) {
                               extractBody = extractBody.substring(0, cutIndex);
                           }
  
                           // 3. 서론 및 본문 정제
    
                           // (※ summarizer.js가 볼드/링크 기반으로 중요 문장을 가중 추적하므로 위키 마크업은 유치)
                           const cleanIntro = exintro.replace(/\n{3,}/g, "\n\n").trim();
                           const cleanExtract = extractBody
                               .replace(/^=+.*?=+$/gm, "") // Section 헤더 텍스트만 제거
                               .replace(/\n{3,}/g, "\n\n")
                               .trim();
  
                           // 4. 개작된 summarizer.js 시그니처(introText, bodyText, aliases, maxLength)에 맞춰 연동
                           const finalDescription = buildDescription(
                               cleanIntro, 
                               cleanExtract,
                               aliases || [], 
                               720 // maxLength (최대 글자 수)
                           );
                           if (finalDescription) {
                               QUIZ_CACHE.push({
                                   name: pageData.title,
                                   image: imageUrl,
                                   hint: createMaskedHint(pageData.title, finalDescription),
                                   description: finalDescription 
                               });
                           } else {
                               console.log(`탈락: description 생성 실패 (${pageData.title})`);
                           }
                       }
                    }
                }
                console.log("현재 캐시:", QUIZ_CACHE.length);
                await new Promise(resolve => setTimeout(resolve, 660));
            }
        } catch (e) {
            if (e.response?.status === 429) {
                await new Promise(resolve => setTimeout(resolve, 8000));
            }
        }
    }

    QUIZ_CACHE = shuffle(QUIZ_CACHE);
    console.log("fillCache 종료", SERVER_ID, QUIZ_CACHE.length);
    isCaching = false;

    if (QUIZ_CACHE.length <= 30) {
        setTimeout(fillCache, 3000);
    }
}

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
        console.log("캐시:", QUIZ_CACHE.length);
        const item = QUIZ_CACHE.shift();
        if (!item) {
            return res.status(503).json({ error: "데이터 준비 중입니다. 잠시 후 새로고침 해주세요.", requestId });
        }

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

fillCache();

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

export default app;
