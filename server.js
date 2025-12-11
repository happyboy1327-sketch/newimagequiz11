// server.js
import express from "express";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

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

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason && reason.stack ? reason.stack : reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err && err.stack ? err.stack : err);
});

// -------------------- 설정 --------------------
const CACHE_SIZE = 20;
const VALIDATION_TRY = 3;
const LEGACY_NAMES = [
  "이순신", "세종대왕", "알베르트 아인슈타인", "에이브러햄 링컨", "마하트마 간디",
  "유관순", "안중근", "김구", "윤동주", "레오나르도 다 빈치", "윤봉길", "아리스토텔레스", "갈릴레오 갈릴레이",
  "미켈란젤로 부오나로티", "빈센트 반 고흐", "파블로 피카소", "아이작 뉴턴", "찰스 다윈",
  "토머스 에디슨", "니콜라 테슬라", "스티브 잡스", "빌 게이츠", "마리 퀴리",
  "루트비히 판 베토벤", "볼프강 아마데우스 모차르트", "윌리엄 셰익스피어", "나폴레옹 보나파르트",
  "칭기즈 칸", "알렉산드로스 3세", "줄리어스 시저", "조지 워싱턴", "넬슨 만델라"
];

const WIKI_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
  "Accept": "application/json"
};

let QUIZ_CACHE = [];
let isCaching = false;
let cachePromise = null;

// -------------------- 유틸/필터 --------------------
function makeNameAliases(title) {
  const cleanKo = title.replace(/\(.+?\)/g, "").trim();
  const lowerKo = cleanKo.toLowerCase();

  let aliases = [
    lowerKo,
    lowerKo.replace(/\s+/g, "-"),
    lowerKo.replace(/\s+/g, "_")
  ];

  if (/모차르트|mozart|아마데우스/i.test(cleanKo)) {
    aliases.push("wolfgang amadeus mozart");
    aliases.push("mozart");
  }
  if (/베토벤/i.test(cleanKo)) {
    aliases.push("ludwig van beethoven");
    aliases.push("beethoven");
  }
  if (/피카소/i.test(cleanKo)) {
    aliases.push("pablo picasso");
    aliases.push("picasso");
  }
  if (/간디/i.test(cleanKo)) {
    aliases.push("mahatma gandhi");
    aliases.push("gandhi");
  }

  return [...new Set(aliases)];
}

// SVG/아이콘/노이즈를 확실히 거르는 infobox 추출
function extractInfoboxImage(html) {
  const infoboxMatch =
    html.match(/<table[^>]*class="[^"]*infobox[^"]*"[^>]*>[\s\S]*?<\/table>/i) ||
    html.match(/<div[^>]*class="[^"]*infobox[^"]*"[^>]*>[\s\S]*?<\/div>/i);
  if (!infoboxMatch) return null;
  const area = infoboxMatch[0];

  // src / data-src / srcset 검사
  const srcRegex = /<img[^>]*(?:src|data-src|data-srcset|srcset)\s*=\s*"(.*?)"/gi;
  let m;
  while ((m = srcRegex.exec(area)) !== null) {
    let src = (m[1] || "").trim();
    if (!src) continue;
    if (!/^https?:\/\//i.test(src)) {
      if (src.startsWith("//")) src = "https:" + src;
      else src = "https:" + src;
    }

    // SVG 계열, /svg/ 경로, format=svg 등 모두 배제
    if (/\.svg(\?.*)?$|\/[^\/]*\.svg\/|\/svg\//i.test(src)) continue;
    if (/(\?|&)format=svg/i.test(src)) continue;

    if (/\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(src)) return src;
  }
  return null;
}

function isValidImageUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (/\.svg(\?.*)?$|\/[^\/]*\.svg\/|\/svg\//i.test(url)) return false;
  return /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url);
}

function isHumanPhoto(filename, aliases) {
  if (!filename || typeof filename !== "string") return false;
  const n = filename.toLowerCase();

  if (/\.svg$/i.test(n)) return false;
  if (/\bsvg\b/i.test(n)) return false;
  if (!/\.(jpg|jpeg|png|webp)$/i.test(n)) return false;

  if (/(memorial|statue|grave|coat|tomb|plaque|museum|emblem|flag|logo|seal|icon|map|sheet|sheet_music|악보|우표|stamp|building|church|cathedral|landscape)/i.test(n)) return false;
  if (/signature/i.test(n)) return false;

  if (/(portrait|photo|face|headshot)/i.test(n)) return true;

  for (const a of aliases) {
    if (!a) continue;
    const clean = a.toLowerCase().replace(/\s+/g, "_");
    if (n.includes(clean) || n.includes(a.toLowerCase())) return true;
  }

  return false;
}

