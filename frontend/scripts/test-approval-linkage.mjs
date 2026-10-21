import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["tests/approval-linkage.test.ts"],
  outfile: ".next/approval-linkage.test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", ".next/approval-linkage.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
