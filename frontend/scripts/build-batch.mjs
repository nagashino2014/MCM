// intel-batch.ts 를 단일 CJS 번들로 빌드(.next/intel-batch.cjs).
// --packages=external: node_modules 의존(pg·undici 등)은 런타임(runner) node_modules 사용, 소스만 번들.
// @/ 경로는 tsconfig paths(@/*→./*) 대응 alias 플러그인으로 해결(baseUrl 없어 CLI paths 미적용).
import * as esbuild from "esbuild";
import path from "node:path";

const root = process.cwd(); // frontend

await esbuild.build({
  entryPoints: ["scripts/intel-batch.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  packages: "external",
  outfile: ".next/intel-batch.cjs",
  logLevel: "info",
  plugins: [
    {
      name: "at-alias",
      setup(build) {
        build.onResolve({ filter: /^@\// }, (args) =>
          build.resolve("./" + args.path.slice(2), { kind: args.kind, resolveDir: root })
        );
      },
    },
  ],
});

console.log("built .next/intel-batch.cjs");
