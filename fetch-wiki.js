// fetch-wiki.js
import fs from "fs";
import path from "path";
import axios from "axios";
import https from "https";

const LEGACY_VIP_LIST = ["세종대왕", "이순신", "안중근", "김구", "유관순", "모차르트", "베토벤", "나폴레옹", "아인슈타인", "셰익스피어"]; 
const TARGET_COUNT = 300; // 확보할 총 문제 은행 개수
const RESULT_POOL = [];

const keepAliveAgent = new https.Agent({ keepAlive: true });
const CONFIG = {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    timeout: 5000,
    httpsAgent: keepAliveAgent
};

function makeNameAliases(title) {
    const cleanKo = title.replace(/\(.+?\)/g, "").trim().toLowerCase();
    return [cleanKo, cleanKo.replace(/\s+/g, "_")];
}

function isValidImageUrl(url) {
    if (!url) return false;
    if (/\.svg/i.test(url) || url.toLowerCase().includes("coat_of_arms") || url.toLowerCase().includes("flag")) return false;
    return /\.(jpg|jpeg|png|webp)/i.test(url);
}

function isHumanPhoto(filename, aliases) {
    if (!filename) return false;
    const n = filename.toLowerCase();
    const BLACKLIST = ["svg", "coat of arms", "flag", "seal", "map", "tomb", "grave", "monument", "비석", "묘", "탑"];
    for (const bad of BLACKLIST) { if (n.includes(bad)) return false; }
    if (/(portrait|photo|face|profile|painting|statue)/i.test(n)) return true;
    for (const a of aliases) { if (n.includes(a)) return true; }
    return true;
}

function createMaskedHint(title, extract) {
    let hintText = extract.substring(0, 350);
    const baseName = title.replace(/\s*\(.*?\)\s*/g, '');
    
    baseName.split(' ').forEach(word => {
        if (word.length >= 2) {
            // 정규식 예약어 특수문자 안전하게 이스케이프 처리 (버그 방지)
            const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            hintText = hintText.replace(new RegExp(escapedWord, 'gi'), "OOO");
        }
    });
    return hintText.substring(0, 140).trim() + "...";
}

async function scrape(yearOrTitle, isVip = false) {
    let params = { action: "query", prop: "extracts|pageimages", explaintext: true, pithumbsize: 400, format: "json", origin: "*" };
    if (isVip) {
        params.titles = yearOrTitle;
    } else {
        params.generator = "categorymembers";
        params.gcmtitle = `분류:${yearOrTitle}년_출생`;
        params.gcmlimit = 15;
        params.gcmtype = "page";
    }

    try {
        const res = await axios.get("https://ko.wikipedia.org/w/api.php", { ...CONFIG, params });
        const pages = Object.values(res.data.query?.pages || {});
        
        for (const page of pages) {
            if (!page.extract || page.extract.length < 120) continue;
            if (!isVip && /\(.*\)|선수|음악|작가|기업|과학/.test(page.title)) continue;

            let rawText = page.extract;
            const cutIndex = rawText.search(/==\s*(각주|같이 보기|참고 문헌|외부 링크)\s*==/i);
            if (cutIndex !== -1) rawText = rawText.substring(0, cutIndex);
            rawText = rawText.substring(0, 1000).replace(/\s+/g, " ").trim();

            const aliases = makeNameAliases(page.title);
            if (page.thumbnail?.source && isValidImageUrl(page.thumbnail.source) && isHumanPhoto(page.pageimage || "", aliases)) {
                if (!RESULT_POOL.some(item => item.name === page.title)) {
                    RESULT_POOL.push({
                        name: page.title,
                        imageUrl: page.thumbnail.source,
                        hint: createMaskedHint(page.title, rawText),
                        description: rawText.length > 500 ? rawText.substring(0, 500) + "..." : rawText
                    });
                }
            }
        }
    } catch (e) { 
        console.error(`⚠️ [Scrape Error] 연도/인물 ${yearOrTitle} 처리 중 에러 발생 (건너뜀)`);
    }
}

async function main() {
    console.log("🚀 [Build Step] 위키백과로부터 퀴즈 데이터베이스 동적 생성 시작...");
    
    // 1. VIP 리스트 먼저 확보
    for (const vip of LEGACY_VIP_LIST) {
        await scrape(vip, true);
    }

    // 2. 무한 루프 방지용 안전벨트 변수 도입
    let attempts = 0;
    const MAX_ATTEMPTS = 150; // 최대 150개 연도까지만 뒤져보고 스톱

    // 목표 개수 채울 때까지 또는 최대 시도 횟수 도달 전까지 타격
    while (RESULT_POOL.length < TARGET_COUNT && attempts < MAX_ATTEMPTS) {
        attempts++;
        const randomYear = Math.floor(Math.random() * (2000 - 1000 + 1)) + 1000;
        console.log(` -> [${attempts}/${MAX_ATTEMPTS}] ${randomYear}년 출생 인물 수집 중... (현재: ${RESULT_POOL.length}/${TARGET_COUNT})`);
        
        await scrape(randomYear, false);
        await new Promise(res => setTimeout(res, 100)); // Rate Limit 방지 텀
    }

    if (attempts >= MAX_ATTEMPTS) {
        console.log(`⚠️ [Warning] 최대 시도 횟수(${MAX_ATTEMPTS})에 도달하여 수집을 조기 종료합니다.`);
    }

    // 3. 결과를 JSON 파일로 저장 (변수 outPath 활용)
    const outPath = path.join(process.cwd(), "quiz-db.json");
    fs.writeFileSync(outPath, JSON.stringify(RESULT_POOL, null, 2), "utf-8");
    console.log(`✅ 데이터베이스 생성 완료! 총 ${RESULT_POOL.length}명 저장됨 -> ${outPath}`);
}

main();
