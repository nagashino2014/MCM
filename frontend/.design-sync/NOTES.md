# design-sync NOTES — MCM cdash

작업 위치는 `frontend/`(여기가 config home). 모든 명령은 `frontend/`에서 실행한다.

## 구조
- cdash 는 별도 패키지가 아니라 Next.js 앱 안의 `components/cdash/` 폴더다. dist·.d.ts 가 없다.
- 그래서 스테이징 패키지 `.design-sync/pkg/`(package.json name `mcm-cdash`, `index.ts` = cdash 배럴 재수출)를 `--entry ./.design-sync/pkg/index.ts` 로 넘긴다. PKG_DIR 이 이 폴더가 되므로 config 의 `srcDir`·`componentSrcMap`·`tsconfig`·`extraEntries` 는 `../../` 기준, `cssEntry` 는 패키지 안(`ds.css`)이어야 한다(cssEntry 는 PKG_DIR 밖을 거부).
- `cfg.buildCmd` = `node .design-sync/build.mjs`: ① Tailwind 로 `app/globals.css`+`cdash.css` 를 `pkg/ds.css` 로 컴파일 ② `tsc -p .design-sync/tsconfig.dts.json` 으로 cdash 선언 파일을 `pkg/types/` 에 생성(앱 선행 타입 오류가 있어도 선언은 나옴) ③ `pkg/types/index.d.ts` 작성. 산출물 두 개는 gitignore.
- 선언 파일이 없으면 변환기가 `frontend/types/`(앱 전역 타입)를 타입 루트로 잡아 모든 props 가 `[key: string]: unknown` 로 나온다.
- `componentSrcMap` 에 21개 컴포넌트를 명시해야 한다(패키지 .d.ts export 스캔만으로는 0개).
- 루트 래퍼: `--cd-*` 토큰은 `.cdash`/`.cdash-vars` 선택자에만 정의된다. 앱은 AppShell 루트가 공급하지만 세션·사이드바에 묶여 있어 `.design-sync/cdash-root.tsx` 의 `CdashRoot`(같은 class·data-theme)를 `extraEntries` + `provider` 로 쓴다.

## 해결한 문제
- `process is not defined`(전 카드 실패): `CdPageHeader` 가 `next/link` 를 import → Next 내부 `process.env.__NEXT_*` 참조. `.design-sync/tsconfig.bundle.json` 의 `paths` 로 `next/link` 를 `.design-sync/shims/next-link.tsx`(<a> 렌더)로 연결. 이 tsconfig 는 번들 전용이며 `paths` 를 직접 가져야 한다(변환기 플러그인은 `extends` 를 따라가지 않음).
- `[BUNDLE_EXPORT]` 21/21: 번들이 UTF-8 선언 없는 페이지에서 `/[가-힣]/` 정규식이 Latin-1 로 해석돼 SyntaxError → IIFE 미실행. `가` 이스케이프는 esbuild 가 다시 문자로 풀어 효과 없음. `CdAvatar.tsx` initials 를 문자 코드 비교로 바꿔 해결(앱 소스 변경, 동작 동일). **cdash 소스에 비ASCII 문자 범위 정규식을 새로 넣지 말 것.**
- Playwright: 캐시에 chromium-1217 이 있어 `.ds-sync` 에 `playwright@1.59.1` 설치(1217 을 pin).

## Known render warns
- `[FONT_MISSING]` Inter·Pretendard·Pretendard Variable — 사용자 결정으로 시스템 글꼴 대체 수용(아래 Re-sync risks).
- `CdDropdown`·`CdHelp` 의 `Open` 은 마운트 직후 트리거를 `click()` 해 열린 상태를 보여준다(정적 렌더 불가 상태). `CdHelp` 는 `cardMode: single` + `primaryStory: Open`.
- 오버레이 카드: `CdModal`·`CdDrawer`·`CdToastProvider` 는 `cardMode: single` + viewport 지정. 표·헤더·분할·버튼은 `cardMode: column`.
- 미리보기 작성 시 셸 heredoc 한 번에 여러 `.tsx` 를 쓰면 bash 인용 파싱이 깨졌다 — 파일별로 쓴다.

