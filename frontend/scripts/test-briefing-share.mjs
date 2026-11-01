import { build } from "esbuild";
import { spawnSync } from "node:child_process";
if (!process.env.INTEL_BRIEFING_SHARE_TEST_DATABASE_URL) throw new Error("독립 로컬 intel_briefing_share_test URL을 지정하세요.");
await build({ entryPoints: ["tests/briefing-share.integration.test.ts"], outfile: ".next/briefing-share-tests/tests.cjs", bundle: true, platform: "node", format: "cjs", packages: "external", tsconfig: "tsconfig.json" });
const result = spawnSync(process.execPath, ["--test", ".next/briefing-share-tests/tests.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
