import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["tests/dept-scope.test.ts"],
  outfile: ".next/dept-scope.test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", ".next/dept-scope.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
