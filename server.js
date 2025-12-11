// ===============================
// 1) 이름 alias 자동 생성 (기존 유지 + 강화)
// ===============================
function makeNameAliases(title) {
    const cleanKo = title.replace(/\(.+?\)/g, "").trim();
    const lowerKo = cleanKo.toLowerCase();

    let aliases = [
        lowerKo,
        lowerKo.replace(/\s+/g, "_"),
        lowerKo.replace(/\s+/g, "-")
    ];

    // 유명인 하드코딩 (필요시 추가)
    if (/모차르트/.test(cleanKo)) aliases.push("mozart");
    if (/베토벤/.test(cleanKo)) aliases.push("beethoven");
    if (/피카소/.test(cleanKo)) aliases.push("picasso");
    if (/간디/.test(cleanKo)) aliases.push("gandhi");
    if (/고흐/.test(cleanKo)) aliases.push("gogh");

    return [...new Set(aliases)];
}

// ===============================
// 2) [신규] Open Graph 이미지 추출 (가장 강력한 fallback)
// ===============================
function extractOgImage(html) {
    // <meta property="og:image" content="..."> 추출
    const match = html.match(/<meta\s+property="og:image"\s+content="(.*?)"/i);
    if (match && match[1]) {
        return match[1].replace(/&amp;/g, '&'); // URL 인코딩 보정
    }
    return null;
}

// ===============================
// 3) 이미지 URL 유효성 검사 (SVG 절대 차단)
// ===============================
function isValidImageUrl(url) {
    if (!url || typeof url !== "string") return false;
    // SVG 및 아이콘/심볼 절대 배제
    if (/\.svg/i.test(url)) return false;
    if (/\/svg\//i.test(url)) return false;
    
    // 유효 확장자 확인
    return /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url);
}

// ===============================
// 4) [개선] 사람 사진 후보 필터 (조건 대폭 완화)
// ===============================
function isHumanPhoto(filename, aliases) {
    if (!filename || typeof filename !== "string") return false;
    const n = filename.toLowerCase();

    // 1. 확실하게 아닌 것들 제거 (지도, 깃발, 아이콘, 서명, 무덤, 책 표지)
    if (/\.(svg|gif)$/i.test(n)) return false;
    if (/(map|flag|icon|logo|sign|signature|book|cover|chart|diagram|coat of arms)/i.test(n)) return false;
    if (/(grave|tomb|monument|statue|museum)/i.test(n)) return false; // 동상/무덤도 일단 제외 (사람 얼굴 우선)

    // 2. 긍정 키워드가 있으면 무조건 통과
    if (/(portrait|photo|face|profile|bust)/i.test(n)) return true;

    // 3. 파일명에 이름(alias)이 포함되어 있으면 통과 (완화됨)
    for (const a of aliases) {
        if (!a) continue;
        // 공백을 제거하거나 _로 바꾼 형태도 비교
        const cleanName = a.replace(/[\s\-\_]/g, "");
        const cleanFile = n.replace(/[\s\-\_]/g, "");
        if (cleanFile.includes(cleanName)) return true;
    }

    // 4. 위의 필터를 다 통과했고, jpg/png라면 일단 후보로 인정 (너무 엄격하면 이미지 못 찾음)
    return true;
}

// ===============================
// 5) [핵심 개선] getStableMainImage (우선순위 변경)
// ===============================
async function getStableMainImage(title) {
    const aliases = makeNameAliases(title);
    
    // ---------------------------------------------------------
    // 전략 1: PageImages API (썸네일) - 가장 정확함 (1순위로 변경)
    // ---------------------------------------------------------
    try {
        const thumbRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
            headers: WIKI_HEADERS,
            params: {
                action: "query",
                titles: title,
                prop: "pageimages",
                pithumbsize: 600, // 충분히 큰 사이즈 요청
                format: "json",
                origin: "*"
            }
        });
        
        const page = Object.values(thumbRes.data.query.pages)[0];
        const thumbUrl = page?.thumbnail?.source;

        if (thumbUrl && isValidImageUrl(thumbUrl)) {
            // console.log(`✔ [API] 썸네일 발견: ${title}`);
            return thumbUrl;
        }
    } catch (e) {
        // API 실패시 조용히 넘어감
    }

    // ---------------------------------------------------------
    // 전략 2: HTML 파싱 (Open Graph Image -> Infobox)
    // ---------------------------------------------------------
    try {
        const htmlRes = await axios.get(
            `https://ko.wikipedia.org/wiki/${encodeURIComponent(title)}`,
            { headers: WIKI_HEADERS }
        );
        const html = htmlRes.data;

        // 2-1. og:image (카톡 공유시 뜨는 그 이미지)
        const ogImage = extractOgImage(html);
        if (ogImage && isValidImageUrl(ogImage)) {
            // console.log(`✔ [Meta] OG 이미지 발견: ${title}`);
            return ogImage;
        }

        // 2-2. Infobox 내부 이미지 (기존 로직 유지하되 단순화)
        const infoboxMatch = html.match(/<table[^>]*class="[^"]*infobox[^"]*"[^>]*>[\s\S]*?<\/table>/i);
        if (infoboxMatch) {
            const srcMatch = infoboxMatch[0].match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
            if (srcMatch && srcMatch[1]) {
                let src = srcMatch[1];
                if (src.startsWith("//")) src = "https:" + src;
                
                // SVG가 아니고, 충분히 크다고 판단되면(파일명 등) 사용
                if (isValidImageUrl(src) && !/pixel\.gif|blank\.gif/i.test(src)) {
                     // console.log(`✔ [Infobox] 이미지 발견: ${title}`);
                     return src;
                }
            }
        }
    } catch (e) {
        console.log(`✖ HTML 파싱 실패: ${title}`);
    }

    // ---------------------------------------------------------
    // 전략 3: 전체 이미지 목록 검색 (마지막 수단)
    // ---------------------------------------------------------
    try {
        const imgListRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
            headers: WIKI_HEADERS,
            params: {
                action: "query",
                titles: title,
                prop: "images",
                imlimit: 50, // 너무 많이 가져오면 느림
                format: "json",
                origin: "*"
            }
        });

        const page = Object.values(imgListRes.data.query.pages)[0];
        const imgs = page.images || [];

        // 필터링 (사람 사진일 확률이 높은 것)
        const candidates = imgs.filter(i => isHumanPhoto(i.title, aliases));

        // 후보군 상세 URL 조회
        for (const c of candidates) {
            const infoRes = await axios.get("https://ko.wikipedia.org/w/api.php", {
                headers: WIKI_HEADERS,
                params: {
                    action: "query",
                    titles: c.title,
                    prop: "imageinfo",
                    iiprop: "url",
                    format: "json",
                    origin: "*"
                }
            });
            const info = Object.values(infoRes.data.query.pages)[0];
            const url = info.imageinfo?.[0]?.url;

            if (isValidImageUrl(url)) {
                // console.log(`✔ [List] 리스트 검색 성공: ${title}`);
                return url;
            }
        }
    } catch (e) {
        // console.log(`✖ 리스트 검색 실패: ${title}`);
    }

    console.log(`❌ 최종 이미지 실패: ${title}`);
    return null;
}
