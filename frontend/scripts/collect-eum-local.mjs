// 토지이음(eum.go.kr) 로컬 수집 에이전트 — eum 이 AWS IP 대역을 차단해 서버(ECS) 수집이
// 불가하므로, 국내 ISP 의 로컬 PC 에서 목록을 긁어 staging 내부 API 로 반입한다.
// 실행: cd frontend && node scripts/collect-eum-local.mjs   (Windows 작업 스케줄러 등록은
//       scripts/collect-eum-task.ps1 참고). 외부 의존성 없음(Node 22 내장 fetch/TextDecoder).
// env: MCM_BASE_URL(기본 https://koensain.app) · MCM_CRON_KEY(기본 .env.local 의 AUTH_SECRET)
//      · EUM_PAGES(키워드당 페이지 수, 기본 2)
// 파싱 로직은 lib/intel/gosi-client.ts(fetchEumGosiList)와 동일 — 변경 시 함께 수정할 것.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const EUM_LIST = "https://www.eum.go.kr/web/gs/gv/gvGosiList.jsp";
const EUM_DET = "https://www.eum.go.kr/web/gs/gv/gvGosiDet.jsp?seq=";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

// 검색 키워드 → EUC-KR 퍼센트 인코딩(gosi-client.ts 실측 검증값)
const EUM_KEYWORDS = {
  산업단지: "%BB%EA%BE%F7%B4%DC%C1%F6",
  농공단지: "%B3%F3%B0%F8%B4%DC%C1%F6",
};

const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();

async function fetchEumPage(keywordBytes, page) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(EUM_LIST, {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
      body: `pageNo=${page}&zonenm=${keywordBytes}`,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`토지이음 응답 오류: ${res.status}`);
    const html = new TextDecoder("euc-kr").decode(Buffer.from(await res.arrayBuffer()));
    const items = [];
    for (const tr of html.split(/<tr class="center">/).slice(1)) {
      const link = tr.match(/gvGosiDet\.jsp\?seq=(\d+)[^']*'\s+title='([^']*)'/);
      if (!link) continue;
      const date = tr.match(/<td class="mb">\s*([\d-]{10})/);
      const titles = [...tr.matchAll(/title="([^"]*)"/g)].map((m) => clean(m[1]));
      const agency = titles.length ? titles[titles.length - 1] : null;
      const region = agency ? agency.split(" ")[0] : null;
      items.push({
        channel: "eum",
        externalId: `eum:${link[1]}`,
        title: clean(link[2]),
        url: `${EUM_DET}${link[1]}`,
        agency: agency || null,
        region: region || null,
        publishedAt: date ? date[1] : null,
      });
    }
    return items;
  } finally {
    clearTimeout(timer);
  }
}

function loadCronKey() {
  if (process.env.MCM_CRON_KEY) return process.env.MCM_CRON_KEY;
  // frontend/.env.local 의 AUTH_SECRET(스테이징과 동일 값) — @next/env 로 정확 파싱
  const frontendDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
  if (fs.existsSync(path.join(frontendDir, ".env.local"))) {
    const { loadEnvConfig } = require("@next/env");
    loadEnvConfig(frontendDir);
  }
  return process.env.AUTH_SECRET ?? "";
}

async function main() {
  const baseUrl = (process.env.MCM_BASE_URL ?? "https://koensain.app").replace(/\/$/, "");
  const pages = Number(process.env.EUM_PAGES) > 0 ? Number(process.env.EUM_PAGES) : 2;
  const cronKey = loadCronKey();
  if (!cronKey) {
    console.error("[collect-eum] MCM_CRON_KEY(또는 frontend/.env.local 의 AUTH_SECRET)가 필요합니다.");
    process.exit(1);
  }

  const items = [];
  for (const [keyword, bytes] of Object.entries(EUM_KEYWORDS)) {
    for (let page = 1; page <= pages; page++) {
      try {
        const got = await fetchEumPage(bytes, page);
        console.log(`[collect-eum] ${keyword} p${page}: ${got.length}건`);
        if (!got.length) break;
        items.push(...got);
      } catch (err) {
        console.error(`[collect-eum] ${keyword} p${page} 실패:`, err.message ?? err);
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (!items.length) {
    console.error("[collect-eum] 수집 0건 — 사이트 개편 또는 네트워크 문제를 확인하세요.");
    process.exit(1);
  }

  const res = await fetch(`${baseUrl}/api/internal/gosi-eum-ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-key": cronKey },
    body: JSON.stringify({ items }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[collect-eum] 반입 실패 HTTP ${res.status}:`, JSON.stringify(data));
    process.exit(1);
  }
  console.log("[collect-eum] 반입 완료:", JSON.stringify(data));
}

main().catch((err) => {
  console.error("[collect-eum] error", err);
  process.exit(1);
});
