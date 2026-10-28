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

- **2026-10-27 계약 관리 모듈 1차** — `app/(app)/contracts` + `components/contracts`
  - codemod C1·C2·C3(`--weights`) 39개 파일. 이어서 수동: 모달 제목 20→16px(`text-base`, 모달 제목=section), 계약 상세 제목 24→22px,
    그림자(버튼·배지 `shadow-sm` 제거, 드롭다운 `--cd-shadow-popover`, 모달 `--cd-shadow-dialog`), 눈썹 레이블 uppercase·자간 제거,
    `py-[11.5px]`→`py-3`, 스와치 `rounded-[2px]`, 팔레트 → `cd-error-text`·`cd-error-bg`·`cd-warn-text`·`cd-fill-error`·`--cd-overlay`.
  - 린트: R1·R2·R3·R4·R8·R11 0건. 남음 R5 5(전자발행 노란 버튼은 2026-08-24 사용자 요청이라 유지, 미처리 배지 `bg-red-600`), R6 hex 111, R9 `<table>` 4, R12 인라인 style 310.

- **2026-10-27 시설 모듈** — `app/(app)/facilities` + `components/facilities` (11개 파일, 위반 560 → 20) — 브랜치 `claude/precision-facilities`
  - codemod C1·C2·C3(`--weights`) 9개 파일. 수동: 모달 제목 6곳 22→16px(`text-base`), 드롭다운 `--cd-shadow-popover`, 모달 5곳 `--cd-shadow-dialog`, 버튼·칩 `shadow-sm` 제거,
    항목 이름표 72곳 `font-semibold uppercase tracking-wide` → `font-medium`(11px 유지 — 상세 양식 칸 넘침 방지),
    팔레트 → `cd-error-border`·`cd-warn-text`·`cd-warn-border`·`--cd-overlay`. cdash 에 `.cd-warn-border` 추가(`.cd-error-border` 와 같은 35% 혼합).
    `FacilityListPanel` 토큰 인라인 style → 클래스.
  - `cd-text-faint` 는 `--cd-faint: var(--cd-muted)` 라 이미 muted 와 같은 색 — 클래스 일괄 치환은 전 모듈 마무리 때.
  - 남음: R6 10 + R12 6(`FacilityOrdersModal` 용역 분류색·수금 링 `#9BC2E6`·해지/중지 배지 — 계약 트리 `contracts/page.tsx` 와 같은 값이라 두 곳을 함께 옮길 때 처리),
    R12 계산된 위치·분류색 3, R9 `FacilityQualityPanel` `<table>` 1.
  - PR #53 머지(ea32815c), next:734 배포.

- **2026-10-27 결재 모듈** — `app/(app)/approval` + `components/approval` (79개 파일, 위반 1,271 → 186) — 브랜치 `claude/precision-approval`
  - codemod C1·C2·C3·C5(`--weights`) 49개 파일. 수동: 15px 창·구역 제목 5곳이 14px 로 내려가 `text-base`(16)로 보정, 드롭다운 `--cd-shadow-popover`,
    모달 `--cd-shadow-dialog`, KPI 강조 칸 `shadow-sm` 제거, KPI 이름표 `uppercase tracking-wider` 제거·`font-medium`, 모달 `rounded-[24px]` → `rounded-lg`,
    작은 태그형 버튼 `rounded` → `rounded-lg`(버튼 반경 8px 규칙), `text-rose-600` → `cd-error-text`.
  - 인라인 `style={{ color: "var(--cd-error|warning|primary|success|faint)" }}` 71곳 → 같은 색 클래스(한 줄 안에 className 이 있는 경우만, `cd-btn`·`cd-choice` 와 겹친 곳 없음). 여러 줄에 걸친 `cd-btn` 3곳은 특이도 때문에 인라인 유지.
  - 결함 수정: `ApprovalSemanticsBoard` 의 `var(--cd-text-faint, #7C8FAC)` — 정의되지 않은 토큰이라 폴백 hex 가 그려지고 있었음 → `var(--cd-faint)`. 정의된 토큰의 hex 폴백 제거.
  - 그대로 둔 것: `LeaveNoticePreview`(연차사용촉진 고지서 — 인쇄 서식, 흰 종이 고정), `ApprovalDocHead` 문서 제목(21→22px 만),
    R8 `py-[11.5px]` 등 38건(10-21 목록 행 51px 결정과 묶인 값), R9 `<table>` 25, R12 표 열 너비 등 102, R6 21(차트 팔레트·흰 글자·휴무일 빨강 `#EF4444`).
  - PR #54 머지(49def16e), next:735 배포.

- **2026-10-28 재무 모듈** — `app/(app)/finance` + `components/finance` (28개 파일, 위반 506 → 333) — 브랜치 `claude/precision-finance`
  - codemod C1·C2·C3(`--weights`) 17개 파일. 숫자 요약 값 18px → 16px(가장 가까운 단계), `text-lg` 구역 제목 → `text-base`. 그림자·uppercase 는 원래 0건.
  - 상태색: 인라인 `style={{ color: "var(--cd-…)" }}` 34곳 + 조건부 색(음수 금액·대차 일치) 5곳 → 클래스, 오류·경고·안내 상자 7곳 → `cd-error-text cd-error-bg`·`cd-warn-text cd-warn-bg`·`cd-text-primary cd-tint-primary`·`cd-surface-bg`,
    `text-amber-700` 3곳 → `cd-warn-text`, 정의된 토큰의 hex 폴백 제거.
  - 연결 상태 점(`StatusDot`): `#22c55e`·`#f59e0b` + 번짐 그림자 → `--cd-success`·`--cd-warning` 단색.
  - 결함 수정: `ManagementPanels` 합계 행이 클래스 이름인 `var(--cd-tint-primary, rgba(…))` 를 변수로 써서 늘 폴백이 그려지고 있었음 → `cd-tint-primary` 클래스.
    `CardMerchantCorrectionPanel` 주 버튼이 인라인 `background: var(--cd-primary)` 로 남색 단색 규칙을 덮고 있었음 → 인라인 제거.
  - 그대로 둔 것: R8 267(`py-[9.5px]`·`py-[11.5px]` — 10-21 목록 행 +7px 결정 `9ba54a68`), R9 `<table>` 57, R5 2(`SupplyGroupReviewPanel` 문서 이미지 위 영역 표시 — 흰 종이 고정),
    R12 7(`cd-btn` 위 색 1·계산된 크기·로고 흰 바탕).

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
   → 2026-10-28 사용자 요청으로 `#4a63d8 / #3d55c8 / #4259cf`(다크 `#5269dc / #4a5fd0 / #5c72e0`)로 밝힘.
   `.cd-btn-primary{background:var(--cd-primary-fill);border:1px solid var(--cd-primary-fill-edge);color:#fff}` `:hover{background:var(--cd-primary-fill-hover)}`.
   `--cd-action-background`는 `var(--cd-primary-fill)`로, `--cd-action-background-soft`는 `--cd-primary-soft`로 별칭 처리 후 사용처 정리. 린트 R10이 남은 그라데이션을 잡는다.
