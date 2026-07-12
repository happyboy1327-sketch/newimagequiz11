import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

// 1. 안전하게 데이터베이스 로드
const dbPath = path.join(process.cwd(), "quiz-db.json");
let QUIZ_DATABASE = [];

try {
    if (fs.existsSync(dbPath)) {
        QUIZ_DATABASE = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
        console.log(`[System] 로컬 퀴즈 DB 로드 성공 (총 ${QUIZ_DATABASE.length}명)`);
    } else {
        console.error("[Warning] quiz-db.json 파일이 존재하지 않습니다.");
    }
} catch (err) {
    console.error("DB 로드 에러:", err);
}

let LAST_PLAYED = [];

// 2. 핵심 퀴즈 API 핸들러
app.get("/api/quiz", (req, res) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    if (QUIZ_DATABASE.length === 0) {
        return res.status(503).json({ 
            error: "데이터베이스가 준비되지 않았습니다. 빌드 단계를 확인하세요.", 
            requestId 
        });
    }

    const forbiddenNames = new Set(LAST_PLAYED);
    if (req.query.exclude) {
        String(req.query.exclude).split(',').forEach(n => { 
            if (n.trim() && n.trim() !== "undefined") forbiddenNames.add(n.trim()); 
        });
    }

    let candidates = QUIZ_DATABASE.filter(item => !forbiddenNames.has(item.name));

    if (candidates.length === 0) {
        LAST_PLAYED = LAST_PLAYED.slice(10);
        candidates = QUIZ_DATABASE.filter(item => !LAST_PLAYED.includes(item.name));
    }

    const pick = candidates[Math.floor(Math.random() * candidates.length)] || QUIZ_DATABASE[0];

    if (!pick) {
        return res.status(500).json({ error: "출제할 문제를 선택할 수 없습니다.", requestId });
    }

    LAST_PLAYED.push(pick.name);
    if (LAST_PLAYED.length > 20) LAST_PLAYED.shift();

    return res.json({ ...pick, requestId });
});

// 3. [여기 중요] 로컬/Vercel 상관없이 항상 정적 파일과 메인화면을 Express가 직접 서빙함
app.use(express.static(path.join(process.cwd(), "public")));

app.get("*catchall", (req, res) => {
    res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

// 4. 포트 열고 대기하는 listen 기능만 Vercel 환경에서 제외 (Vercel 자체 에러 방지)
// 3. 로컬 환경에서만 정적 파일 서빙 (Vercel에서는 위의 vercel.json이 처리함)
if (!process.env.VERCEL) {
    app.use(express.static(path.join(process.cwd(), "public")));
    
    app.use((req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(process.cwd(), "public", "index.html"));
    });

    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

export default app;

