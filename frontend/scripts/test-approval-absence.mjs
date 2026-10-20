import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["tests/approval-absence.test.ts"],
  outfile: ".next/approval-absence.test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", ".next/approval-absence.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