## 사용자 검토 반영 (2026-09-16, cdash 소스 변경 = 앱 전체 반영)
- pill 탭 묶음 바탕 회색→흰색(`.cd-tabs` background `--cd-card`).
- 아바타: 라이트 팔레트 `--cd-av-1~6` 밝은 톤으로, `CdAvatar` 바탕을 투명 혼합→카드면 혼합(베이지 비침 제거). 같은 토큰을 쓰는 홈 메일 위젯·`cd-pill-violet/teal` 도 함께 밝아진다.
- underline 탭: 선택 면/테두리 없이 글자색+`::after` 2px 막대(버튼 8px 반경 규칙과 분리).
- 표: `.cd-table` 흰 면, `CdTable` 기본 카드 래퍼 + `bare` prop.
- 배치 원칙(2026-09-17 사용자 지시): 콘텐츠 요소는 베이지 바탕에 직접 두지 않고 `cd-card` 안에. 미리보기도 전부 `<div className="cd-card p-4">` 로 감쌌다(예외: `CdPageHeader`=페이지 머리, `CdTable`=자체 카드, `CdSplitPane`=패널이 카드, 오버레이 3종). 규칙 문서(conventions) §2 에도 명시.

## Re-sync risks
- `pkg/ds.css` 는 앱 전체 Tailwind 유틸리티를 포함(약 136KB) — 앱 코드가 바뀌면 buildCmd 재실행 필요.
- `next-link` 대체 모듈은 prefetch·client 라우팅을 흉내내지 않는다(디자인 렌더용).
- 폰트: CSS 가 Inter·Noto Sans KR·Pretendard·Malgun Gothic 순으로 지정하지만 앱은 웹폰트를 싣지 않는다(UI 기준: 폰트 다운로드 추가 금지). **사용자 결정(2026-09-16): 시스템 글꼴 대체를 수용한다** — 디자인 렌더가 실제 직원 화면(맑은 고딕 등)과 같아야 하므로 웹폰트를 싣지 않는다. `[FONT_MISSING]`(Inter·Pretendard·Pretendard Variable) 경고는 이 결정에 따른 알려진 경고다.

## 재동기화 절차 (첫 업로드 2026-09-17, 프로젝트 `MCM cdash` e8a1a0a1-9597-4f05-931b-7bc32ac81f34)
1. `frontend/` 에서 스크립트 재배치: 스킬 base 의 `package-build.mjs package-validate.mjs package-capture.mjs resync.mjs lib storybook` 을 `.ds-sync/` 로 복사 → `(cd .ds-sync && npm i esbuild ts-morph @types/react playwright@<캐시 chromium 에 맞는 버전>)`.
2. 사전 빌드: `node .design-sync/build.mjs` (Tailwind CSS + 선언 파일).
3. 원격 기준 파일을 `DesignSync get_file _ds_sync.json` → `.design-sync/.cache/remote-sync.json` 저장.
4. `node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules ./node_modules --entry ./.design-sync/pkg/index.ts --out ./ds-bundle --remote .design-sync/.cache/remote-sync.json`
5. 판정 대기분만 캡처 시트를 보고 채점 → 업로드는 원자적 경로(finalize_plan 쓰기 전체, deletes 는 `.sync-diff.json` upload.deletePaths 그대로).
- 업로드 localDir 은 절대경로(`.../frontend/ds-bundle`)로 넘겼다(세션 cwd 가 다른 체크아웃이었음).
- 인증: 데스크톱 앱 세션은 `/design-login` 불가 → 터미널 `claude`(설치 경로 `%USERPROFILE%/.local/bin/claude.exe`, PATH 미등록 주의)에서 `/design-login` 1회.
