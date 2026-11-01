import {build} from "esbuild";
import {spawnSync} from "node:child_process";
if(!process.env.INTEL_BRIEFING_ACCESS_TEST_DATABASE_URL)throw new Error("독립 intel_briefing_access_test 주소를 지정하세요.");
const entries=["tests/briefing-access.test.ts","tests/menu-route.test.ts"];
await build({entryPoints:entries,outdir:".next/briefing-access-tests",bundle:true,platform:"node",format:"cjs",packages:"external",tsconfig:"tsconfig.json",outExtension:{".js":".cjs"}});
const result=spawnSync(process.execPath,["--test",...entries.map(p=>".next/briefing-access-tests/"+p.replace(/^tests\//,"").replace(/\.ts$/,".cjs"))],{stdio:"inherit"});
process.exitCode=result.status??1;
