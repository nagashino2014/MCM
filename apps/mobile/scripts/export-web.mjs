/**
 * 데스크탑 위젯·PWA 용 모바일 웹 번들 재export (2026-11-04)
 *
 *   cd apps/mobile && npm run export:web
 *
 * 하는 일: `expo export --platform web` → 산출물 검증 → `frontend/public/m-app` 교체. 끝나면 git 에서 변경을 확인하고
 * "chore(m-app): 데스크탑 위젯용 모바일 웹 번들 재export (main <sha> 기준)" 으로 커밋한 뒤 next 를 배포한다.
 *
 * ⚠ 검증 게이트가 있는 이유(2026-11-01 사고): 재export 번들이 아이콘 폰트를
 *   `/m-app/assets/________CodingProject/MCM/apps/mobile/node_modules/...`(절대 경로가 인코딩된 비정상 경로)로 참조해
 *   배포 후 모든 아이콘이 404 로 깨진 채 한 달 가까이 방치됐다. 또 `eas update` 와 같은 이유로 API 주소가 개발 PC LAN 으로
 *   구워질 수 있다(AGENTS.md). 둘 중 하나라도 어긋나면 public/m-app 을 건드리지 않고 실패한다.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileDir = path.resolve(here, '..');
const repoRoot = path.resolve(mobileDir, '..', '..');
const target = path.join(repoRoot, 'frontend', 'public', 'm-app');
const EXPECT_HOST = process.env.MCM_EXPECT_HOST ?? 'https://koensain.app';

function fail(msg) {
  console.error(`\n[export-web] 실패: ${msg}`);
  process.exit(1);
}

const out = mkdtempSync(path.join(tmpdir(), 'mcm-m-app-'));
console.log(`[export-web] expo export → ${out}`);
const r = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', out], {
  cwd: mobileDir,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CI: '1' },
});
if (r.status !== 0) fail(`expo export 종료 코드 ${r.status}`);

// ── 검증 1: 번들 안 아이콘 폰트 경로 ──
const jsDir = path.join(out, '_expo', 'static', 'js', 'web');
if (!existsSync(jsDir)) fail(`번들 디렉터리가 없다: ${jsDir}`);
const bundles = readdirSync(jsDir).filter((f) => f.endsWith('.js'));
if (!bundles.length) fail('웹 번들(.js)이 없다');
// 번들은 entry + 보조 청크 여러 개일 수 있다 — 절대 경로·LAN 주소는 파일마다 금지, 폰트·호스트는 전체에서 한 번이면 된다.
let fontOk = false;
let hostOk = false;
for (const f of bundles) {
  const src = readFileSync(path.join(jsDir, f), 'utf8');
  if (/\/m-app\/assets\/________/.test(src) || /assets\/[A-Za-z]:[\\/]/.test(src)) fail(`${f}: 에셋 경로에 절대 경로가 인코딩됐다(11-01 사고 재발)`);
  if (/\/m-app\/assets\/node_modules\/@expo\/vector-icons\/[^"']*Ionicons[^"']*\.ttf/.test(src)) fontOk = true;
  if (/192\.168\.\d+\.\d+/.test(src)) fail(`${f}: 사내 LAN 주소가 번들에 들어갔다 — .env 의 EXPO_PUBLIC_API_URL 확인`);
  if (src.includes(EXPECT_HOST)) hostOk = true;
}
if (!fontOk) fail('Ionicons 폰트 참조(/m-app/assets/node_modules/@expo/vector-icons/...)를 찾지 못했다');
if (!hostOk) fail(`API 호스트 ${EXPECT_HOST} 가 어느 번들에도 없다 — .env 의 EXPO_PUBLIC_API_URL 확인`);

// ── 검증 2: 참조한 폰트 파일이 산출물에 실제로 있는지 ──
const fontsDir = path.join(out, 'assets', 'node_modules', '@expo', 'vector-icons', 'build', 'vendor', 'react-native-vector-icons', 'Fonts');
if (!existsSync(fontsDir) || !readdirSync(fontsDir).some((f) => f.startsWith('Ionicons.'))) fail(`아이콘 폰트 파일이 산출물에 없다: ${fontsDir}`);

// ── 검증 3: PWA 파일(public/)이 복사됐는지 ──
for (const p of ['manifest.webmanifest', 'sw.js', path.join('pwa', 'icon-192.png')]) {
  if (!existsSync(path.join(out, p))) fail(`public/${p} 가 산출물에 복사되지 않았다`);
}
if (!readFileSync(path.join(out, 'index.html'), 'utf8').includes('beforeinstallprompt')) fail('index.html 에 PWA 부트 스크립트(+html.tsx)가 없다');

// ── 교체 ──
if (!existsSync(target)) fail(`대상 디렉터리가 없다: ${target}`);
rmSync(target, { recursive: true, force: true });
cpSync(out, target, { recursive: true });
rmSync(out, { recursive: true, force: true });

const count = (dir) => readdirSync(dir).reduce((n, f) => n + (statSync(path.join(dir, f)).isDirectory() ? count(path.join(dir, f)) : 1), 0);
const sha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
console.log(`\n[export-web] 완료: ${target} (${count(target)} 파일, 번들 ${bundles.join(', ')})`);
console.log(`[export-web] 다음: git add frontend/public/m-app && git commit -m "chore(m-app): 데스크탑 위젯용 모바일 웹 번들 재export (main ${sha} 기준)"`);
