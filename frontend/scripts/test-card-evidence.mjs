import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["tests/card-evidence.test.ts"],
  outfile: ".next/card-evidence.test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", ".next/card-evidence.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
