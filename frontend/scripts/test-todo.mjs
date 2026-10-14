import { build } from "esbuild";
import { spawnSync } from "node:child_process";

// To-do 순수 모듈 단위 테스트(quick-parse·recurrence·position·board-color·completion) — test-menu-route.mjs 와 같은 방식(esbuild → node --test).
const entryPoints = [
  "tests/todo-quick-parse.test.ts",
  "tests/todo-recurrence.test.ts",
  "tests/todo-position.test.ts",
  "tests/todo-board-color.test.ts",
  "tests/todo-completion.test.ts",
];
await build({
  entryPoints,
  outdir: ".next/todo-tests",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
  outExtension: { ".js": ".cjs" },
});
const files = entryPoints.map((p) => ".next/todo-tests/" + p.replace(/^tests\//, "").replace(/\.ts$/, ".cjs"));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
