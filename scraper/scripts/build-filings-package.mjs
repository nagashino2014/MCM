#!/usr/bin/env node
/**
 * MCM 신고 보조 설치 패키지 빌드 — 담당자 PC 에 저장소·Node 없이 설치할 수 있는 zip 을 만든다.
 *
 *   npm run filings:package
 *   → dist/filings-package/MCM-Filings-<버전>.zip
 *
 * zip 구성
 *   install.cmd / install.ps1     설치(현재 사용자, 관리자 권한 불필요) — mcm-filings:// 링크·시작 메뉴 등록
 *   uninstall.cmd / uninstall.ps1 제거
 *   README.txt, version.txt
 *   runtime/node.exe              이 PC 의 Node 런타임(빌드한 Node 와 같은 버전)
 *   app/filings.cjs               진입점(설치 모드·버전을 켜고 컴파일된 CLI 를 부른다)
 *   app/scripts, app/lib/filings  tsc 컴파일 결과(cli-filings.ts 와 그 import) — 새 빌드 의존성을 들이지 않는다
 *   app/node_modules/playwright, playwright-core
 *
 * 브라우저는 담당자 PC 의 Chrome 을 쓴다(IEPS 보안 모듈 때문에 번들 브라우저를 넣지 않는다).
 * 회사 직인은 넣지 않는다 — 도구가 로그인 뒤 MCM 에서 받아 둔다.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const SCRAPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = path.join(SCRAPER, "dist", "filings-package");
const PACKAGING = path.join(SCRAPER, "packaging", "filings");

function gitShort() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: SCRAPER }).toString().trim();
  } catch {
    return "nogit";
  }
}

const now = new Date(Date.now() + 9 * 3600 * 1000); // KST
const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
const version = `${stamp}-${gitShort()}`;
const name = `MCM-Filings-${version}`;
const stage = path.join(OUT_ROOT, name);

console.log(`[package] MCM 신고 보조 ${version}`);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, "runtime"), { recursive: true });
fs.mkdirSync(path.join(stage, "app", "node_modules"), { recursive: true });

/** tsconfig 경로는 슬래시로 쓴다 */
const toPosix = (p) => p.split(path.sep).join("/");

// 1) 컴파일 — cli-filings.ts 를 엔트리로 import 를 따라 JS 로(스크래퍼에 이미 있는 tsc 사용)
const tscConfig = path.join(OUT_ROOT, "tsconfig.package.json");
fs.mkdirSync(OUT_ROOT, { recursive: true });
fs.writeFileSync(
  tscConfig,
  JSON.stringify(
    {
      extends: toPosix(path.join(SCRAPER, "tsconfig.json")),
      compilerOptions: { outDir: toPosix(path.join(stage, "app")), rootDir: toPosix(SCRAPER), noEmit: false, sourceMap: false },
      files: [toPosix(path.join(SCRAPER, "scripts", "cli-filings.ts"))],
      include: [],
    },
    null,
    2
  )
);
const tscBin = path.join(SCRAPER, "node_modules", "typescript", "bin", "tsc");
execSync(`"${process.execPath}" "${tscBin}" --project "${tscConfig}"`, { cwd: SCRAPER, stdio: "inherit" });
fs.rmSync(tscConfig, { force: true });
// 진입점 — 설치 모드를 확실히 켜고(저장소 경로 판정에 기대지 않는다) 버전을 넣는다
fs.writeFileSync(
  path.join(stage, "app", "filings.cjs"),
  `process.env.MCM_FILINGS_PACKAGED = "1";
globalThis.__FILINGS_VERSION__ = ${JSON.stringify(version)};
require("./scripts/cli-filings.js");
`,
  "utf8"
);
console.log("[package] 컴파일: app/scripts/cli-filings.js + app/lib/filings/*");

// 2) Node 런타임 — 빌드에 쓴 node 그대로
fs.copyFileSync(process.execPath, path.join(stage, "runtime", "node.exe"));
console.log(`[package] 런타임: node ${process.version}`);

// 3) Playwright(브라우저 바이너리는 넣지 않는다)
for (const mod of ["playwright", "playwright-core"]) {
  fs.cpSync(path.join(SCRAPER, "node_modules", mod), path.join(stage, "app", "node_modules", mod), { recursive: true });
}
console.log("[package] playwright, playwright-core");

// 4) 설치 스크립트 — PowerShell 5.1 은 BOM 없는 UTF-8 한글을 깨뜨리고, cmd 는 CRLF 가 안전하다
const BOM = "﻿";
const read = (f) => fs.readFileSync(path.join(PACKAGING, f), "utf8").replace(/^﻿/, "").replace(/\r?\n/g, "\r\n");
for (const f of ["install.ps1", "uninstall.ps1", "README.txt"]) fs.writeFileSync(path.join(stage, f), BOM + read(f), "utf8");
for (const f of ["install.cmd", "uninstall.cmd"]) fs.writeFileSync(path.join(stage, f), read(f), "utf8");
fs.writeFileSync(path.join(stage, "version.txt"), version, "utf8");

// 5) 번들이 실제로 뜨는지 — 설치 모드·버전 확인
const probe = execSync(`"${path.join(stage, "runtime", "node.exe")}" "${path.join(stage, "app", "filings.cjs")}" version`, {
  cwd: stage,
  env: { ...process.env, MCM_FILINGS_HOME: path.join(OUT_ROOT, ".selftest-data") },
})
  .toString()
  .trim();
console.log(`[package] 자체 점검: ${probe}`);
if (!probe.includes(version) || !probe.includes("설치 모드")) throw new Error(`번들 자체 점검 실패: ${probe}`);
fs.rmSync(path.join(OUT_ROOT, ".selftest-data"), { recursive: true, force: true });

// 6) zip
const zipPath = path.join(OUT_ROOT, `${name}.zip`);
fs.rmSync(zipPath, { force: true });
const zip = new AdmZip();
zip.addLocalFolder(stage, name);
zip.writeZip(zipPath);
const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`[package] 완료: ${zipPath} (${mb}MB)`);
