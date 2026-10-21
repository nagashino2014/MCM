// 매뉴얼 화면 캡처 — 로그인된 프로필로 스테이징 화면을 열고 개인정보를 흐리게 한 뒤 찍는다(작성 가이드 §4.1).
// 사용: node docs/manual-shots/capture.mjs <profileDir> <outDir> [shotId...]
//   의존성(playwright·sharp)이 이 체크아웃에 없으면 MCM_DEPS_ROOT=<node_modules 가 있는 체크아웃>/ 로 지정한다.
//
// 흐림 기준: 화면 글자 중 **소스 코드에 문구로 적힌 것(메뉴·버튼·제목·표 머리글)** 만 남기고 나머지(= DB 데이터)는 모두 흐린다.
//   React 는 문구와 {값} 을 서로 다른 텍스트 노드로 그리므로 "사업장 (", "2035", "건)" 처럼 갈라져 대조된다.
//   이름·금액·전화·메일·사업자번호 패턴과 직원 이름은 문구 목록에 있어도 흐린다.
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const DEPS = process.env.MCM_DEPS_ROOT ?? REPO;
const { chromium } = createRequire(join(DEPS, "scraper/package.json"))("playwright");
const sharp = createRequire(join(DEPS, "frontend/package.json"))("sharp");

const [profile, outDir, ...only] = process.argv.slice(2);
const BASE = process.env.MCM_BASE_URL ?? "https://koensain.app";

const SHOTS = [
  { id: "topbar", url: "/home", clip: { x: 0, y: 0, width: 1440, height: 72 } },
  { id: "home", url: "/home" },
  // 매뉴얼 창 안 설명은 데이터가 아니므로 남긴다(keepWithin) — 이름·금액 패턴은 그래도 흐린다
  { id: "manual-drawer", url: "/home", keepWithin: "[role=dialog]", action: async (p) => { await p.getByRole("button", { name: /매뉴얼/ }).first().click(); await p.waitForTimeout(1200); } },
  { id: "mail-list", url: "/mail" },
  { id: "mail-compose", url: "/mail/compose" },
  { id: "approval-home", url: "/approval" },
  // 기안 작성은 양식이 정해져야 열리므로 홈의 [새 기안] → 양식 고르기 창을 찍는다
  { id: "approval-draft", url: "/approval", keepWithin: "[role=dialog]", action: async (p) => { await p.getByRole("button", { name: "새 기안" }).first().click(); await p.waitForTimeout(1500); } },
  { id: "todo", url: "/todo" },
  { id: "calendar", url: "/calendar" },
  { id: "my-hr", url: "/approval/my-hr" },
  { id: "directory", url: "/directory" },
  { id: "board", url: "/board" },
  { id: "files-personal", url: "/files/personal" },
  { id: "facilities", url: "/facilities" },
  { id: "contracts", url: "/contracts" },
  { id: "finance-invoice", url: "/finance?tab=invoice" },
  { id: "work-plan", url: "/work-plan" },
];

