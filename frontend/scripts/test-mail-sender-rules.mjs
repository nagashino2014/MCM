import { build } from "esbuild";
import { spawnSync } from "node:child_process";

// 메일 보낸 사람 [메일 분류 지정] 소급·해제 시험(11-03) — test-mail-gateway.mjs 와 같은 방식(esbuild → node --test).
// 통합 시험은 MAIL_SENDER_RULES_TEST_DATABASE_URL(로컬 일회용 PG, 305·337 적용)이 있을 때만 돈다.
const root = process.cwd(); // frontend
const atAlias = {
  name: "at-alias",
  setup(b) {
    b.onResolve({ filter: /^@\// }, (args) => b.resolve("./" + args.path.slice(2), { kind: args.kind, resolveDir: root }));
  },
};

const entryPoints = ["tests/mail-sender-rules.test.ts"];
await build({
  entryPoints,
  outdir: ".next/mail-sender-rules-tests",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  plugins: [atAlias],
  outExtension: { ".js": ".cjs" },
});
const files = entryPoints.map((p) => ".next/mail-sender-rules-tests/" + p.replace(/^tests\//, "").replace(/\.ts$/, ".cjs"));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
