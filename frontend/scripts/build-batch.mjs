// 배치 엔트리들을 각각 단일 CJS 번들로 빌드(.next/*.cjs).
// --packages=external: node_modules 의존(pg·undici 등)은 런타임(runner) node_modules 사용, 소스만 번들.
// @/ 경로는 tsconfig paths(@/*→./*) 대응 alias 플러그인으로 해결(baseUrl 없어 CLI paths 미적용).
import * as esbuild from "esbuild";

const root = process.cwd(); // frontend

const atAlias = {
  name: "at-alias",
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) =>
      build.resolve("./" + args.path.slice(2), { kind: args.kind, resolveDir: root })
    );
  },
};

// 엔트리(소스) → 산출물(.next/*.cjs) 목록. 새 배치는 여기 추가한다.
const ENTRIES = [
  { in: "scripts/intel-batch.ts", out: ".next/intel-batch.cjs" },
  { in: "scripts/adt-ingest.ts", out: ".next/adt-ingest.cjs" },
];

for (const { in: entry, out } of ENTRIES) {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    packages: "external",
    outfile: out,
    logLevel: "info",
    plugins: [atAlias],
  });
  console.log(`built ${out}`);
}
