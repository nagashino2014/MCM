import { build } from "esbuild";
import { spawnSync } from "node:child_process";

// PROPOSAL_TEST_OUT을 지정하면 합성 HWPX 4종과 Python 독립 재읽기용 기대값을 해당 폴더에 저장한다.
await build({
  entryPoints: ["tests/proposal-hwpx.test.ts"],
  outdir: ".next/proposal-hwpx-tests",
  bundle: true, platform: "node", format: "cjs", packages: "external",
  tsconfig: "tsconfig.json", outExtension: { ".js": ".cjs" },
});
const result = spawnSync(process.execPath, ["--test", ".next/proposal-hwpx-tests/proposal-hwpx.test.cjs"], { stdio: "inherit", env: process.env });
process.exitCode = result.status ?? 1;
