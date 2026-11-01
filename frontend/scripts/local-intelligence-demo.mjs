// localhost 전용 개발 도구. 운영 Next 앱의 인증·라우트·DB 설정은 변경하지 않는다.
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import postcss from "postcss";
import tailwind from "tailwindcss";
import { loadLocalIntelligenceEnvironment, localIntelligenceMode } from "./local-intelligence-environment.mjs";

const root = process.cwd();
const output = resolve(root, ".next/local-intelligence-demo");
const port = 4174;
const origin = `http://127.0.0.1:${port}`;
const mode = localIntelligenceMode();
const live = mode === "real" ? await loadLocalIntelligenceEnvironment() : null;
const database = live ? "intel_live" : "intel_demo";
// 실제 모드에는 사용자가 요청한 읽기 전용 원본 DB·AI 연결만 제공한다.
for (const key of Object.keys(process.env)) if (/^(AWS_|ANTHROPIC_|OPENAI_|VOYAGE_|MCM_STORAGE_|MCM_DB_|SES_|BID_NOTIFY_|EXPO_)/.test(key)) delete process.env[key];
Object.assign(process.env, { DATABASE_URL: `postgresql://mcm_intel_test@127.0.0.1:55439/${database}`, PGSSL: "disable", NODE_ENV: "test", AUTH_SECRET: live?.authSecret || "local-intelligence-demo-only-not-for-production", AUTH_URL: origin, INTEL_BRIEFING_ENABLED: "false", AWS_EC2_METADATA_DISABLED: "true", MCM_LOCAL_INTELLIGENCE_MODE: mode });
if (live) Object.assign(process.env, { ANTHROPIC_API_KEY: live.apiKey, MCM_INTEL_SOURCE_DATABASE_URL: live.sourceDatabaseUrl, MCM_INTEL_SOURCE_SSL: live.sourceSsl });
const networkFetch = globalThis.fetch;
// 공개 수집 자료의 실제 AI 실증에 한해 명시적으로 켜는 로컬 진단. 요청·인증 헤더는 저장하지 않는다.
const capturePublicAi = Boolean(live) && process.env.MCM_INTEL_CAPTURE_PUBLIC_AI === "1";
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!live || url.protocol !== "https:" || url.hostname !== "api.anthropic.com" || url.port) throw new Error("이 로컬 실증에서 허용하지 않은 외부 API입니다.");
  const response = await networkFetch(input, { ...options, redirect: "error" });
  if (capturePublicAi && response.ok) {
    const data = await response.clone().json();
    const text = (data.content ?? []).filter(block => block.type === "text").map(block => String(block.text ?? "")).join("");
    const directory = resolve(output, "source-quality/ai-responses");
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, `${Date.now()}-${String(data.id ?? "response").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 90)}.json`), JSON.stringify({ model: data.model, stopReason: data.stop_reason, text }, null, 2));
  }
  return response;
};
await mkdir(output, { recursive: true });
await build({ stdin: { contents: 'export { initializeLocalIntelligenceDemo } from "./scripts/local-intelligence-demo-data"; export { initializeLocalIntelligenceLive, importLocalIntelligenceSource } from "./scripts/local-intelligence-live-data"; export { initializeLocalIntelligenceSharing } from "./scripts/local-intelligence-sharing-data"; export { handleLocalIntelligenceApi, tickLocalIntelligenceDemo } from "./scripts/local-intelligence-demo-api";', resolveDir: root, sourcefile: "local-demo-entry.ts" }, outfile: resolve(output, "backend.cjs"), bundle: true, platform: "node", format: "cjs", packages: "external", tsconfig: "tsconfig.json" });
await build({ entryPoints: ["scripts/local-intelligence-demo-ui.tsx"], outfile: resolve(output, "app.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", tsconfig: "tsconfig.json", define: { "process.env.NODE_ENV": '"test"' }, loader: { ".woff2": "empty", ".png": "empty" }, plugins: [{ name: "localhost-test-identity", setup(builder) {
  builder.onResolve({ filter: /^(next\/navigation|next\/link|next-auth\/react)$/ }, () => ({ path: resolve(root, "tests/intelligence-ui/browser-shims.tsx") }));
  builder.onResolve({ filter: /^\/fonts\// }, (args) => ({ path: args.path, external: true }));
} }] });
const css = await postcss([tailwind({ content: ["./components/**/*.{ts,tsx}", "./scripts/local-intelligence-demo-ui.tsx"], theme: { extend: { borderRadius: { lg: "var(--radius)" } } } })]).process(await readFile(resolve(output, "app.css"), "utf8"), { from: resolve(output, "app.css") });
await writeFile(resolve(output, "app.css"), css.css);
const backend = createRequire(import.meta.url)(resolve(output, "backend.cjs"));
let importing = null;
function refreshSource() {
  if (!live) throw new Error("실제 자료 모드에서만 원본 수집 DB를 읽을 수 있습니다.");
  if (!importing) importing = backend.importLocalIntelligenceSource({ days: 180, limit: 2000 }).finally(() => { importing = null; });
  return importing;
}
if (live) {
  await backend.initializeLocalIntelligenceLive();
  if (process.env.MCM_INTEL_USE_STORED_DATA !== "1") await refreshSource();
  else {
    const existing = await backend.handleLocalIntelligenceApi({ url: new URL("/api/local-demo/meta", origin), method: "GET", body: null });
    if (!existing.body?.import?.importedAt || !existing.body?.counts?.signals) throw new Error("보존된 실제 수집 자료가 없어 먼저 원본 DB를 연결해야 합니다.");
  }
} else await backend.initializeLocalIntelligenceDemo();
await backend.initializeLocalIntelligenceSharing();
for (const path of ["/api/sales/rag/profiles", "/api/sales/intel/projects", "/api/sales/intel/candidates", "/api/sales/intel/official-sources"]) {
  const probe = await backend.handleLocalIntelligenceApi({ url: new URL(path, origin), method: "GET", body: null });
  if ((probe.status ?? 200) >= 400) throw new Error(`로컬 초기 조회 실패 (${path}): ${probe.body?.error ?? probe.status}`);
}
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  try {
    if (request.headers.host !== `127.0.0.1:${port}`) { response.writeHead(403); response.end("Local host only"); return; }
    const url = new URL(request.url, origin);
    if (url.pathname === "/api/local-demo/health" && request.method === "GET") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ localIntelligenceDemo: true, mode, database, externalServices: !!live, importing: !!importing })); return; }
    if (url.pathname.startsWith("/api/")) {
      if (!["GET", "HEAD"].includes(request.method) && (request.headers.origin !== origin || !request.headers["content-type"]?.startsWith("application/json"))) { response.writeHead(403); response.end(JSON.stringify({ error: "이 로컬 실증 화면에서 실행해 주세요." })); return; }
      const chunks = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 1024 * 1024) throw Object.assign(new Error("요청이 너무 큽니다."), { status: 413 }); chunks.push(chunk); }
      const raw = Buffer.concat(chunks).toString(); let body = null;
      if (raw) { try { body = JSON.parse(raw); } catch { throw Object.assign(new Error("JSON 요청을 확인하세요."), { status: 400 }); } }
      const result = url.pathname === "/api/local-demo/refresh-data" && request.method === "POST" ? { body: await refreshSource() } : await backend.handleLocalIntelligenceApi({ url, method: request.method, body });
      response.statusCode = result.status ?? 200;
      response.setHeader("content-type", "application/json; charset=utf-8");
      for (const [key, value] of Object.entries(result.headers ?? {})) response.setHeader(key, value);
      response.end(result.body instanceof Uint8Array ? result.body : JSON.stringify(result.body)); return;
    }
    if (url.pathname === "/app.js" || url.pathname === "/app.css") { response.setHeader("content-type", url.pathname.endsWith("css") ? "text/css" : "text/javascript"); response.end(await readFile(resolve(output, url.pathname.slice(1)))); return; }
    if (url.pathname === "/fonts/PretendardVariable.woff2") { response.setHeader("content-type", "font/woff2"); response.end(await readFile(resolve(root, "public/fonts/PretendardVariable.woff2"))); return; }
    if (url.pathname === "/" || /^\/sales\/[\w-]+$/.test(url.pathname) || /^\/m-app\/chat\/\d+$/.test(url.pathname)) { response.setHeader("content-type", "text/html; charset=utf-8"); response.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCM 영업 발굴 · 로컬 실증</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'); return; }
    response.writeHead(404); response.end("로컬 실증에 포함되지 않은 화면입니다.");
  } catch (error) { response.statusCode = error.status >= 400 && error.status < 600 ? error.status : 500; response.setHeader("content-type", "application/json; charset=utf-8"); response.end(JSON.stringify({ error: error.message ?? "로컬 처리 오류" })); console.error("[local-demo]", error.message); }
});
await new Promise((done, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", done); });
const timer = setInterval(() => backend.tickLocalIntelligenceDemo().catch((error) => console.error("[local-demo tick]", error.message)), 30000);
console.log(`READY ${origin}/sales/rag?tab=scheduled`);
console.log(live ? "실제 수집 자료 / 읽기 전용 원본 연결 / 실제 AI 브리핑 / 결과는 로컬 DB 저장" : "가상 자료 / 실제 로컬 DB 저장 / 예시 보고서 / 외부 서비스 연결 없음");
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { clearInterval(timer); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
