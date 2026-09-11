import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["tests/menu-route.test.ts"],
  outfile: ".next/menu-route.test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", ".next/menu-route.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
