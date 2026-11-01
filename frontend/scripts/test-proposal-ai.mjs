import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({ entryPoints: ["tests/proposal-ai.test.ts"], outfile: ".next/proposal-ai-tests/tests.cjs", bundle: true, platform: "node", format: "cjs", packages: "external", tsconfig: "tsconfig.json", jsx: "automatic" });
const result = spawnSync(process.execPath, ["--test", ".next/proposal-ai-tests/tests.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
