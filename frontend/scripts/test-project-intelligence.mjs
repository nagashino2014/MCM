import { build } from "esbuild";
import { spawnSync } from "node:child_process";
const entries=["tests/project-intelligence.test.ts"];
if(process.env.INTEL_TEST_DATABASE_URL)entries.push("tests/project-intelligence.integration.test.ts");
await build({entryPoints:entries,outdir:".next/project-intelligence-tests",bundle:true,platform:"node",format:"cjs",packages:"external",tsconfig:"tsconfig.json",outExtension:{".js":".cjs"}});
const result=spawnSync(process.execPath,["--test",...entries.map(p=>".next/project-intelligence-tests/"+p.replace(/^tests\//,"").replace(/\.ts$/,".cjs"))],{stdio:"inherit"});
process.exitCode=result.status??1;
