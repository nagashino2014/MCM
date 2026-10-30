import { build } from "esbuild";
import { spawnSync } from "node:child_process";

// 외부 연동 감시 순수 판정 단위 테스트 — test-todo.mjs 와 같은 방식(esbuild → node --test).
const entryPoints = ["tests/integration-watch.test.ts"];
await build({
  entryPoints,
  outdir: ".next/integration-watch-tests",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
  outExtension: { ".js": ".cjs" },
});
const files = entryPoints.map((p) => ".next/integration-watch-tests/" + p.replace(/^tests\//, "").replace(/\.ts$/, ".cjs"));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
