import { build } from "esbuild";
import { spawnSync } from "node:child_process";
const entries=["tests/briefing-schedule.test.ts","tests/briefing-curation.test.ts","tests/briefing-mobile-links.test.ts","tests/briefing-evidence.test.ts"];
if(process.env.INTEL_BRIEFING_TEST_DATABASE_URL)entries.push("tests/briefing.integration.test.ts");
await build({entryPoints:entries,outdir:".next/briefing-tests",bundle:true,platform:"node",format:"cjs",packages:"external",tsconfig:"tsconfig.json",outExtension:{".js":".cjs"}});
const result=spawnSync(process.execPath,["--test",...entries.map(p=>".next/briefing-tests/"+p.replace(/^tests\//,"").replace(/\.ts$/,".cjs"))],{stdio:"inherit"});
process.exitCode=result.status??1;
