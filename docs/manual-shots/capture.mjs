// 매뉴얼 화면 캡처 — 로그인된 프로필로 스테이징 화면을 열고 개인정보를 흐리게 한 뒤 찍는다.
// 사용: node capture.mjs <profileDir> <outDir> [shotId...]
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(new URL("../../scraper/package.json", import.meta.url));
const { chromium } = require("playwright");
const sharp = createRequire(new URL("../../frontend/package.json", import.meta.url))("sharp");

const [profile, outDir, ...only] = process.argv.slice(2);
const BASE = "https://koensain.app";

const SHOTS = [
  { id: "topbar", url: "/home", clip: { x: 0, y: 0, width: 1440, height: 72 } },
  { id: "home", url: "/home" },
  { id: "manual-drawer", url: "/home", action: async (p) => { await p.getByRole("button", { name: /매뉴얼/ }).first().click(); await p.waitForTimeout(1200); } },
  { id: "mail-list", url: "/mail" },
  { id: "mail-compose", url: "/mail/compose" },
  { id: "approval-home", url: "/approval" },
  { id: "approval-draft", url: "/approval/draft" },
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

// 페이지 안에서 실행 — 개인정보 흐림
const MASK = async (extraKeep) => {
  const css = document.createElement("style");
  css.textContent = ".mcm-mask{filter:blur(5px)!important}";
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
  const nameRe = names.length ? new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\]/g, "\$&")).join("|")) : null;
  const SENSITIVE = /\d{1,3}(,\d{3})+|\d+\s*원|0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}|[\w.+-]+@[\w-]+\.[\w.]+|\d{3}-\d{2}-\d{5}|\d{6}-\d{7}/;
  const KEEP = ["aside", "nav", "button", "[role=tab]", "[role=menuitem]", "th", "label", "h1", "h2", "h3", "h4", "kbd", "legend", "option", "summary", ...extraKeep].join(",");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const hit = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode;
    const text = (t.nodeValue ?? "").trim();
    if (!text) continue;
    const el = t.parentElement;
    if (!el || el.closest("style,script,noscript")) continue;
    const sensitive = SENSITIVE.test(text) || (nameRe && nameRe.test(text));
    if (sensitive || !el.closest(KEEP)) hit.add(el);
  }
  hit.forEach((el) => el.classList.add("mcm-mask"));
  document.querySelectorAll("input, textarea, [contenteditable=true]").forEach((i) => {
    if ((i.value ?? i.textContent ?? "").trim()) i.classList.add("mcm-mask");
  });
  document.querySelectorAll("img[alt]:not([alt=''])").forEach((i) => { if (nameRe && nameRe.test(i.alt)) i.classList.add("mcm-mask"); });
  return { names: names.length, masked: hit.size };
};

const ctx = await chromium.launchPersistentContext(profile, {
  headless: true,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  locale: "ko-KR",
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const report = [];
for (const shot of SHOTS) {
  if (only.length && !only.includes(shot.id)) continue;
  try {
    await page.goto(BASE + shot.url, { waitUntil: "load", timeout: 60000 });
    if (page.url().includes("/login")) throw new Error("로그인 필요");
    await page.waitForTimeout(3500);
    if (shot.action) await shot.action(page);
    const r = await page.evaluate(MASK, shot.keep ?? []);
    await page.waitForTimeout(400);
    const png = await page.screenshot({ clip: shot.clip, animations: "disabled" });
    const webp = await sharp(png).webp({ quality: 78 }).toBuffer();
    writeFileSync(`${outDir}/${shot.id}.webp`, webp);
    writeFileSync(`${outDir}/${shot.id}.png`, png);
    report.push(`${shot.id}: ok names=${r.names} masked=${r.masked} webp=${Math.round(webp.length / 1024)}KB url=${page.url()}`);
  } catch (e) {
    report.push(`${shot.id}: FAIL ${e.message}`);
  }
}
console.log(report.join("\n"));
await ctx.close();
