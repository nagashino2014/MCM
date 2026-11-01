import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({ entryPoints: ["tests/proposal-api.test.ts"], outfile: ".next/proposal-api-tests/tests.cjs", bundle: true, platform: "node", format: "cjs", packages: "external", tsconfig: "tsconfig.json", jsx: "automatic" });
const result = spawnSync(process.execPath, ["--test", ".next/proposal-api-tests/tests.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
