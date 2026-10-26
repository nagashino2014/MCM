import { build } from "esbuild";
import { spawnSync } from "node:child_process";

// 회사소개서 스튜디오(P5)·서체 라이브러리(P5b)·LLM 편집(P6) 순수 모듈 시험 + 홍보·채용공고 편집기 회귀 시험(공용 핵심 lib/doc-tree 추출) — test-todo.mjs 와 같은 방식(esbuild → node --test).
const entryPoints = ["tests/catalog-studio.test.ts", "tests/catalog-fonts.test.ts", "tests/catalog-ai.test.ts", "tests/recruit-doc-tree-regression.test.ts"];
await build({
  entryPoints,
  outdir: ".next/catalog-studio-tests",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
  jsx: "automatic",
  loader: { ".json": "json" },
  outExtension: { ".js": ".cjs" },
});
const files = entryPoints.map((p) => ".next/catalog-studio-tests/" + p.replace(/^tests\//, "").replace(/\.tsx?$/, ".cjs"));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
