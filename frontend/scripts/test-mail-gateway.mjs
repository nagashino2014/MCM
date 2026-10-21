import { build } from "esbuild";
import { spawnSync } from "node:child_process";

// 외부 메일 프로그램 게이트웨이(IMAP/SMTP) 단위·세션 테스트 — test-todo.mjs 와 같은 방식(esbuild → node --test).
// 게이트웨이 코드는 @/ 경로를 쓰므로 build-batch.mjs 와 같은 alias 플러그인을 단다.
const root = process.cwd(); // frontend
const atAlias = {
  name: "at-alias",
  setup(b) {
    b.onResolve({ filter: /^@\// }, (args) => b.resolve("./" + args.path.slice(2), { kind: args.kind, resolveDir: root }));
  },
};

const entryPoints = ["tests/mail-gateway-parse.test.ts", "tests/mail-gateway-session.test.ts"];
await build({
  entryPoints,
  outdir: ".next/mail-gateway-tests",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  plugins: [atAlias],
  outExtension: { ".js": ".cjs" },
});
const files = entryPoints.map((p) => ".next/mail-gateway-tests/" + p.replace(/^tests\//, "").replace(/\.ts$/, ".cjs"));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
