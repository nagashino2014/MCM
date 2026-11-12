import { build } from "esbuild";
import { spawnSync } from "node:child_process";

// 주소록 간이 등록(357)·연락처 가져오기 재업로드 시험(2026-11-12) — test-contact-import.mjs 와 같은 방식(esbuild → node --test).
// DB 시험은 CONTACT_QUICK_TEST_DATABASE_URL(로컬 일회용 PG, 스테이징 스키마 + 357 적용)이 있을 때만 돈다.
await build({
  entryPoints: ["tests/contact-quick.test.ts"],
  outfile: `.next/contact-quick.test.${process.pid}.cjs`,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", `.next/contact-quick.test.${process.pid}.cjs`], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
