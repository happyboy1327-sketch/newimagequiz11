import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

// 보안 및 캐시 헤더 설정
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

// 📌 핵심: 빌드 타임에 fetch-wiki.js가 생성해둔 quiz-db.json 파일을 로드합니다.
const dbPath = path.join(process.cwd(), "quiz-db.json");
let QUIZ_DATABASE = [];

try {
    if (fs.existsSync(dbPath)) {
        QUIZ_DATABASE = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
        console.log(`[System] 로컬 퀴즈 DB 로드 성공 (총 ${QUIZ_DATABASE.length}명)`);
    } else {
        console.error("[Warning] quiz-db.json 파일이 없습니다. 빌드가 정상적으로 끝났는지 확인하세요.");
    }
} catch (err) {
    console.error("DB 로드 에러:", err);
}

let LAST_PLAYED = [];

// 🎯 [라우터 위치] 유저가 호출하면 0ms만에 배열에서 뽑아 던져줍니다.
app.get("/api/quiz", (req, res) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    if (QUIZ_DATABASE.length === 0) {
        return res.status(503).json({ error: "데이터베이스가 준비되지 않았습니다.", requestId });
    }

    const forbiddenNames = new Set(LAST_PLAYED);
    if (req.query.exclude) {
        String(req.query.exclude).split(',').forEach(n => { if (n.trim()) forbiddenNames.add(n.trim()); });
    }

    let candidates = QUIZ_DATABASE.filter(item => !forbiddenNames.has(item.name));

    // 후보군 고갈 시 롤백 로직
    if (candidates.length === 0) {
        LAST_PLAYED = LAST_PLAYED.slice(10);
        candidates = QUIZ_DATABASE.filter(item => !LAST_PLAYED.includes(item.name));
    }

    const pick = candidates[Math.floor(Math.random() * candidates.length)] || QUIZ_DATABASE[0];

    LAST_PLAYED.push(pick.name);
    if (LAST_PLAYED.length > 20) LAST_PLAYED.shift();

    return res.json({ ...pick, requestId });
});

// public 폴더 내 index.html 서빙
app.use(express.static(path.join(process.cwd(), "public")));
app.get("*", (req, res) => res.sendFile(path.join(process.cwd(), "public", "index.html")));

if (!process.env.VERCEL) {
    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

export default app;
