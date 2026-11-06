import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["tests/contact-import.test.ts"],
  outfile: `.next/contact-import.test.${process.pid}.cjs`,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", `.next/contact-import.test.${process.pid}.cjs`], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
