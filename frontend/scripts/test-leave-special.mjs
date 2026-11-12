import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["tests/leave-special.test.ts"],
  outfile: ".next/leave-special.test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", ".next/leave-special.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
