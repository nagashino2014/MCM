import { build } from "esbuild";
import { spawnSync } from "node:child_process";

// 직원 일람표 순수 모듈 단위 테스트 — test-todo.mjs 와 같은 방식(esbuild → node --test).
const entryPoints = ["tests/employee-roster.test.ts"];
await build({
  entryPoints,
  outdir: ".next/employee-roster-tests",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
  outExtension: { ".js": ".cjs" },
});
const files = entryPoints.map((p) => ".next/employee-roster-tests/" + p.replace(/^tests\//, "").replace(/\.ts$/, ".cjs"));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
