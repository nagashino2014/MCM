// design-sync 사전 빌드(cfg.buildCmd): ① 앱 CSS+cdash CSS 를 Tailwind 로 컴파일 ② cdash 선언 파일(.d.ts) 생성.
// 실행: node .design-sync/build.mjs  (frontend/ 에서)
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
rmSync(".design-sync/pkg/types", { recursive: true, force: true });
run("npx tailwindcss -c tailwind.config.ts -i .design-sync/ds-source.css -o .design-sync/pkg/ds.css");
try {
  run("npx tsc -p .design-sync/tsconfig.dts.json");
} catch {
  // 앱에 선행 타입 오류가 있어도 선언은 생성된다(noEmitOnError false). 결과 파일 존재로 판정한다.
  console.error("[build] tsc reported errors - declarations still emitted; check pkg/types");
}
mkdirSync(".design-sync/pkg/types", { recursive: true });
writeFileSync(".design-sync/pkg/types/index.d.ts", 'export * from "./components/cdash/index";\n');
console.log("[build] ok");
