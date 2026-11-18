import { build } from "esbuild";
import { spawnSync } from "node:child_process";

// 사업장 삭제 막기(계약이 걸린 사업장)·대상사업장 본인 매칭(계약상대 사업장 그대로) 시험 — 2026-11-18
await build({
  entryPoints: ["tests/facility-delete-guard.test.ts"],
  outfile: ".next/facility-delete-guard.test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", ".next/facility-delete-guard.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
