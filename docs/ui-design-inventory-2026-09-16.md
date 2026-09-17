# UI 통일 인벤토리 · 클로드 디자인 요청 브리프 — 2026-09-16

FHD 결함 수정([fhd-audit-2026-09-16.md](fhd-audit-2026-09-16.md), main `03046e2`) 다음 단계다.
클로드 디자인(claude.ai/design)에 "페이지별 캡처"가 아니라 **화면 유형별 표준안**을 요청하기 위한 입력 자료다.
기준 문서는 [ui-precision-standard.md](ui-precision-standard.md)이며, 이 문서는 그 기준을 바꾸지 않는다.

## 0. 사용자 결정 (2026-09-16)

| # | 결정 | 적용 해석 |
|---|---|---|
| U-1 | **변경 제외 화면**: 계약 관리 `/contracts`, Dashboard `/contracts/dashboard`, 수주/수금/발행 현황 `/contracts/billing`, 영업 상세 `/sales/[projectId]` | 카드 배치·차트·표 구성·화면별 코드는 손대지 않는다. 공통 토큰은 U-6에 따라 적용 |
| U-2 | 방향은 **통일성·깔끔함** 우선 | 새 장식·새 배치보다 반복 규칙 정리 |
| U-3 | **단색 버튼은 모두 흰색**, 블루·보라 그라데이션 버튼은 유지 | 흰 바탕 + 1px 중립 경계 + 본문색 글자(`cd-btn` 기본형). 주요 동작만 그라데이션. 토글의 선택 상태는 UI 기준 §4의 **옅은 선택 그라데이션**(7→14% + 블루 테두리·글자) |
| U-4 | **글자 크기 통일 규칙** 필수 | 5절 척도 **확정**: 22/16/14/13/12/11 |
| U-5 | 카드·입력·버튼 **반경 8px → 12px** | 기존 UI 기준 P02·버튼 반경 지시(8px)를 대체. `ui-precision-standard.md`·CLAUDE.md 문구는 실제 적용 커밋과 함께 갱신한다(먼저 바꾸면 다른 세션이 일부 화면에만 12px을 적용해 불일치가 생김) |
| U-6 | 제외 화면에도 공통 토큰(반경 12px·흰 버튼·글자 척도)은 적용 | 배치만 고정. 범위 지정 CSS로 옛 값을 되돌리지 않는다 |
| U-7 | 뱃지·태그·아바타·카운트·체크박스·아이콘 버튼·탭·입력·표 등 콘텐츠 요소를 **베이지 앱 바탕 위에 직접 두지 않는다** (2026-09-17) | 흰 카드(`cd-card`) 안에 넣는다. 베이지는 카드 사이 여백과 페이지 헤더 영역에만 노출. 기존 화면 중 요소가 바탕에 직접 놓인 곳은 통일 작업에서 카드로 감싼다 |

## 1. 방법과 한계

- 기준 소스: origin/main `289ea99`, `frontend/app/(app)` 라우트 97개(동적 포함), 컴포넌트 296개.
- 모두 **소스 정적 집계**다. 선언 횟수이지 화면에 보이는 결과가 아니다. 특히 반경은 공통 CSS(`!important`·선언 순서)가 덮어쓸 수 있어 렌더 실측으로 확인해야 한다.
- 화면 유형은 페이지가 쓰는 보드 컴포넌트의 신호(차트·표·분할 그리드·입력 수·편집기)로 **자동 분류한 초안**이다. 디자인 요청 전에 사람이 검토한다.

## 2. 화면 유형 (자동 분류 초안)

| 유형 | 수 | 라우트 |
|---|---|---|
| A 대시보드·지표 | 9 | `/home`, `/contracts/dashboard`, `/admin/ai-usage`, `/approval/analytics`, `/approval/insights`, `/approval/metrics`, `/approval/leave`, `/approval/my-hr`, `/payroll/my` |
| B 목록 + 상세 분할 | 22 | `/contracts`, `/contracts/downloads`, `/facilities`, `/facilities/missing/industry`, `/admin/users`, `/admin/users/registry`, `/admin/company-profile`, `/approval`, `/approval/attendance`, `/approval/holidays`, `/approval/leave-promotion`, `/approval/semantics`, `/data/review`, `/data/settings`, `/data/status`, `/files/personal`, `/mail`, `/sales/bids/package`, `/sales/bids/sources`, `/sales/intel`, `/sales/intel/sources`, `/sales/rag` |
| C 표 중심 목록 | 27 | `/sales`, `/sales/bids`, `/sales/contacts`, `/finance`, `/payroll`, `/payroll/contracts`, `/payroll/yearend`, `/payroll/my-yearend`, `/staffing`, `/staffing/evaluations`, `/staffing/statements`, `/approval/archive`, `/approval/records`, `/approval/certificates`, `/approval/leave-types`, `/approval/semantic-concepts`, `/assets`, `/contracts/filings`, `/directory`, `/facilities/missing`, `/files`, `/rules`, `/survey/internal`, `/survey/external`, `/admin/access-log`, `/admin/recruit`, `/trash` |
| D 입력 폼·설정 | 10 | `/approval/quote`, `/approval/quote/settings`, `/approval/settings`, `/approval/policies`, `/payroll/settings`, `/contracts/agreements`, `/facilities/new`, `/board/write`, `/mail/compose`, `/survey/internal/[surveyId]/respond` |
| E 문서 작성·편집기 | 8 | `/work-plan`, `/work-plan/exec`, `/work-plan/oversight`, `/work-plan/new`, `/work-plan/[reportId]`, `/approval/draft`, `/approval/forms`, `/approval/letter` |
| F 카드·보드·기타 | 21 | `/board`, `/board/[postId]`, `/calendar`, `/contracts/billing`, `/contracts/deliverables`, `/contracts/deliverables/templates`, `/contracts/agreements/templates`, `/admin/recruit/templates`, `/admin/recruit/[postingId]`, `/assets/reservations`, `/approval/my-attendance`, `/approval/my-leave`, `/facilities/merge`, `/rules/admin`, `/sales/[projectId]`, `/survey/*/[surveyId]`, `/survey/notices`, `/survey/notices/[noticeId]`, `/work-plan/merge`, `/work-plan/present` |

