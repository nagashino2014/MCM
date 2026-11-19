import { build } from "esbuild";
import { spawnSync } from "node:child_process";

// 범용 스크래퍼 조회 기간 한도 대응 시험(2026-11-19) — esbuild → node --test. DB·실제 API 를 쓰지 않는다.
await build({
  entryPoints: ["tests/scraper-date-range.test.ts"],
  outfile: `.next/scraper-date-range.test.${process.pid}.cjs`,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", `.next/scraper-date-range.test.${process.pid}.cjs`], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
