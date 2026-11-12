import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import path from "node:path";

// 푸시·배지(2026-11-12) 시험 — DB·Expo·AWS 없이 돈다(실제 발송 없음).
// 1) 새 메일 푸시 기준(lib/mail/inbound-push.ts): @/lib/db·@/lib/notify/push-expo 를 가짜 모듈로 바꿔 묶는다.
// 2) 앱 배지·딥링크(apps/mobile/src/lib): react-native·./api·./notification-tray 를 가짜 모듈로 바꿔 묶는다.
const stubDb = path.resolve("tests/stubs/mail-push-db.ts");
const stubPush = path.resolve("tests/stubs/mail-push-send.ts");
const stubMobile = path.resolve("tests/stubs/mobile-notify-env.ts");
const mobileLib = path.resolve("../apps/mobile/src/lib");
const common = { bundle: true, platform: "node", format: "cjs", packages: "external", tsconfig: "tsconfig.json" };
await build({
  ...common,
  entryPoints: ["tests/mail-push.test.ts"],
  outfile: ".next/mail-push.test.cjs",
  plugins: [
    {
      name: "stub-db-push",
      setup(b) {
        b.onResolve({ filter: /^@\/lib\/db$/ }, () => ({ path: stubDb }));
        b.onResolve({ filter: /^@\/lib\/notify\/push-expo$/ }, () => ({ path: stubPush }));
      },
    },
  ],
});
await build({
  ...common,
  entryPoints: ["tests/mobile-notify.test.ts"],
  outfile: ".next/mobile-notify.test.cjs",
  plugins: [
    {
      name: "stub-mobile",
      setup(b) {
        b.onResolve({ filter: /^react-native$/ }, () => ({ path: stubMobile }));
        b.onResolve({ filter: /^\.\/(api|notification-tray)$/ }, (args) =>
          path.resolve(args.resolveDir) === mobileLib ? { path: stubMobile } : undefined
        );
      },
    },
  ],
});
const result = spawnSync(process.execPath, ["--test", ".next/mail-push.test.cjs", ".next/mobile-notify.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
