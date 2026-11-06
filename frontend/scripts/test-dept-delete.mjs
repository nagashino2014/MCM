import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["tests/dept-delete.test.ts"],
  outfile: ".next/dept-delete.test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", ".next/dept-delete.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
