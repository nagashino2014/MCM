import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({ entryPoints: ["tests/local-intelligence-source-reconciliation.test.ts"], outfile: ".next/local-intelligence-source-tests.cjs", bundle: true, platform: "node", format: "cjs", packages: "external", tsconfig: "tsconfig.json" });
const result = spawnSync(process.execPath, ["--test", ".next/local-intelligence-source-tests.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
