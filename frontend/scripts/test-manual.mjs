import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["tests/manual.test.ts"],
  outfile: ".next/manual.test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", ".next/manual.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
