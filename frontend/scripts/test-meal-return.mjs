import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["tests/meal-return.test.ts"],
  outfile: ".next/meal-return.test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", ".next/meal-return.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