## 3. 공통 패턴 불일치

| 영역 | 현황(선언 수) | 기준과의 차이 | 통일 방향 후보 |
|---|---|---|---|
| 페이지 루트 래퍼 | 표준형 `flex h-full min-h-0 flex-col gap-5 p-4 md:p-5` 41곳 / `min-h-screen p-6` 17곳 / `p-2` 5곳 / 그 외 10여 변종 | 셸 안에서 `min-h-screen`은 높이·스크롤 규약이 다르고 여백이 16~24px로 갈린다 | 유형별 루트 래퍼 1종(목록·분할은 `h-full`, 문서형은 `min-h-full`) |
| 주요 버튼 | `cd-btn-primary`(블루·보라 그라데이션) 185 / `cd-fill-primary`(단색 `#4a63d8`) 156 / `CdButton` 166 | 소스상 주요 동작 채움이 **두 정의**(`cdash.css:207` 단색 / `--cd-action-background` 그라데이션)로 갈린다. `cd-fill-primary`는 선택 토글 채움에도 쓰여 용도가 섞여 있다. 화면별 렌더 확인 필요. 기준 §6은 그라데이션을 주요 동작 색으로 지정 | **U-3**: 단색 채움 버튼 → 흰 버튼, 그라데이션은 유지. 선택 상태 표시용 단색 채움은 §4의 옅은 선택 그라데이션으로 |
| 표 | `cd-table` 121 / 날 `<table>` 122 / `CdTable` 컴포넌트 0 | 헤더 40px·행 44px·숫자 우측 정렬 규칙(P06·P07)이 날 표에는 보장되지 않는다 | 표 기본형 1종 + 밀집형 1종 |
| 모달 | `CdModal` 50 / 직접 `fixed inset-0` 57 / `cd-modal-overlay` 9 | 가림막 색(24% 기준 vs `bg-stone-950/20` 등)·포커스 가두기·Escape 처리가 방식마다 다를 수 있다(P11·§4) | `CdModal` + 폭 preset(sm/md/lg/문서 1032) |
| 탭·선택 버튼 | `CdTabs` 9 / `cd-choice` 직접 101 | 연결형·밑줄형·토글 묶음이 화면마다 따로 구현 | 탭 3종(연결·밑줄·세그먼트) |
| 입력 | `cd-input` 784·`cd-select` 309 직접 / `CdInput` 등 60 | 라벨·필수 표시·오류 문구 위치가 화면마다 다르다 | 필드 래퍼 1종(라벨·도움말·오류) |
| 글자 크기 | 임의 px 약 2,850: `11px` 1,295·`10px` 417·`12px` 401·`13px` 220·`10.5px` 188·`11.5px` 157·`12.5px` 137·`9px` 29 | 기준 P05·P06 척도(22/16/14/13/12/11)에 없는 10.5·11.5·12.5px, 판독 하한 아래 9~10px | **U-4**: 5절 척도로 수렴 |
| 반경 선언 | `rounded-xl` 671·`rounded-lg` 603·`rounded-2xl` 354·`rounded-3xl` 234(이 중 `cd-card`와 함께 146) | 기준은 카드·입력·버튼 8px(→ **U-5로 12px**). 버튼은 전역 `!important`로 고정되지만 카드는 선언 순서에 좌우 → **렌더 실측 필요** | 개별 `rounded-*` 제거, `--mcm-action-radius`·`--precision-ui-radius-card` 토큰 12px만 사용 |
| 색 | hex 1,367회(데이터 색·문서 서식 포함) / Tailwind 팔레트색 64회 | `--cd-*` 토큰 밖 색. 일부는 §6 예외(차트·지도·문서) | 예외 목록 외는 토큰으로 |
| 그림자 | `shadow-*` 144 | 카드 그림자 금지(P02), 팝업·시트만 허용 | 팝업류 외 제거 |