/** 소스의 화면 문구 — JSX 텍스트·문자열 리터럴·템플릿 조각(공백 정리). */
function uiStrings() {
  const out = new Set();
  const add = (t) => {
    const v = t.replace(/\s+/g, " ").trim();
    if (v && v.length <= 80 && /[가-힣A-Za-z]/.test(v)) out.add(v);
  };
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".next")) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|mjs)$/.test(name)) {
        const src = readFileSync(full, "utf8");
        for (const m of src.matchAll(/>([^<>{}]+)</g)) add(m[1]);
        for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)) add(m[1] ?? m[2] ?? "");
        for (const m of src.matchAll(/`([^`]*)`/g)) for (const part of m[1].split(/\$\{[^}]*\}/)) add(part);
        // JSX 텍스트가 {값}과 섞인 줄: "사업장 ({total}건)" → "사업장 (", "건)"
        for (const m of src.matchAll(/>([^<>]*\{[^<>]*)</g)) for (const part of m[1].split(/\{[^}]*\}/)) add(part);
      }
    }
  };
  for (const d of ["app", "components", "config", "content", "lib"]) walk(join(REPO, "frontend", d));
  return [...out];
}

// 페이지 안에서 실행 — 개인정보 흐림
const MASK = async ({ ui, keepWithin }) => {
  const UI = new Set(ui);
  const css = document.createElement("style");
  // class 대신 data 속성 — React 가 다시 그리며 className 을 덮어써도 흐림이 풀리지 않게
  // 직원 사진은 목록이 다시 그려지며 새 img 로 바뀌므로 주소 기준 규칙으로도 흐린다(/api/admin/employees/<id>/photo 등)
  css.textContent =
    "[data-mcm-mask]{filter:blur(5px)!important}" +
    "main img[src*='/api/'],header img[src*='/api/'],[role=dialog] img[src*='/api/'],img[src*='photo'],img[src*='avatar']{filter:blur(10px)!important}";
  document.head.appendChild(css);
  let names = [];
  try {
    const d = await fetch("/api/directory").then((r) => r.json());
    const list = Array.isArray(d) ? d : d.employees ?? d.items ?? d.people ?? [];
    names = list.map((e) => String(e.name ?? "")).filter((n) => n.length >= 2);
  } catch {}
  try {
    const me = await fetch("/api/auth/session").then((r) => r.json());
    if (me?.user?.name) names.push(String(me.user.name));
  } catch {}
  const esc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameRe = names.length ? new RegExp(names.map(esc).join("|")) : null;
  const SENSITIVE = /\d{1,3}(,\d{3})+|\d+\s*원|0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}|[\w.+-]+@[\w-]+\.[\w.]+|\d{3}-\d{2}-\d{5}|\d{6}-\d{7}/;
  const isUi = (text) => {
    const v = text.replace(/\s+/g, " ").trim();
    if (UI.has(v)) return true;
    // 숫자만(건수·쪽 번호·날짜 조각) — 금액(쉼표)은 위 SENSITIVE 가 먼저 잡는다
    if (/^[\d.:/\-~()%+· ]{1,12}$/.test(v)) return true;
    return false;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const hit = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode;
    const text = (t.nodeValue ?? "").trim();
    if (!text) continue;
    const el = t.parentElement;
    if (!el || el.closest("style,script,noscript")) continue;
    const sensitive = SENSITIVE.test(text) || (nameRe && nameRe.test(text));
    // 이름 머리글자 아바타("이")
    const initial = /^[가-힣]{1,2}$/.test(text) && names.some((n) => n.startsWith(text));
    const kept = keepWithin && el.closest(keepWithin);
    if (sensitive || initial || (!kept && !isUi(text))) hit.add(el);
  }
  const mask = (el) => el.setAttribute("data-mcm-mask", "");
  hit.forEach(mask);
  document.querySelectorAll("input, textarea, select, [contenteditable=true]").forEach((i) => {
    const v = (i.value ?? i.textContent ?? "").trim();
    if (v && !isUi(v)) mask(i);
  });
  // 프로필 사진 — 아바타 크기(정사각형에 가까운 120px 이하) 그림은 로고(왼쪽 메뉴) 말고 모두 흐린다. 배경 그림 아바타도 같다.
  document.querySelectorAll("img, [style*='background-image']").forEach((i) => {
    if (i.closest("aside")) return;
    const r = i.getBoundingClientRect();
    if (r.width >= 16 && r.width <= 120 && Math.abs(r.width - r.height) <= 6) mask(i);
  });
  return { names: names.length, masked: hit.size };
};

const ui = uiStrings();
const ctx = await chromium.launchPersistentContext(profile, {
  headless: true,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  locale: "ko-KR",
});
// 왼쪽 메뉴를 펼친 상태로(캡처 전용 프로필에만 저장)
await ctx.addInitScript(() => {
  try { localStorage.setItem("nav-auto-collapse", "0"); } catch {}
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const report = [`ui strings=${ui.length}`];
for (const shot of SHOTS) {
  if (only.length && !only.includes(shot.id)) continue;
  try {
    await page.goto(BASE + shot.url, { waitUntil: "load", timeout: 60000 });
    if (page.url().includes("/login")) throw new Error("로그인 필요");
    await page.waitForTimeout(3500);
    if (shot.action) await shot.action(page);
    const r = await page.evaluate(MASK, { ui, keepWithin: shot.keepWithin ?? null });
    await page.waitForTimeout(400);
    const png = await page.screenshot({ clip: shot.clip, animations: "disabled" });
    const webp = await sharp(png).webp({ quality: 78 }).toBuffer();
    writeFileSync(join(outDir, `${shot.id}.webp`), webp);
    writeFileSync(join(outDir, `${shot.id}.png`), png);
    report.push(`${shot.id}: ok names=${r.names} masked=${r.masked} webp=${Math.round(webp.length / 1024)}KB url=${page.url()}`);
  } catch (e) {
    report.push(`${shot.id}: FAIL ${e.message}`);
  }
}
console.log(report.join("\n"));
await ctx.close();
