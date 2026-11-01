import assert from "node:assert/strict";
import {build} from "esbuild";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";
const fixture=resolve("tests/fixtures/claude-gateway-runtime.ts");
const built=await build({entryPoints:["tests/claude-gateway-thinking.test.ts"],outfile:".next/claude-gateway-thinking-tests.cjs",bundle:true,platform:"node",format:"cjs",packages:"external",tsconfig:"tsconfig.json",metafile:true,plugins:[{name:"no-real-db-or-alerts",setup(b){
  b.onResolve({filter:/^(?:@\/lib\/db|\.\.\/db)$/},()=>({path:fixture}));
  b.onResolve({filter:/^\.\/(?:usage-log|budget)$/},args=>args.importer.replaceAll("\\","/").endsWith("/lib/ai/claude-client.ts")?{path:fixture}:undefined);
}}]});
assert.ok(!Object.keys(built.metafile.inputs).some(path=>/(?:^|\/)lib\/(?:db\.ts|ai\/(?:budget|usage-log)\.ts)$/.test(path)),"실제 DB·알림 모듈을 시험 번들에 포함하면 안 됩니다.");
const result=spawnSync(process.execPath,["--test",".next/claude-gateway-thinking-tests.cjs"],{stdio:"inherit"});process.exitCode=result.status??1;
