import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({ entryPoints: ["tests/local-intelligence-import-payload.test.ts"], outdir: ".next/news-import-tests", bundle: true, platform: "node", format: "cjs", packages: "external", tsconfig: "tsconfig.json", outExtension: { ".js": ".cjs" } });
const result = spawnSync(process.execPath, ["--test", ".next/news-import-tests/local-intelligence-import-payload.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
