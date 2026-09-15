import {build} from "esbuild";
import {spawnSync} from "node:child_process";
import path from "node:path";
await build({entryPoints:["tests/facility-quality.test.ts"],outfile:".next/facility-quality.test.cjs",bundle:true,platform:"node",format:"cjs",packages:"external",tsconfig:"tsconfig.json"});
const r=spawnSync(process.execPath,["--test",".next/facility-quality.test.cjs"],{stdio:"inherit",env:{...process.env,NODE_PATH:path.resolve('../scraper/node_modules')+path.delimiter+(process.env.NODE_PATH||'')}});
process.exitCode=r.status??1;