// 파일명에서 인물명 포함 엄격 검사(썸네일 오염 방지)
function matchesPerson(url, aliases) {
  if (!url) return false;
  const lower = url.toLowerCase();
  for (const a of aliases) {
    if (!a) continue;
    const clean = a.toLowerCase().replace(/\s+/g, "_");
    if (lower.includes(clean) || lower.includes(a.toLowerCase())) return true;
  }
  return false;
}

// 단순 사람 제목 판정 (인명 문서인지 여부)
function isHumanTitle(title) {
  if (!title || typeof title !== "string") return false;
  // 기본적으로 공백/한글/영문 이름 형태이면 사람으로 본다
  // 너무 포괄적이면 false positive일 수 있으나 대체로 유효
  return /^[\p{L}\s\.\-\'·]+$/u.test(title) && title.split(" ").length <= 4;
}

// -------------------- Wikidata (P18) --------------------
async function getWikidataQID(title) {
  const url = `https://ko.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageprops&format=json`;
  const r = await axios.get(url, { headers: WIKI_HEADERS });
  const pages = r.data.query?.pages || {};
  const page = pages[Object.keys(pages)[0]] || {};
  return page?.pageprops?.wikibase_item || null;
}

async function getWikidataP18Image(qid) {
  if (!qid) return null;
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const r = await axios.get(url, { headers: WIKI_HEADERS });
  const entity = r.data.entities?.[qid];
  const p18 = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return p18 || null;
}

function buildCommonsUrl(filename) {
  const clean = filename.replace(/ /g, "_");
  const md5 = crypto.createHash("md5").update(clean).digest("hex");
  // Commons 파일 경로 규칙 (MD5 기반)
  return `https://upload.wikimedia.org/wikipedia/commons/${md5[0]}/${md5.slice(0, 2)}/${encodeURIComponent(clean)}`;
}

// -------------------- 이미지 안정성 체크 --------------------
async function checkUrlStability(url) {
  if (!url) return false;
  for (let i = 1; i <= VALIDATION_TRY; i++) {
    try {
      const res = await axios.get(url, {
        headers: WIKI_HEADERS,
        timeout: 3000,
        responseType: "arraybuffer"
      });
      const contentType = res.headers["content-type"] || "";
      if (res.status !== 200 || !contentType.includes("image")) return false;
      // 짧은 지연
      await new Promise(r => setTimeout(r, 80));
    } catch (e) {
      return false;
    }
  }
  return true;
}

// -------------------- 힌트 마스킹 --------------------
function createMaskedHint(title, extract) {
  let hintText = extract || "";
  const cleanTitle = title.trim();
  const parenMatch = cleanTitle.match(/\((.*?)\)/);
  if (parenMatch) {
    const parenContent = parenMatch[1];
    parenContent.split(/[\s\.\,\-]+/).forEach(part => {
      if (part.length > 1) {
        const safePart = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        hintText = hintText.replace(new RegExp(safePart, "gi"), "OOO");
      }
    });
  }
  const baseName = cleanTitle.replace(/\s*\(.*?\)\s*/g, "");
  const nameParts = baseName.split(" ");
  nameParts.forEach(word => {
    if (word.length >= 2) {
      hintText = hintText.replace(new RegExp(word, "gi"), "OOO");
      if (word.length >= 3 && !/\s/.test(word)) {
        for (let i = 0; i <= word.length - 2; i++) {
          const chunk = word.substring(i, i + 2);
          hintText = hintText.replace(new RegExp(chunk, "gi"), "OOO");
        }
      }
    }
  });
  hintText = hintText.replace(/([a-zA-Z\d\.\,\:\-\s'\[\]\/\(\)ˌˈɛɔ]+)/g, (match) => {
    const cleaned = match.trim();
    if (cleaned.length > 1 && /[a-zA-Z]/.test(cleaned)) return "OOO";
    return match;
  });

  return (hintText || "").substring(0, 140) + "...";
}

// -------------------- 핵심: 안정적 이미지 획득 --------------------
async function getStableMainImage(title) {
  const aliases = makeNameAliases(title);

  // 1) P18 (Wikidata) 우선
  try {
    const qid = await getWikidataQID(title);
    if (qid) {
      const p18 = await getWikidataP18Image(qid);
      if (p18) {
        const commonsUrl = buildCommonsUrl(p18);
        if (isValidImageUrl(commonsUrl)) {
          const ok = await checkUrlStability(commonsUrl);
          if (ok) {
            console.log(`★ P18 공식 초상화 사용: ${title}`);
            return commonsUrl;
          }
        }
      }
    }
  } catch (e) {
    console.log("P18 로드 에러:", e.message);
  }

  // 2) HTML infobox 강제 추출
  let infoboxImage = null;
  try {
    const pageHtml = await axios.get(`https://ko.wikipedia.org/wiki/${encodeURIComponent(title)}`, { headers: WIKI_HEADERS });
    infoboxImage = extractInfoboxImage(pageHtml.data);
    if (infoboxImage && isValidImageUrl(infoboxImage)) {
      const ok = await checkUrlStability(infoboxImage);
      if (ok) {
        console.log(`✔ Infobox 이미지 획득: ${title}`);
        return infoboxImage;
      } else {
        infoboxImage = null;
      }
    }
  } catch (e) {
    console.log(`Infobox HTML 추출 실패: ${title}`, e.message);
  }

  // 3) 이미지 리스트 → 사람 사진 후보 필터링
  let bestFace = null;
  let bestThumb = null;
  let pageObj = null;
  try {
    const imgListRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
      headers: WIKI_HEADERS,
      params: {
        action: "query",
        format: "json",
        titles: title,
        prop: "images",
        imlimit: 200,
        origin: "*"
      }
    });

    const pages = imgListRes.data.query?.pages || {};
    pageObj = pages[Object.keys(pages)[0]] || null;
    const images = pageObj?.images || [];

    // 후보는 파일명(title) 기준으로 걸러서 선정
    const faceCandidates = [];
    const thumbCandidates = [];

    for (const img of images) {
      const name = img.title || "";
      const low = name.toLowerCase();

      // 확장자 필터
      if (!/\.(jpg|jpeg|png|webp)$/i.test(low)) continue;

      // 노이즈 키워드 제거
      if (/(memorial|statue|grave|coat|tomb|plaque|museum|emblem|flag|logo|seal|icon|map|sheet|stamp|우표|악보|building|church|landscape)/i.test(low)) continue;

      // 파일명 자체에 인물명 포함 시 우선
      if (matchesPerson(low, aliases)) {
        thumbCandidates.push(name);
      }

      // portrait / painting / face 키워드 힌트
      if (/(portrait|painting|face|headshot)/i.test(low)) {
        faceCandidates.push(name);
      }
    }

    // imageinfo로 실제 URL 확인(최대 몇 개)
    const tryList = [...new Set([...thumbCandidates.slice(0, 5), ...faceCandidates.slice(0, 5)])];

    for (const fname of tryList) {
      try {
        const infoRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
          headers: WIKI_HEADERS,
          params: {
            action: "query",
            format: "json",
            titles: fname,
            prop: "imageinfo",
            iiprop: "url",
            origin: "*"
          }
        });

        const infoPages = infoRes.data.query?.pages || {};
        const infoPage = infoPages[Object.keys(infoPages)[0]] || {};
        const url = infoPage?.imageinfo?.[0]?.url || null;
        if (!url) continue;
        if (!isValidImageUrl(url)) continue;

        // 이름 포함 여부로 확정 우선 (thumbCandidates 쪽)
        if (matchesPerson(url, aliases) && !bestThumb) {
          const ok = await checkUrlStability(url);
          if (ok) bestThumb = url;
        }

        // face candidate
        if (!bestFace && /portrait|painting|face|headshot/i.test(fname)) {
          const ok = await checkUrlStability(url);
          if (ok) bestFace = url;
        }

        // 빠르게 결정되면 중단
        if (bestThumb && bestFace) break;
      } catch (e) {
        continue;
      }
    }
  } catch (e) {
    console.log("이미지 리스트 조회 실패:", e.message);
  }

  // 4) pageimages thumbnail (마지막 수단)
  try {
    const thumbRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
      headers: WIKI_HEADERS,
      params: {
        action: "query",
        format: "json",
        titles: title,
        prop: "pageimages",
        piprop: "thumbnail",
        pithumbsize: 1000,
        origin: "*"
      }
    });
    const thumbPages = thumbRes.data.query?.pages || {};
    const thumbPage = thumbPages[Object.keys(thumbPages)[0]] || {};
    const thumbUrl = thumbPage?.thumbnail?.source || null;
    if (thumbUrl && isValidImageUrl(thumbUrl)) {
      const ok = await checkUrlStability(thumbUrl);
      if (ok && (!bestThumb)) {
        bestThumb = thumbUrl;
      }
    }
  } catch (e) {
    console.log("Thumbnail 조회 실패:", e.message);
  }

  // 최종 우선순위: infobox(이미 시도했으므로) → bestFace → bestThumb → null
  if (infoboxImage) return infoboxImage;
  if (bestFace) return bestFace;
  if (bestThumb) return bestThumb;

  return null;
}

