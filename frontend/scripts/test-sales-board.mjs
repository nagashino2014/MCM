import { build } from "esbuild";
import { spawnSync } from "node:child_process";

// Salesboard 서버 판정(lib/sales/board.ts·regions.ts) 단위 테스트 — test-todo.mjs 와 같은 방식(esbuild → node --test).
const entryPoints = ["tests/sales-board.test.ts"];
await build({
  entryPoints,
  outdir: ".next/sales-board-tests",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
  outExtension: { ".js": ".cjs" },
});
const files = entryPoints.map((p) => ".next/sales-board-tests/" + p.replace(/^tests\//, "").replace(/\.ts$/, ".cjs"));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
