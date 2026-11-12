import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["tests/vehicle-booking.test.ts"],
  outfile: ".next/vehicle-booking.test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
});
const result = spawnSync(process.execPath, ["--test", ".next/vehicle-booking.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
