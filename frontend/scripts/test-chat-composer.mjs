import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["tests/chat-composer.test.ts"],
  outfile: `.next/chat-composer.test.${process.pid}.cjs`,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", `.next/chat-composer.test.${process.pid}.cjs`], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
