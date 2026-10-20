import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["tests/money-gates.test.ts"],
  outfile: ".next/money-gates.test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", ".next/money-gates.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
