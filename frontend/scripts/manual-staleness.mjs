// 낡은 매뉴얼 보고(docs/manual-help-blueprint.md §5.3) — node scripts/manual-staleness.mjs
// 기사·도움말의 sources 파일이 reviewedAt 이후에 커밋으로 바뀌었으면 "검토 필요"로 보고한다(실패가 아니라 보고).
// 화면 동작이 그대로라면 확인 후 reviewedAt 만 갱신하면 된다.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const out = resolve(`.next/manual-registry.${process.pid}.cjs`);
await build({
  stdin: {
    contents: 'export { MANUAL_ARTICLES, HELP_TOPICS } from "./content/manual";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: out,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const { MANUAL_ARTICLES, HELP_TOPICS } = createRequire(import.meta.url)(out);

const cache = new Map();
function lastChanged(file) {
  if (!cache.has(file)) {
    try {
      cache.set(file, execFileSync("git", ["log", "-1", "--format=%cs", "--", file], { encoding: "utf8" }).trim());
    } catch {
      cache.set(file, "");
    }
  }
  return cache.get(file);
}

const entries = [
  ...MANUAL_ARTICLES.map((a) => ({ kind: "기사", id: a.id, sources: a.sources, reviewedAt: a.reviewedAt })),
  ...Object.values(HELP_TOPICS).map((t) => ({ kind: "도움말", id: t.id, sources: t.sources, reviewedAt: t.reviewedAt })),
];
const stale = [];
for (const e of entries) {
  const changed = e.sources.map((f) => ({ f, d: lastChanged(f) })).filter((x) => x.d && x.d > e.reviewedAt);
  if (changed.length) stale.push({ ...e, changed });
}

if (stale.length === 0) {
  console.log(`매뉴얼 검토 필요 없음 — 기사 ${MANUAL_ARTICLES.length}편·도움말 ${Object.keys(HELP_TOPICS).length}개`);
} else {
  console.log(`매뉴얼 검토 필요 ${stale.length}건 (sources 가 reviewedAt 이후 변경됨)`);
  for (const s of stale) {
    console.log(`- [${s.kind}] ${s.id} (검토 ${s.reviewedAt})`);
    for (const c of s.changed) console.log(`    ${c.d}  ${c.f}`);
  }
}
