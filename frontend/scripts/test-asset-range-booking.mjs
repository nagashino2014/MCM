import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import path from "node:path";

// createReservation(lib/assets/store.ts)의 서버 검증을 DB 없이 시험한다 — @/lib/db 를 가짜 모듈로 바꿔 묶는다.
const stubDb = path.resolve("tests/stubs/asset-store-db.ts");
await build({
  entryPoints: ["tests/asset-range-booking.test.ts"],
  outfile: ".next/asset-range-booking.test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
  plugins: [
    {
      name: "stub-db",
      setup(b) {
        b.onResolve({ filter: /^@\/lib\/db$/ }, () => ({ path: stubDb }));
      },
    },
  ],
});
const result = spawnSync(process.execPath, ["--test", ".next/asset-range-booking.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
