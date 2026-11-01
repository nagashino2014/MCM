import { build } from "esbuild";
import { spawnSync } from "node:child_process";
const entries = ["tests/official-sources.test.ts"];
if (process.env.OFFICIAL_SOURCES_TEST_DATABASE_URL) entries.push("tests/official-sources.integration.test.ts");
await build({ entryPoints: entries, outdir: ".next/official-sources-tests", bundle: true, platform: "node", format: "cjs", packages: "external", tsconfig: "tsconfig.json", outExtension: { ".js": ".cjs" } });
const result = spawnSync(process.execPath, ["--test", ...entries.map(p => ".next/official-sources-tests/" + p.replace(/^tests\//, "").replace(/\.ts$/, ".cjs"))], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