## 4. 클로드 디자인 요청 브리프

`/design-sync`로 `frontend/components/cdash/`(토큰·컴포넌트)를 디자인 시스템 프로젝트에 올린 뒤, 아래 조건으로 요청한다.

**요청:** 화면 유형 A~F별 표준 템플릿 1장씩과, 3절 공통 패턴의 표준 컴포넌트 명세(버튼·표·모달·탭·필드·글자 척도).

**반드시 지킬 제약** (CLAUDE.md·UI 기준에서):
0. **U-1 제외 화면 4개는 요청 범위에서 뺀다.**
1. 기존 구조 보존 — 트리뷰·상세 양식·카드 수와 위치·분할 비율·탭·표 열·스크롤 부모를 바꾸지 않는다. 허용 예외는 계약 대시보드·영업 상세의 FHD 하단 재배치 두 건뿐(§7).
2. Sidebar 248px / 레일 76px / 드로어 구조와 메뉴 순서 유지.
3. 무광 불투명 면, 1px 중립 경계, 카드·입력·버튼 **12px**, 카드 그림자·blur·배경 그라데이션 금지. 밝은 앱 바탕 베이지 그라데이션과 주요 버튼 블루·보라 그라데이션은 유지. **단색 채움 버튼은 흰 버튼으로.**
4a. 글자 크기는 5절 척도 외 값을 쓰지 않는다.
4. `--cd-*` 토큰만 사용. Light/Dark 모두 설계.
5. 긴 설명은 `CdHelp`의 `?`로, 오류·필수·저장 상태·실행 영향은 화면에 남긴다.
6. 날짜 입력은 `CdDateInput`(YYYYMMDD 정규화) 유지.

**FHD 실사에서 얻은 레이아웃 규칙** (분할 화면 표준에 반영):
- 본문 가용 폭은 FHD 1624px. 분할 좌측은 고정 px이 아니라 `clamp(최소, 비율, 최대)`.
- 분할 안쪽 컴포넌트는 뷰포트가 아니라 **자기 칸 폭**에 맞춰 열 수가 바뀌어야 한다(Tailwind 브레이크포인트는 뷰포트 기준이라 넓은 화면에서 좁은 칸에 다열이 켜지는 함정). 칸별 최소폭 + `flex-wrap` 또는 컨테이너 쿼리(현재 미도입, 도입은 별도 승인).
- 검증 해상도: 1280·1440·1600·1920·2560 + 390.

**넘길 첨부:** 이 문서, `fhd-audit-2026-09-16.md`, 유형별 대표 화면 FHD 스크린샷(A `/approval/insights`, B `/facilities`, C `/approval/records`, D `/approval/quote/settings`, E `/work-plan`, F `/calendar`). 제외 화면(U-1)은 대표로 쓰지 않는다.

## 5. 글자 크기 척도 (U-4 확정)

현재 소스: `text-xs`(12px) 1,269 · `text-sm`(14px) 1,237 · 임의 px 약 2,850(`11px` 1,295 · `10px` 417 · `12px` 401 · `13px` 220 · `10.5px` 188 · `11.5px` 157 · `12.5px` 137 · `9px` 29) · 그 외 `text-base/lg/xl/2xl/3xl` 110.

기존 UI 기준 P05·P06 값을 그대로 척도로 고정한다.

| 토큰 | 크기 | 용도 |
|---|---|---|
| `title` | 22px (모바일 20) | 페이지 제목 |
| `section` | 16px | 카드·섹션 제목 |
| `body` | 14px | 본문, 목록 항목 제목 |
| `control` | 13px | 버튼·입력·탭, FHD(≥1600) 표 본문 |
| `table` | 12px | 표 본문(1600 미만)·보조 설명·표 헤더 |
| `meta` | 11px | 라벨·배지·타임스탬프 — **하한** |

- 대시보드 KPI 숫자만 예외(24~32px, 별도 `display` 1단계).
- 이관 규칙: `9px`·`10px`·`10.5px` → 11 / `11.5px` → 12 / `12.5px` → 13. 634곳이 커지므로 밀집 영역(배지·달력 칸·카드 메타)은 FHD 실사 재측정으로 잘림을 확인한다.

## 6. 진행 순서

1. 이 인벤토리의 유형 분류·통일 방향 검토(사용자).
2. `/design-sync` — 사용자가 시작. cdash 토큰·컴포넌트를 디자인 시스템 프로젝트로 동기화.
3. 클로드 디자인에 4절 브리프로 요청 → 유형 템플릿·컴포넌트 명세.
4. "Send to local coding agent"로 클로드 코드에 전달 → 토큰·공통 컴포넌트 먼저, 그다음 유형별 적용. 화면 구조 변경이 섞이면 적용 전 사용자 승인.
5. `/design-sync` 재실행 + FHD 실사 재측정으로 정합성 확인.
