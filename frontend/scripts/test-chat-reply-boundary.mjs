import {build} from "esbuild";
import {spawnSync} from "node:child_process";
if(!process.env.INTEL_CHAT_BOUNDARY_TEST_DATABASE_URL)throw new Error("독립 intel_chat_boundary_test 주소를 지정하세요.");
await build({entryPoints:["tests/chat-reply-boundary.test.ts"],outfile:".next/chat-reply-boundary-tests/test.cjs",bundle:true,platform:"node",format:"cjs",packages:"external",tsconfig:"tsconfig.json"});
const result=spawnSync(process.execPath,["--test",".next/chat-reply-boundary-tests/test.cjs"],{stdio:"inherit"});process.exitCode=result.status??1;
