import { build } from "esbuild";
import { spawnSync } from "node:child_process";

// 메일 쓰기 개선(2026-11-12 직원 요청 2·7·14·16) 시험 — test-mail-sender-rules.mjs 와 같은 방식(esbuild → node --test).
const root = process.cwd(); // frontend
const atAlias = {
  name: "at-alias",
  setup(b) {
    b.onResolve({ filter: /^@\// }, (args) => b.resolve("./" + args.path.slice(2), { kind: args.kind, resolveDir: root }));
  },
};

const entryPoints = ["tests/mail-compose.test.ts"];
await build({
  entryPoints,
  outdir: ".next/mail-compose-tests",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  plugins: [atAlias],
  outExtension: { ".js": ".cjs" },
});
const files = entryPoints.map((p) => ".next/mail-compose-tests/" + p.replace(/^tests\//, "").replace(/\.ts$/, ".cjs"));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
