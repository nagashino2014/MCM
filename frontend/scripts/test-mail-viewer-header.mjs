import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["tests/mail-viewer-header.test.ts"],
  outfile: ".next/mail-viewer-header.test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", ".next/mail-viewer-header.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
