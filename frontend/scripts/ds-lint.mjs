#!/usr/bin/env node
// KESI Precision 디자인 시스템 린트 — 토큰 밖의 값을 찾는다 (읽기 전용).
// 사용:  node scripts/ds-lint.mjs [--module components/contracts] [--by-file] [--json] [--strict] [--rule R1,R4]
//   --module  경로 접두어로 범위 제한(여러 번 가능)
//   --by-file 파일별 위반 수 상위 30개
//   --json    기계 판독용 출력
//   --strict  위반이 있으면 exit 1 (CI용)
//   --rule    특정 규칙만
// 규칙 정의는 KESI Precision 디자인 시스템 README "린트가 잡는 것" 표와 같다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["app", "components"];
const SIZE_OK = new Set([11, 12, 13, 14, 16, 22, 24]);
const PALETTE = "(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)";

const RULES = [
  { id: "R1", name: "글자 크기 — 닫힌 스케일 밖", fix: "11·12·13·14·16·22·24px 중 가장 가까운 값 (codemod C1)",
    re: /\btext-\[(\d+(?:\.\d+)?)(px|rem)\]|\btext-(lg|xl|3xl)\b/g,
    test: (m) => { if (m[3]) return true; const n = parseFloat(m[1]); if (m[2] === "rem") return !SIZE_OK.has(Math.round(n * 16)); return !SIZE_OK.has(n); } },
  { id: "R2", name: "굵기 700 이상", fix: "font-medium(500) 또는 font-semibold(600) (codemod C2, --weights)",
    re: /\bfont-(bold|extrabold|black)\b/g },
  { id: "R3", name: "반경 — 10px/pill 밖", fix: "rounded-lg(10px = --radius, 2026-10-28) 또는 rounded-full (codemod C3)",
    re: /\brounded-(md|xl|2xl|3xl)\b|\brounded-\[(\d+)px\]/g,
    test: (m) => !(m[2] && parseInt(m[2]) === 2) },
  { id: "R4", name: "그림자 클래스 (카드·버튼·입력)", fix: "제거. 카드 그림자는 cd-card 의 --cd-shadow, 오버레이는 --cd-shadow-* 토큰이 담당",
    re: /\bshadow-(sm|md|lg|xl|2xl)\b/g },
  { id: "R5", name: "Tailwind 팔레트 색상 클래스", fix: "상태 토큰 클래스(cd-error-text, cd-warn-text, cd-pill-*)",
    re: new RegExp(`\\b(bg|text|border|ring|from|to|via|fill|stroke)-${PALETTE}-\\d{2,3}(?:/\\d+)?\\b`, "g") },
  { id: "R6", name: "hex 리터럴 (TSX)", fix: "var(--cd-*) 토큰. 차트 색은 lib/chart-palette 로",
    re: /#[0-9a-fA-F]{6}\b(?![0-9a-fA-F])/g,
    skipLine: /^\s*(\/\/|\*|\/\*)/ },
  { id: "R7", name: "정의되지 않은 토큰 --cd-danger", fix: "--cd-error (codemod C4). 현재는 폴백 #FA896B 가 그려지고 있음",
    re: /--cd-danger\b/g },
  { id: "R8", name: "서브픽셀 패딩/간격 (높이 맞추기용)", fix: "h-9(36px)/h-8(32px) 고정 + py-0",
    re: /\b(p|px|py|pt|pb|pl|pr|m|mt|mb|ml|mr|gap|gap-x|gap-y)-\[\d+\.5px\]/g },
  { id: "R9", name: "<table> 직접 작성", fix: "CdTable (bare 옵션)",
    re: /<table\b/g },
  { id: "R10", name: "그라데이션 (주 버튼 외)", fix: "cd-card / cd-tint-primary",
    re: /\bbg-gradient-to-\w+\b/g },
  { id: "R11", name: "대문자 변환·넓은 자간", fix: "제거 — 레이블은 12px 500 ink-muted",
    re: /\b(uppercase|tracking-wide|tracking-wider|tracking-widest)\b/g },
  { id: "R13", name: "글라스(backdrop-blur) — 셸 크롬 밖", fix: "본문에는 쓰지 않는다. 사이드바·상단바는 cd-glass / cd-glass-bar",
    re: /\bbackdrop-blur(-\w+)?\b|backdropFilter\s*:\s*["'`](?!none)/g },
  { id: "R12", name: "인라인 style 에 색·크기·간격", fix: "토큰 클래스. 인라인은 계산된 left/width/transform 만",
    re: /style=\{\{[^}]*\b(color|background|backgroundColor|fontSize|fontWeight|padding|margin|borderRadius|boxShadow)\s*:/g },
];

const args = process.argv.slice(2);
const opt = { modules: [], byFile: false, json: false, strict: false, rules: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--module") opt.modules.push(args[++i].replace(/\\/g, "/").replace(/\/$/, ""));
  else if (a === "--by-file") opt.byFile = true;
  else if (a === "--json") opt.json = true;
  else if (a === "--strict") opt.strict = true;
  else if (a === "--rule") opt.rules = new Set(args[++i].split(","));
}
const rules = opt.rules ? RULES.filter((r) => opt.rules.has(r.id)) : RULES;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) yield p;
  }
}

const totals = Object.fromEntries(rules.map((r) => [r.id, 0]));
const perFile = new Map(); // file -> {total, byRule, samples}
let files = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = relative(".", file).replace(/\\/g, "/");
    if (opt.modules.length && !opt.modules.some((m) => rel.startsWith(m))) continue;
    files++;
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    const rec = { total: 0, byRule: {}, samples: [] };
    lines.forEach((line, i) => {
      for (const r of rules) {
        if (r.skipLine && r.skipLine.test(line)) continue;
        r.re.lastIndex = 0;
        let m;
        while ((m = r.re.exec(line))) {
          if (r.test && !r.test(m)) continue;
          totals[r.id]++;
          rec.total++;
          rec.byRule[r.id] = (rec.byRule[r.id] || 0) + 1;
          if (rec.samples.length < 3) rec.samples.push(`${i + 1}: ${m[0]}`);
        }
      }
    });
    if (rec.total) perFile.set(rel, rec);
  }
}

const grand = Object.values(totals).reduce((a, b) => a + b, 0);
if (opt.json) {
  console.log(JSON.stringify({ files, grand, totals, perFile: Object.fromEntries(perFile) }, null, 2));
} else {
  console.log(`KESI Precision 린트 — ${files}개 파일, 위반 ${grand}건${opt.modules.length ? ` (범위: ${opt.modules.join(", ")})` : ""}\n`);
  for (const r of rules) {
    console.log(`${r.id.padEnd(4)} ${String(totals[r.id]).padStart(5)}  ${r.name}`);
    console.log(`            → ${r.fix}`);
  }
  if (opt.byFile) {
    console.log("\n파일별 상위 30:");
    [...perFile.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 30).forEach(([f, rec]) => {
      const br = Object.entries(rec.byRule).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ");
      console.log(`${String(rec.total).padStart(5)}  ${f}  [${br}]`);
    });
  }
}
if (opt.strict && grand > 0) process.exit(1);
