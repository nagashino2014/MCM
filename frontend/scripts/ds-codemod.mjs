#!/usr/bin/env node
// KESI Precision codemod — 기계적으로 안전한 치환만 한다. 기본은 dry-run.
// 사용:  node scripts/ds-codemod.mjs [--module components/contracts] [--write] [--weights] [--only C1,C4]
//   --write    실제로 파일을 고친다 (없으면 바뀔 내용만 보고)
//   --weights  C2(굵기 700+ → 600)도 적용. 시각 변화가 커서 기본은 꺼져 있음
//   --only     특정 변환만
// 변환 목록
//   C1 글자 크기 → 닫힌 스케일(11·12·13·14·16·22·24)
//   C2 font-bold/extrabold/black → font-semibold        (--weights 필요)
//   C3 rounded-md/xl/2xl/3xl, rounded-[5|10|14px] → rounded-lg
//   C4 var(--cd-danger,#FA896B) → var(--cd-error) · var(--cd-warning,#FFAE1F) → var(--cd-warning) · var(--cd-success,#13DEB9) → var(--cd-success) · 남은 --cd-danger → --cd-error
//   C5 text-[color:var(--cd-x)] / bg-[color:var(--cd-x)] 의 hex 폴백 제거
// 하지 않는 것(린트가 알려줌): 그림자, 팔레트 클래스, <table>, 서브픽셀 패딩, 인라인 style — 맥락을 봐야 한다.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["app", "components"];
const SIZE_MAP = { 8: 11, 8.5: 11, 9: 11, 9.5: 11, 10: 11, 10.5: 11, 11.5: 12, 12.5: 13, 13.5: 14, 14.5: 14, 15: 14, 17: 16, 18: 16, 19: 16, 20: 22, 21: 22, 23: 22, 26: 24, 28: 24, 30: 24, 34: 24 };

const MODS = [
  { id: "C1", apply: (s) => s
      .replace(/\btext-\[(\d+(?:\.\d+)?)px\]/g, (all, n) => { const k = parseFloat(n); return k in SIZE_MAP ? `text-[${SIZE_MAP[k]}px]` : all; })
      .replace(/\btext-\[0\.95rem\]/g, "text-[14px]")
      .replace(/\btext-lg\b/g, "text-base")
      .replace(/\btext-xl\b/g, "text-[22px]")
      .replace(/\btext-3xl\b/g, "text-2xl") },
  { id: "C2", flag: "weights", apply: (s) => s.replace(/\bfont-(bold|extrabold|black)\b/g, "font-semibold") },
  { id: "C3", apply: (s) => s
      .replace(/\brounded-(md|xl|2xl|3xl)\b/g, "rounded-lg")
      .replace(/\brounded-\[(5|10|14)px\]/g, "rounded-lg") },
  { id: "C4", apply: (s) => s
      .replace(/var\(\s*--cd-danger\s*,\s*#?[fF][aA]896[bB]\s*\)/g, "var(--cd-error)")
      .replace(/var\(\s*--cd-warning\s*,\s*#?[fF]{2}[aA][eE]1[fF]\s*\)/g, "var(--cd-warning)")
      .replace(/var\(\s*--cd-success\s*,\s*#?13[dD][eE][bB]9\s*\)/g, "var(--cd-success)")
      .replace(/--cd-danger\b/g, "--cd-error") },
  { id: "C5", apply: (s) => s.replace(/\[(color|bg|border):var\((--cd-[a-z-]+)\s*,\s*#[0-9a-fA-F]{3,8}\)\]/g, "[$1:var($2)]") },
];

const args = process.argv.slice(2);
const opt = { modules: [], write: false, weights: false, only: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--module") opt.modules.push(args[++i].replace(/\\/g, "/").replace(/\/$/, ""));
  else if (a === "--write") opt.write = true;
  else if (a === "--weights") opt.weights = true;
  else if (a === "--only") opt.only = new Set(args[++i].split(","));
}
const mods = MODS.filter((m) => (!opt.only || opt.only.has(m.id)) && (!m.flag || opt[m.flag]));

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) yield p;
  }
}

// 한 변환이 바꾼 글자 수 대신 "바뀐 줄 수"를 센다 — 리뷰 단위와 같다.
function changedLines(a, b) { const A = a.split("\n"), B = b.split("\n"); let n = 0; for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) n++; return n; }

const totals = Object.fromEntries(mods.map((m) => [m.id, 0]));
let filesTouched = 0, filesSeen = 0;
const touched = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = relative(".", file).replace(/\\/g, "/");
    if (opt.modules.length && !opt.modules.some((m) => rel.startsWith(m))) continue;
    filesSeen++;
    const before = readFileSync(file, "utf8");
    let cur = before;
    const per = {};
    for (const m of mods) {
      const next = m.apply(cur);
      if (next !== cur) { const n = changedLines(cur, next); per[m.id] = n; totals[m.id] += n; cur = next; }
    }
    if (cur !== before) {
      filesTouched++;
      touched.push([rel, per]);
      if (opt.write) writeFileSync(file, cur, "utf8");
    }
  }
}

console.log(`${opt.write ? "적용" : "dry-run"} — ${filesSeen}개 파일 중 ${filesTouched}개 변경${opt.modules.length ? ` (범위: ${opt.modules.join(", ")})` : ""}`);
for (const m of mods) console.log(`  ${m.id}  ${String(totals[m.id]).padStart(5)} 줄`);
if (!opt.weights && (!opt.only || opt.only.has("C2"))) console.log("  C2  (건너뜀 — --weights 로 켠다)");
console.log("\n파일별:");
touched.sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0))
  .slice(0, 40).forEach(([f, per]) => console.log(`  ${f}  ${Object.entries(per).map(([k, v]) => `${k}:${v}`).join(" ")}`));
if (!opt.write) console.log("\n실제 적용: 같은 명령에 --write. 모듈 단위로(--module) 돌리고 화면을 확인한 뒤 다음 모듈로.");
