# KESI Precision 정리 작업 — MCM 프론트엔드

기준: KESI Precision 디자인 시스템(Claude Design System 아티팩트, 2026-10-27 초판). 정본 토큰은 `components/cdash`.
도구: `frontend/scripts/ds-lint.mjs`(읽기 전용), `frontend/scripts/ds-codemod.mjs`(기본 dry-run).

## 현황 (2026-10-27, app/ + components/ 1,220 파일)

| 규칙 | 건수 | 처리 |
|---|---:|---|
| R1 글자 크기 스케일 밖 (30종 → 7종) | 1,192 | codemod C1 |
| R2 굵기 700 이상 | 1,617 | codemod C2 (`--weights`) — 시각 변화 큼, 모듈별 확인 |
| R3 반경 8px/pill 밖 | 1,470 | codemod C3 |
| R7 `--cd-danger` 미정의 → 폴백 `#FA896B` 가 실제 색 | 153 | codemod C4 — **최우선**, 빨강이 두 종류 |
| R6 hex 리터럴 | 1,465 | 수동. WeatherWidget·weather-night 696건은 일러스트 SVG → 제외 대상으로 분류 |
| R12 인라인 style 색·크기·간격 | 1,223 | 수동 (billing/* 섹션에 집중) |
| R8 서브픽셀 패딩 `py-[9.5px]` 등 | 344 | 수동: `h-9 py-0` / `h-8 py-0`. finance/* 에 133건 |
| R9 `<table>` 직접 작성 | 176 | 수동: `CdTable` 전환 (CdTable 현재 사용 0건) |
| R11 uppercase·tracking | 169 | 수동, FacilityDetailPanel 72건 |
| R4 카드·버튼 그림자 | 80 | 수동 |
| R5 팔레트 클래스 | 85 | 수동 |

## 진행 기록

- **2026-10-27 1단계(기반) 완료** — 브랜치 `claude/kesi-precision-ds`
  - 글꼴: `public/fonts/PretendardVariable.woff2` + `globals.css` `@font-face`·스택, `cdash.css` 스택. `middleware.ts` matcher 에 `woff2` 제외 추가(로그인 화면에서 글꼴 401 방지).
  - 주 버튼: `--cd-primary-fill/-edge/-hover`(라이트·다크), `.cd-btn-primary` 단색+테두리, 굵기 500. `--cd-action-background(-soft)`는 단색 별칭.
  - 그라데이션 제거: 선택 칩·탭 공통 선택 면(단색 10%), 라이트 베이지 바탕(단색 `#f9f6f0`).
  - 굵기: 밑줄 탭 선택 600→500, 태그 칩 선택 700→600.
  - C4 전체 적용(54개 파일 210줄) — `--cd-danger` 0건.
  - 남은 것: 홈 위젯 장식 hex(`#6A83EF`·`#8E86EE`, ApprovalPendingCard·InvoiceInboxCard·LeaveGaugeCard), 좌측 내비 현재 항목 굵기, `survey/NoticeCanvas` 캔버스 글꼴 스택(이미지 출력이라 보류).

## 순서 (모듈 단위, 한 번에 하나)

1. **C4 전체 적용** — 위험 없음(미정의 토큰 교체). `node scripts/ds-codemod.mjs --only C4 --write`
2. **계약 관리** `app/(app)/contracts` + `components/contracts` (50 파일, 1,374건)
   - `node scripts/ds-codemod.mjs --module "app/(app)/contracts" --module components/contracts --weights --write`
   - 화면 확인 → 남은 R6/R12/R9 수동 → `node scripts/ds-lint.mjs --module … --strict` 통과
3. **시설** `components/facilities` + `app/(app)/facilities` (FacilityDetailPanel 4,421줄 — 분할 검토)
4. **결재** `components/approval`
5. 재무 → 영업 → 급여 → 홈 위젯 → 나머지

## 수동 작업 규칙 요약

- 글자색은 `cd-text` / `cd-text-muted` 둘. 세 번째 회색 금지.
- 상태색은 `cd-error-text` `cd-warn-text` `cd-success-text` + `cd-pill-*`. `cd-pill-violet`·`cd-pill-teal` 은 상태 이름으로 치환.
- 컨트롤 높이는 `h-9`(36) / `h-8`(32) 고정, 패딩으로 맞추지 않는다.
- 표는 `CdTable`. 이미 카드 안이면 `bare`.
- 그림자는 `CdModal`·`CdDrawer`·`CdDropdown`·토스트가 자체 처리. 카드에 `shadow-*` 금지.
- 글자 크기 클래스는 당분간 `text-[11px]` 식 px 유지(닫힌 집합). 이후 cdash 에 `.cd-meta .cd-table .cd-compact .cd-body .cd-section .cd-title .cd-number` 유틸을 추가해 치환.

## CI

`package.json` scripts 에 추가 권장:
```
"lint:ds": "node scripts/ds-lint.mjs --by-file",
"lint:ds:strict": "node scripts/ds-lint.mjs --strict"
```
모듈 정리가 끝날 때마다 해당 모듈을 `--strict` 대상에 추가.

## 2026-10-27 확정 사항 (오후)

1. **글꼴: Pretendard Variable** — 2026-09-16 "웹폰트 미탑재" 결정을 뒤집음. `public/fonts/PretendardVariable.woff2`(1.3.9, SIL OFL, 2.0MB) 추가, `app/globals.css`에
   `@font-face{font-family:"Pretendard Variable";src:url("/fonts/PretendardVariable.woff2") format("woff2");font-weight:45 920;font-display:swap}`
   스택을 `"Pretendard Variable", Pretendard, "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif` 로 (globals.css·cdash.css 두 곳, Inter·Noto Sans KR 제거). `.design-sync/NOTES.md`의 `[FONT_MISSING]` 수용 기록은 폐기.
2. **주 버튼: 깊은 남색 단색** — 블루→바이올렛 그라데이션(`--cd-action-background`) 폐기. cdash.css에
   `--cd-primary-fill:#3a4fc4; --cd-primary-fill-edge:#2f41a8; --cd-primary-fill-hover:#3346b0;` (다크 `#4a5fd0 / #3e51b8 / #5468d8`)
   `.cd-btn-primary{background:var(--cd-primary-fill);border:1px solid var(--cd-primary-fill-edge);color:#fff}` `:hover{background:var(--cd-primary-fill-hover)}`.
   `--cd-action-background`는 `var(--cd-primary-fill)`로, `--cd-action-background-soft`는 `--cd-primary-soft`로 별칭 처리 후 사용처 정리. 린트 R10이 남은 그라데이션을 잡는다.