// -------------------- 데이터 채굴 로직 (원래 구조 유지) --------------------
function shuffleArray(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fillCache() {
  if (isCaching || QUIZ_CACHE.length >= CACHE_SIZE) return;
  isCaching = true;

  cachePromise = new Promise(async (resolve) => {
    console.log("⛏️ 데이터 채굴 시작...");
    try {
      // 1) LEGACY 유명인 우선 시도
      if (QUIZ_CACHE.length < CACHE_SIZE) {
        const famousCandidates = shuffleArray([...LEGACY_NAMES]).slice(0, 5);
        for (const pickName of famousCandidates) {
          if (QUIZ_CACHE.length >= CACHE_SIZE) break;
          try {
            const detailRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
              headers: WIKI_HEADERS,
              params: {
                action: "query",
                titles: pickName,
                prop: "extracts",
                exintro: true,
                explaintext: true,
                format: "json",
                origin: "*"
              }
            });
            const pages = detailRes.data.query?.pages || {};
            const pageData = pages[Object.keys(pages)[0]] || {};
            if (!pageData?.extract || pageData.extract.length < 30) continue;

            const imgUrl = await getStableMainImage(pageData.title);
            if (!imgUrl) {
              console.log(`❌ [유명인] ${pickName} 이미지 없음/불안정 → 패스`);
              continue;
            }
            const isStable = await checkUrlStability(imgUrl);
            if (!isStable) {
              console.log(`❌ [유명인] ${pickName} 이미지 연결 불안정 → 패스`);
              continue;
            }

            console.log(`✅ [유명인] ${pickName} 통과.`);
            const maskedHint = createMaskedHint(pageData.title, pageData.extract);
            QUIZ_CACHE.push({
              name: pageData.title,
              image: imgUrl,
              hint: maskedHint,
              description: pageData.extract
            });
          } catch (e) {
            continue;
          }
        }
      }

      // 2) 랜덤 연도 탐색
      let randomSearchAttempts = 0;
      while (QUIZ_CACHE.length < CACHE_SIZE && randomSearchAttempts < 3) {
        const year = Math.floor(Math.random() * (1940 - 500 + 1)) + 500;
        try {
          const listRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
            headers: WIKI_HEADERS,
            params: {
              action: "query",
              list: "categorymembers",
              cmtitle: `분류:${year}년_출생`,
              cmlimit: 50,
              cmtype: "page",
              format: "json",
              origin: "*"
            }
          });
          const candidates = listRes.data.query?.categorymembers || [];
          for (const cand of candidates.slice(0, 10)) {
            if (QUIZ_CACHE.length >= CACHE_SIZE) break;
            if (/\(.*\)|선수|음악|작가|기업|수학|과학|독립운동|미술|의사|간호사|영화/.test(cand.title)) continue;

            try {
              const detailRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                headers: WIKI_HEADERS,
                params: {
                  action: "query",
                  titles: cand.title,
                  prop: "extracts",
                  exintro: true,
                  explaintext: true,
                  format: "json",
                  origin: "*"
                }
              });
              const pages = detailRes.data.query?.pages || {};
              const pageData = pages[Object.keys(pages)[0]] || {};
              if (!pageData || !pageData.extract || pageData.extract.length < 300) continue;

              const imgUrl = await getStableMainImage(pageData.title);
              if (!imgUrl) {
                console.log(`❌ [랜덤] ${pageData.title} 이미지 없음 → 패스`);
                continue;
              }
              const isStable = await checkUrlStability(imgUrl);
              if (!isStable) {
                console.log(`❌ [랜덤] ${pageData.title} 이미지 연결 불안정 → 패스`);
                continue;
              }

              console.log(`✅ [랜덤] ${pageData.title} 통과.`);
              const maskedHint = createMaskedHint(pageData.title, pageData.extract);
              QUIZ_CACHE.push({
                name: pageData.title,
                image: imgUrl,
                hint: maskedHint,
                description: pageData.extract
              });
            } catch (e) {
              continue;
            }
          }
        } catch (e) {
          // 무시하고 다음 시도
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

// -------------------- API --------------------
app.get("/api/quiz", async (req, res) => {
  try {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    console.log(`[Request] ${requestId}`);

    if (isCaching && cachePromise) await cachePromise;
    if (QUIZ_CACHE.length === 0) {
      await fillCache();
      if (cachePromise) await cachePromise;
    }

    const item = QUIZ_CACHE.shift();
    if (!item) {
      fillCache();
      return res.status(503).json({ error: "데이터 준비 중입니다.", requestId });
    }

    if (QUIZ_CACHE.length < CACHE_SIZE / 2) fillCache();

    res.json({
      ...item,
      imageUrl: item.image,
      requestId
    });
  } catch (err) {
    console.error("API 퀴즈 처리 중 오류:", err.message);
    const errorId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    res.status(500).json({ error: "서버 내부 오류로 퀴즈를 불러올 수 없습니다.", errorId });
  }
});

// 정적 파일
app.use(express.static(path.join(process.cwd(), "public")));
app.get("/", (req, res) => res.sendFile(path.join(process.cwd(), "public", "index.html")));

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
