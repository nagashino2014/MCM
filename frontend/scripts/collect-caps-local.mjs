// 캡스 근태 이벤트 로그 로컬 수집 에이전트 — 캡스 근태 매니저가 매시(기본 28분)
// C:\Caps\ACServer\UniWorkProService\export 에 저장하는 인원별 태그 txt 를 읽어
// staging 내부 API(/api/internal/adt-events-ingest)로 반입한다. 서버가 파싱·집계·산정까지
// 멱등 처리하므로 같은 파일을 다시 보내도 안전하다(변경 없는 파일은 로컬 상태로 스킵).
// 실행: cd frontend && node scripts/collect-caps-local.mjs   (Windows 작업 스케줄러 등록은
//       scripts/collect-caps-task.ps1 참고 — 매시 실행 분(minute)은 등록 시 옵션으로 지정).
// env: CAPS_EXPORT_DIR(기본 C:\Caps\ACServer\UniWorkProService\export)
//      · MCM_BASE_URL(기본 https://koensain.app) · MCM_CRON_KEY(기본 .env.local 의 AUTH_SECRET)
//      · CAPS_DAYS(수정시각 기준 최근 N일 파일만 스캔, 기본 3)
// 라인 파싱은 서버(lib/adt/events.ts) 몫 — 여기서는 인코딩(CP949→UTF-8)만 정규화해 원문 전송.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const frontendDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  ".."
);
const stateFile = path.join(frontendDir, "..", ".local-logs", "collect-caps-state.json");

function loadCronKey() {
  if (process.env.MCM_CRON_KEY) return process.env.MCM_CRON_KEY;
  if (fs.existsSync(path.join(frontendDir, ".env.local"))) {
    const { loadEnvConfig } = require("@next/env");
    loadEnvConfig(frontendDir);
  }
  return process.env.AUTH_SECRET ?? "";
}

// 캡스 export 는 한글 이름 때문에 CP949 일 가능성이 높다 — UTF-8 로 읽어보고
// 대체문자(U+FFFD)가 나오면 euc-kr 로 다시 디코딩한다.
function decodeText(buf) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (!utf8.includes("\uFFFD")) return utf8;
  return new TextDecoder("euc-kr").decode(buf);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

async function main() {
  const dir = process.env.CAPS_EXPORT_DIR ?? "C:\\Caps\\ACServer\\UniWorkProService\\export";
  const baseUrl = (process.env.MCM_BASE_URL ?? "https://koensain.app").replace(/\/$/, "");
  const days = Number(process.env.CAPS_DAYS) > 0 ? Number(process.env.CAPS_DAYS) : 3;
  const cronKey = loadCronKey();
  if (!cronKey) {
    console.error("[collect-caps] MCM_CRON_KEY(또는 frontend/.env.local 의 AUTH_SECRET)가 필요합니다.");
    process.exit(1);
  }
  if (!fs.existsSync(dir)) {
    console.error(`[collect-caps] export 폴더가 없습니다: ${dir}`);
    process.exit(1);
  }

  const state = loadState();
  const cutoff = Date.now() - days * 86_400_000;
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/\.txt$/i.test(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (!st.isFile() || st.mtimeMs < cutoff) continue;
    const prev = state[name];
    if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue; // 변경 없음
    const content = decodeText(fs.readFileSync(full));
    if (!content.trim()) continue;
    files.push({ name, content, size: st.size, mtimeMs: st.mtimeMs });
  }
  if (!files.length) {
    console.log("[collect-caps] 새로 보낼 파일 없음");
    return;
  }
  console.log(`[collect-caps] 전송 대상 ${files.length}개:`, files.map((f) => f.name).join(", "));

  const res = await fetch(`${baseUrl}/api/internal/adt-events-ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-key": cronKey },
    body: JSON.stringify({ files: files.map((f) => ({ name: f.name, content: f.content })) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[collect-caps] 반입 실패 HTTP ${res.status}:`, JSON.stringify(data));
    process.exit(1);
  }
  for (const f of files) state[f.name] = { size: f.size, mtimeMs: f.mtimeMs };
  saveState(state);
  console.log("[collect-caps] 반입 완료:", JSON.stringify(data));
}

main().catch((err) => {
  console.error("[collect-caps] error", err);
  process.exit(1);
});
