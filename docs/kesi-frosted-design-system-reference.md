# KESI Frosted 디자인 시스템 (MCM 공식, 2026-10-28 · 최종 수정 2026-10-29)

> 원본: Claude 앱 Design System 아티팩트(비공개). 이 파일은 GPT 등 외부 도구 공유용으로 본문·컴포넌트 규칙·토큰을 한 파일로 묶은 사본이다.

## 목차
1. 본문(원칙·구성 규칙)
2. 컴포넌트 규칙 (Shell · PageHeader · Card · Table · Field · KpiStrip · Button · StatusPill · Tabs · NoticeGroup)
3. 토큰(tokens.json)

---
# 1. 본문

(주)에코씨앤엠의 업무용 웹 플랫폼 — MCM 그룹웨어, ESG 플랫폼, 통합허가 플랫폼 — 이 공유하는 디자인 시스템이다. 2026-10-28 shadcn 결정판(C Frosted Shell)으로 **KESI Precision(2026-10-27)을 대체**한다. 정본은 MCM `components/cdash`의 토큰(`precision-tokens.css`, `cdash.css`)이며, 이 문서는 그 토큰을 **닫힌 스케일**과 **구성 규칙**으로 묶는다.

Precision에서 바뀐 것은 여섯 가지다. 반경 8→**10**, 카드에 **1단 부드러운 그림자**, 사이드바·상단 바에 **글라스**, 데스크톱 셸 바탕에 **은은한 그라데이션과 빛 두 점**, 페이지 탭은 **세그먼트형**, 카드 안·카드 사이·섹션 사이 **여백 확대**(16→20, 24→32). 주 버튼은 한 단계 밝힌 남색 `#4a63d8`이고, 사이드바는 카테고리를 접지 않고 **대메뉴를 늘 보인다**(소메뉴만 접힘, 2026-10-29). 나머지 규칙(닫힌 글자 스케일, 색은 상태에만, 카드 안 카드 금지, KPI 타일 금지)은 그대로다.

### 원칙

1. **셸은 유리, 콘텐츠는 흰 면.** 글라스(반투명 + blur)는 사이드바와 상단 바, 그라데이션은 데스크톱 셸 바탕에만 쓴다. 카드·표·입력·모달은 언제나 불투명 `surface`다. 효과는 화면의 가장자리에만 있고 작업 대상에는 없다.
2. **색은 상태에만.** 성공·주의·오류·선택 — 이 넷이 색을 가질 수 있는 전부다. 카테고리, 아이콘, 카드 머리, 숫자 타일에 색을 배정하지 않는다.
3. **한 화면에 강조 하나.** 주 버튼(`primary-fill` 남색)은 화면당 하나. 나머지 동작은 ghost/soft다.
4. **위계는 굵기 아닌 크기와 색으로.** 굵기는 400·500·600 세 단계뿐이다. 700 이상은 UI에 없다.
5. **스케일 밖의 값은 없다.** 글자 크기 8단계, 간격 4px 그리드, 반경 10px/pill. `text-[11.5px]`, `py-[9.5px]`, `rounded-2xl` 같은 임의값은 린트가 거부한다.

### 구성 규칙

#### 셸: 바탕·사이드바·상단 바

- **바탕(라이트, 데스크톱)**: `linear-gradient(160deg, shell-from 0%, shell-mid 55%, shell-to 100%)` 위에 흐린 빛 두 점 — 좌상단 `shell-glow-cool`(520×420, 불투명도 .45, blur 90px), 우하단 `shell-glow-warm`(560×460, .5, blur 100px). 빛 점은 셸 안에 가둔다(`position:absolute; z-index:-1`, 셸은 `position:relative; overflow:clip; isolation:isolate`). 화면 밖으로 번지는 `position:fixed`는 쓰지 않는다.
- **다크·인쇄·모바일(/m)·로그인**: 단색 `canvas`. 빛 점 없음.
- **사이드바**: `glass` + `glass-border` 1px + `radius`, `backdrop-filter: blur(18px) saturate(1.3)`. 펼친 폭 `sidebar-width`(248px), 레일 `sidebar-rail-width`(76px). 드로어(좁은 화면)는 불투명 `surface`.
- **상단 바**: `glass-bar` + `glass-border` + `radius`, `blur(16px)`, 높이 `topbar-height`. 검색·알림·프로필 셋까지만 둔다. 관리 기능은 프로필 메뉴나 사이드바 "설정" 아래로.
- `prefers-reduced-transparency: reduce`와 인쇄에서는 글라스를 불투명(`surface`, blur 없음)으로 바꾼다.

#### 사이드바 메뉴 구조

- 메뉴는 **카테고리 → 대메뉴 → 소메뉴** 세 단계다(카테고리 예: 협업·업무·사업 운영·관리).
- **카테고리는 접지 않는다.** 카테고리는 `meta` `ink-muted` 고정 라벨이고, 그 아래 대메뉴는 어느 화면에서든 늘 보인다(2026-10-29 사용자 결정 — 현재 카테고리만 펼치던 10-28 방식은 다른 카테고리 메뉴가 숨어 불편해 철회).
- 접고 펼치는 것은 **대메뉴의 소메뉴뿐**이다. 화면을 옮기면 **현재 대메뉴의 소메뉴만 펼치고 다른 대메뉴의 소메뉴는 접는다**. 다른 대메뉴는 눌러서 잠시 펼칠 수 있지만, 펼침 상태는 저장하지 않아 다음 이동 때 다시 접힌다. 대메뉴 버튼은 `aria-expanded`를 가진다.
- 레일(76px)에서는 카테고리 라벨 대신 구분선을 두고 모든 대메뉴 아이콘을 보인다.
- 현재 항목은 `sidebar-selected` 바탕 + `sidebar-selected-ink` 글자. 왼쪽 색 막대, 아이콘 배경, 굵기 변경은 하지 않는다. 항목 글자 `body`(14px) 400, 그룹 머리 `meta` `ink-muted`.

#### 면과 카드

- 카드는 `surface` 바탕 + `card-border` 1px + `radius`(10px) + `shadow-card` 1단 그림자. 배경 그라데이션·blur·반투명 없음.
- **카드 안 카드, 모달 안 카드는 그림자가 없다.** 그림자는 바탕 위에 놓인 첫 겹에만.
- 카드는 **콘텐츠 그룹** 단위다(한 표, 한 폼 섹션, 한 요약). 카드 안에 카드를 넣지 않는다. 리스트의 개별 항목은 카드가 아니라 **행**이다 — 행은 `border` hairline으로만 나눈다.
- 카드 상단·좌측에 색 막대(accent border)를 두지 않는다. 카드 머리에 아이콘 배경 원·사각을 두지 않는다.
- 떠 있는 것은 각자의 그림자: 드롭다운·팝오버·토스트 `shadow-popover`, 모달 `shadow-dialog`, 드로어 `shadow-sheet`, 끌어 옮기는 카드 `shadow-raised`.

#### 숫자 요약 (KPI)

- **타일 금지.** 색 아이콘 + 레이블 + 큰 숫자로 된 카드를 가로로 늘어놓지 않는다.
- 요약은 `KpiStrip` 한 줄로 쓴다: 레이블(`table`, `ink-muted`) 위에 숫자(`number`)가 오는 묶음을 한 카드 안에 가로로 두고, 묶음 사이는 `border` 세로 hairline으로만 나눈다. 묶음은 최대 4개, 높이는 72px 이내.
- 숫자의 색은 그 숫자가 **경고(`warning`)·오류(`danger`)** 를 뜻할 때만 바뀐다. 나머지는 `ink`.

#### 상태·알림

- 상태 필(`StatusPill`)은 한 행에 하나. 필의 글자는 상태명 한 단어다(`경고`, `승인`, `반려`).
- 같은 레벨의 알림이 여러 줄이면 **그룹 머리 한 번**("경고 6건")과 행 목록으로 쓴다(`NoticeGroup`).
- 색만으로 상태를 전하지 않는다 — 항상 단어가 함께 있다.
- 숫자 배지는 `surface-sunken` 바탕에 `ink-muted` 글자다. 빨간 배지는 "미처리"에만.

#### 탭과 필터

- 화면·모달의 **내용을 통째로 바꾸는** 페이지 탭 → `Tabs` **segment**(기본값). 묶음은 카드와 같은 `surface` + `card-border` + `shadow-card` + `radius`, 안쪽 패딩 4px·탭 사이 2px, 안쪽 탭은 `radius-tab-inner`(7px)·높이 32px·`padding 6px 14px`. 선택 탭은 `tab-selected` 바탕 + `tab-selected-ink` 글자, 테두리 없음. 비선택은 `ink-muted`, hover `surface-sunken`.
- 묶음은 내용 폭(`width: fit-content`)이고 한 줄을 유지한다(`flex-wrap: nowrap`, 넘치면 가로 스크롤·스크롤바 숨김, `flex-shrink: 0`). 767px 이하에서만 줄바꿈을 허용한다. 카드·모달 안에 놓이면 그림자를 뺀다.
- 카드 안에 붙은 섹션 전환 탭은 `Tabs` **underline**(선택 = `primary` 글자 500 + 2px 밑줄)을 명시해 쓸 수 있다.
- 같은 목록을 **좁히는** 컨트롤은 필터다 → `Tabs` **pill**. 카드 안, 페이지 탭 아래.
- 폴더 모양 탭, 칩으로 만든 페이지 탭, 한 화면에 세그먼트 두 줄은 쓰지 않는다.

#### 표

- `surface` 위에서 읽는다. 머리글 행은 `surface-sunken` 바탕, `table-header-height`(40px), 글자 `table` 500 `ink-muted`.
- 본문 행은 `table-row-height`(51px), 글자 `compact` 또는 `table`. 가로 hairline(`border`)만 긋고 세로선은 없다.
- 숫자는 오른쪽 정렬 + `tabular-nums`. 단위는 머리글에 한 번만.
- 선택 행 `row-selected`, hover `surface-sunken`. 행 안 동작 버튼은 `control-height-sm`(32px) ghost.

#### 타이포그래피

- 크기는 `number`(24) `title`(22) `section`(16) `body`(14) `compact`(13) `table`(12) `meta`(11) — 이 스타일 밖의 크기는 없다.
- 굵기: 400 본문, 500 레이블·이름·강조, 600 제목. 700·800·900은 쓰지 않는다.
- 자간은 제목(`title`, `number`)에만 -0.01em. 대문자 변환과 넓은 자간은 쓰지 않는다.
- 글자색은 `ink`와 `ink-muted` 둘뿐이다(상태색 제외).
- 글꼴은 **Pretendard Variable** 하나다. `fonts/PretendardVariable.woff2`(1.3.9, SIL OFL)를 `font-display: swap`으로 싣고, 스택은 `sans`. 숫자는 `tabular-nums`.

#### 여백과 행간 — 빡빡함을 없애는 규칙

AI가 급히 만든 화면은 모든 틈이 8~12px로 같고, 카드 안 글자가 테두리에 붙고, 설명문이 한 줄 높이 그대로 쌓여 답답하다. 이 시스템은 **표·목록 안은 밀도를 유지하고, 그 바깥(셸·머리글·카드 사이·카드 안 여백)은 넓힌다.**

- **4px 그리드, 거리로 관계를 말한다.** 관련 요소 `space-2`(8) → 그룹 안 `space-3`~`space-4`(12~16) → 카드 사이 `space-5`(20) → 섹션 사이 `space-section`(32). 한 단계씩 벌어져야 묶음이 보인다. 모든 틈이 같으면 그룹이 사라진다.
- **콘텐츠 바깥 여백** `content-padding`(32px), 셸 가장자리·사이드바·상단 바 사이 `space-4`(16px). 콘텐츠 최대 폭 `content-max-width`.
- **카드 안 여백** `space-card`(20px). 카드 머리(제목 줄)와 본문 사이 `space-3`(12). 표 카드는 머리글 줄에만 20px을 주고 표는 가장자리까지.
- **머리글 → 첫 카드** `space-section`(32px). 머리글 제목과 메타 사이 `space-1`(4), 머리글과 세그먼트 탭 사이 `space-5`(20).
- **행간**(2026-10-29 넓힘 — 목록·메뉴가 빡빡하다는 사용자 요청으로 본문 계열을 2px씩): 한 줄 레이블·표 셀은 `body` 14/22, 두 줄 이상 이어지는 설명·안내·빈 상태 문장은 `prose` 14/24(약 1.71). `compact` 13/20, `table` 12/18. 제목 22/28, 카드 제목 16/24. 메타 11/16. 글자를 줄이는 대신 줄 수를 줄인다.
- **목록 항목 사이**: 행으로 나누지 않는 목록(`ul`·`ol`)은 항목 사이 `space-2`(8). 한 줄 한 항목으로 길게 이어지는 검사·알림 목록은 `space-3`(12).
- **문단 폭**: 설명문은 한 줄 70자(약 640px) 안팎에서 끊는다. 화면 폭 전체로 늘어진 한 문단은 읽히지 않는다.
- **폼**: 레이블–입력 `space-2`(8), 행 사이 `space-4`(16), 폼 섹션 사이 `space-section`(32) + `section` 제목. 두 열은 한 열이 240px 이상일 때만.
- **사이드바**: 항목 높이 `nav-item-height`(38), 항목 사이 `space-1`(4), 하위 항목 34, 그룹 사이 `space-4`(16).
- **밀도는 표에만.** 표 행 `table-row-height`(51), 머리글 40, 셀 가로 패딩 `space-3`(12). 표 행을 더 줄여 한 화면에 더 넣으려 하지 않는다.
- 컨트롤 높이는 `control-height`(36px)로 **고정**한다. 패딩으로 높이를 맞추지 않는다.
- 어긋남 점검: 카드 안 글자가 테두리에서 16px 미만이면, 카드 사이가 16px 미만이면, 설명문 줄 간격이 22px 미만이면, 목록 항목이 4px 이하로 붙어 있으면 틀린 것이다.

#### 반경

- `radius`(10px): 버튼, 입력, 탭 묶음, 카드, 모달, 드로어, 필터, 사이드바, 상단 바. `radius-tab-inner`(7px): 세그먼트 묶음 안쪽 탭만. `radius-pill`: 상태 필, 아바타, 스위치. `radius-xs`(2px): 체크박스·스와치.
- 한 화면에 8px·10px·12px 모서리가 섞이면 틀린 것이다. MCM에서는 Tailwind `rounded-lg`가 `var(--radius)`이고, 모든 동작 버튼의 반경은 `--mcm-action-radius`(10px)로 고정된다.

#### 버튼

- 주 버튼: `primary-fill`(#4a63d8) 채움 + `primary-fill-edge` 1px 테두리, 글자 흰색, hover `primary-fill-hover`. **화면당 하나.** 그라데이션·그림자·hover 시 떠오르는 효과 없음.
- 보조 동작: ghost(테두리 `border`, 글자 `ink`) 또는 soft(`primary-soft` 바탕, 글자 `primary-strong`). 위험 동작: `danger` 채움 — 확인 모달 안에서만.
- 버튼 글자는 `compact`(13px) 500. 아이콘은 16px, 글자 앞, `space-1` 간격. 아이콘만 있는 버튼은 36×36 ghost에 `aria-label`.
- 포커스는 `focus-ring`(outline 아님).

#### 폼

- 레이블은 입력 위, `table`(12px) 500 `ink-muted`, 입력과 `space-2`(8px). 필수 표시는 레이블 뒤 `danger` `*`.
- 입력은 `surface` 바탕 + `border-strong` 1px + `radius`, 높이 `control-height`, 글자 `compact`. 포커스 시 테두리 `primary` + `focus-ring`.
- 날짜는 `YYYY-MM-DD` 텍스트 입력(`YYYYMMDD` 입력 시 자동 하이픈). 네이티브 `type="date"`는 쓰지 않는다.

#### 아이콘·모션

- lucide, 16px(표·버튼 안)·20px(내비·빈 상태), stroke 1.5. 색은 옆 글자와 같다. 아이콘 뒤 색 배경 없음. 이모지 없음.
- 전환은 150ms ease. hover·focus·토글·드롭다운 열림·소메뉴 접기에만. 페이지 로드 reveal 애니메이션 없음.

### 글쓰기

- 한국어, 평서형 존댓말("저장되었습니다", "선택하세요"). 느낌표 없음.
- 버튼은 동사형 명사("저장", "새 계약 등록"), 2~6자.
- 숫자는 천 단위 쉼표, 단위는 머리글이나 레이블에 한 번. 날짜 `2026-10-28`, 기간 `2026-08-16 ~ 2027-03-28`.
- 긴 사용법·배경은 `?` 도움말로 옮기고, 오류·필수 입력·저장 상태는 화면에 남긴다.

### 토큰 사용

- 색은 항상 토큰 이름으로 쓴다. 리터럴 hex·팔레트 클래스(`text-rose-600`)·폴백 `var(--x, #…)` 없음.
- 인라인 `style`로 색·크기·간격을 지정하지 않는다. 인라인 style은 계산된 위치(`left`, `width`)에만.
- Tailwind는 레이아웃 접착제(`flex`, `grid`, `gap-3`, `min-w-0`)로만 쓴다. 반경은 `rounded-lg`(=10px)·`rounded-full`만.
- MCM 연결: 이 토큰은 `--precision-*`(HSL 채널) → `--cd-*` 별칭으로 들어간다. 글라스 `--cd-glass(-bar/-border/-blur)`, 그림자 `--cd-shadow`, 카드 테두리 `--cd-card-border`, 탭 `--cd-tab-selected(-text)`, 반경 `--radius`·`--cd-radius-tab-inner`. shadcn 표준 변수 이름(`--primary`, `--accent`)은 기존 클래스와 충돌하므로 `:root`에 두지 않는다. ESG·통합허가 플랫폼도 같은 값을 자기 토큰 파일 한 곳에 두고 같은 의미 이름으로 연결한다.
- 차트: 1계열 `primary`, 2계열 `secondary`, 상태 구분은 `success`/`warning`/`danger`. 그 이상의 계열은 명도(`primary` 100%/55%/30%)로 나눈다.

### 린트가 잡는 것 (요약)

| 금지 | 대신 |
|---|---|
| `text-[Npx]` N ∉ {11,12,13,14,16,22,24} · `text-xs/sm/lg/xl/2xl` | `.meta .table .compact .body .section .title .number` |
| `font-bold` `font-extrabold` `font-black` | `font-medium`(500) · `font-semibold`(600) |
| `rounded-md/xl/2xl/3xl` `rounded-[Npx]` | `rounded-lg`(=`radius` 10px) · `rounded-full` |
| `shadow-sm/lg/xl/2xl` (카드·버튼·입력에) | 카드는 `shadow-card` 하나, 오버레이는 자체 그림자 |
| `backdrop-blur-*` · `backdropFilter` (셸 크롬 밖) | 셸 크롬 클래스(`glass`, `glass-bar`)에만 |
| `bg-gradient-*` (셸 바탕 밖) | `primary-fill` + `primary-fill-edge` · `surface` · `primary-soft` |
| 팔레트 클래스 `*-rose-600` `*-amber-100` … · hex 리터럴 | 상태 토큰 |
| `py-[N.5px]` 등 임의 패딩 | `h-[var(--control-height)]` |
| 한 행에 필 2개 이상 · 카드 안 카드 · KPI 타일 | `StatusPill` 1개 · 행 · `KpiStrip` |

### 컴포넌트

쓰는 순서: `Shell`(바탕·사이드바·상단 바) → `PageHeader`(제목·메타·동작·세그먼트 탭) → `Card`(그룹) → `Table`/폼 `Field`/`KpiStrip` → `Button`·`StatusPill`·`Tabs`·`NoticeGroup`. 각 컴포넌트의 README가 무엇을 넘겨야 하는지와 하지 말 것을 적는다. MCM의 `Cd*` 컴포넌트(`CdPageHeader`, `CdButton`, `CdTable`, `CdTabs`, `CdBadge`, `CdInput`…)와 `AppShell`·`Sidebar`·`TopBar`가 이 규격의 구현이며, ESG·통합허가 플랫폼은 같은 이름·같은 props로 맞춘다.


---
# 2. 컴포넌트 규칙


## Shell

앱 셸. 셸 바탕, 글라스 사이드바, 글라스 상단 바, 본문 영역을 한 틀로 고정한다. 글라스와 그라데이션이 허락되는 유일한 곳이다.

**넘기는 것**: `menu`(그룹 → 항목 목록, 항목마다 `href`·`icon`·`badge?`), 현재 경로(선택 항목과 자동으로 펼칠 소메뉴를 정한다), `topbar`(검색·알림·프로필), `children`(본문).

**바탕**
- 라이트 데스크톱: `linear-gradient(160deg, shell-from 0%, shell-mid 55%, shell-to 100%)` + 빛 두 점 — 좌상단 `shell-glow-cool`(520×420, 불투명도 .45, blur 90px), 우하단 `shell-glow-warm`(560×460, .5, blur 100px).
- 빛 점은 셸의 `::before`·`::after`로 그리고 셸 안에 가둔다: 셸 `position:relative; overflow:clip; isolation:isolate`, 점 `position:absolute; z-index:-1; pointer-events:none`. `position:fixed`는 쓰지 않는다(드롭다운·모달 밖으로 번진다).
- 다크·인쇄·모바일·로그인: 단색 `canvas`, 빛 점 없음.

**배치**
- 셸 가장자리 여백 `space-4`(16), 사이드바–본문·상단 바–본문 사이 `space-4`. 본문 안쪽 `content-padding`(32).
- 사이드바·상단 바·본문은 모두 `radius`(10px) 모서리의 떠 있는 면이다.

**사이드바**
- `glass` + `glass-border` 1px + `backdrop-filter: blur(18px) saturate(1.3)`. 폭 `sidebar-width`(248) / 레일 `sidebar-rail-width`(76). 좁은 화면 드로어는 불투명 `surface`.
- 카테고리: 접지 않는 고정 라벨(`meta` `ink-muted`). 모든 카테고리의 대메뉴가 늘 보인다. 접고 펼치는 것은 대메뉴의 소메뉴뿐이다. 화면을 옮기면 현재 대메뉴의 소메뉴만 펼치고 다른 대메뉴의 소메뉴는 접는다(펼침 상태는 저장하지 않음, `aria-expanded`).
- 레일에서는 카테고리 라벨 대신 구분선, 모든 대메뉴 아이콘을 보인다.
- 항목: 높이 `nav-item-height`(38), 항목 사이 `space-1`(4), 하위 항목 34, `body` 14px 400, 아이콘 20px. 현재 항목 `sidebar-selected` + `sidebar-selected-ink`, hover `sidebar-hover`. 왼쪽 색 막대·아이콘 배경·굵기 변경 없음.

**상단 바**
- `glass-bar` + `glass-border` 1px + `blur(16px)`, 높이 `topbar-height`(56). 검색·알림·프로필 셋까지만. 검색 칸은 불투명 `surface` + `radius`.

**접근성·대체**: `prefers-reduced-transparency: reduce`와 인쇄에서 글라스를 불투명 `surface`로, blur 없음. 본문 건너뛰기 링크를 둔다.

**하지 말 것**: 본문 카드·표·입력·모달에 글라스, 셸 밖에 그라데이션, 빛 점 셋 이상 또는 채도 높은 빛, 사이드바에 가로 메뉴 추가, 카테고리 접기(다른 카테고리 메뉴가 숨는다), 상단 바에 관리 버튼 띠.

**MCM 구현**: `AppShell`(`cdash cd-canvas cd-shell`), `Sidebar`(`cd-glass`, `cd-nav-group-label`), `TopBar`(`cd-glass-bar`).


## PageHeader

페이지 머리글. 제목, 한 줄 메타, 동작 버튼 묶음, 페이지 탭을 한 모양으로 고정한다. 베이지 `canvas` 위에 직접 놓이는 유일한 텍스트 요소다.

**넘기는 것**: `title`(화면당 하나, `title` 22px 600), `meta?`(짧은 사실들 — `·`로 구분, `table` 12px `ink-muted`), `help?`(`?` 팝오버 글), `actions?`(`Button`들 — primary는 하나, 맨 오른쪽), `tabs?`(`Tabs` segment — 기본값).

**규칙**
- 긴 설명문을 메타 자리에 쓰지 않는다. 사용법 안내("발주처가 포털 정렬표로 낸 값을 붙여넣으세요…")는 `help` 팝오버나 해당 카드 안의 `body` `ink-muted` 한 문장으로 옮긴다. 머리글은 두 줄을 넘지 않는다.
- 동작은 3개까지 보이고, 넘치면 `⋯` 드롭다운. 내보내기 형식(엑셀·워드·HWPX)처럼 같은 종류의 동작 셋은 "내보내기" 드롭다운 하나로 합친다.
- 탭은 머리글의 일부다 — 머리글 아래 `space-5`에 세그먼트 탭 묶음(내용 폭, 한 줄), 그 아래 `space-6`부터 카드가 시작된다.
- 머리글은 셸 바탕 위에 바로 놓인다. 아이콘, 배경 카드·글라스, 그림자, 뒤로가기 화살표 없음. 경로(breadcrumb)가 필요하면 제목 위 `meta` 한 줄.

**MCM 구현**: `CdPageHeader` (`title`, `meta`, `help`, `actions`, `tabs`).


## Card

콘텐츠 그룹을 담는 흰 면. 한 표, 한 폼 섹션, 한 목록, 한 요약이 카드 하나다.

**넘기는 것**: `title?`(`section` 16px 600), `count?`·`meta?`(`meta` `ink-muted`), `action?`(오른쪽 — 링크 하나 또는 `Button` ghost `sm` 하나), `children`. 패딩은 `padded`(기본 `space-card` 20px) 또는 표·행 목록처럼 가장자리까지 쓰는 `flush`.

**규칙**
- `surface` 바탕, `card-border` 1px, `radius` 10px, `shadow-card` 1단 그림자. 그라데이션·blur·반투명·상단 색 막대·왼쪽 색 막대 없음. 카드 안·모달 안에 놓인 카드는 그림자를 뺀다.
- 카드 안에 카드를 넣지 않는다. 카드 안에서 구획이 필요하면 `border` hairline 한 줄과 `space-4`.
- **목록의 항목은 행이지 카드가 아니다.** 행은 높이 `table-row-height`(51px, 두 줄 글자면 그대로 / 한 줄이면 44px), `border` hairline으로 나누고, hover `surface-sunken`. 행 안은 왼쪽 제목(`body-strong`)+메타(`table` `ink-muted`), 오른쪽 `StatusPill` 하나 + `Tag` 하나까지.
- 카드 제목 옆 건수는 `meta`. 제목에 아이콘을 붙이지 않는다.
- 카드 사이 `space-5`(20px). 두 열 배치는 좌 1.1 : 우 1 또는 2 : 1 — 같은 폭 반반으로 나눈 카드 그리드는 템플릿처럼 보인다.
- 속성 나열은 `dl` 2열 그리드(레이블 88~120px `ink-muted`, 값 `ink`). 속성마다 줄을 긋지 않는다.
- 빈 카드: `body` `ink-muted` 한 문장 + 동작 하나, 안쪽 여백 `space-8`. 일러스트 없음.

**하지 말 것**: 카드 그리드 6개 같은 폭, 카드마다 아이콘 머리, 카드 안 카드, 그림자 `shadow-lg`·hover로 커지는 그림자, 모서리 16px, 본문 카드에 글라스.

**MCM 구현**: `cd-card`(`--cd-card-border`, `--cd-shadow`), `cd-card-title`, `cd-listitem`(`data-active`), `cd-inset`. `glass-card`·`glass-panel`·`concept-hatched`는 호환 별칭 — 새 코드에서 쓰지 않는다.


## Table

데이터 표. 열 정의와 행을 받아 머리글·정렬·선택·빈 상태·로딩을 한 가지 모양으로 그린다. 직접 `<table>`을 쓰지 않는 이유가 이 컴포넌트다.

**넘기는 것**: `columns[]` — `{ key, header, align?: "left"|"right", width?, render? }`; `rows[]`; `rowKey`; `selectedKey?`; `onRowClick?`; `empty`(한 문장); `loading`; `bare`(이미 카드 안이면 true — 자체 카드를 만들지 않음); `toolbar?`(제목·건수·동작 버튼).

**규칙**
- `surface` 위에서 읽는다. 기본적으로 자체 카드(`card-border`, `radius`, `shadow-card`)를 만들고, `bare`일 때만 생략한다.
- 머리글: 높이 `table-header-height`(40px), 바탕 `surface-sunken`, 글자 `table`(12px) 500 `ink-muted`, 왼쪽 정렬(숫자 열은 오른쪽). 대문자 변환·자간 없음.
- 본문 행: 높이 `table-row-height`(51px), 글자 `compact`(13px). 밀도 높은 표는 `table`(12px)까지. 가로 `border` hairline만, 세로선 없음, 얼룩말 줄무늬 없음.
- 숫자 열은 오른쪽 정렬 + `tabular-nums`. 단위는 머리글이나 단위 열에 한 번만. 빈 값은 `–`(`ink-muted`), 0은 0.
- 하위 행은 들여쓰기(`space-6`)와 `ink-muted` 글자로 구분한다. 별도 바탕색 없음.
- hover `surface-sunken`, 선택 `row-selected`. 선택 행에 왼쪽 색 막대를 두지 않는다.
- 상태 열에는 `StatusPill` 하나. 한 셀에 필 둘 이상이면 열을 나눈다.
- 행 안 동작은 `Button` `sm` ghost 하나 또는 `⋯` 드롭다운. 행마다 버튼 셋을 늘어놓지 않는다.
- 빈 상태: 행 높이 2줄만큼의 공간에 `body` `ink-muted` 한 문장 + 동작 하나. 일러스트 없음.
- 로딩: 머리글은 유지하고 본문에 `ink-muted` "불러오는 중" 한 줄. 스켈레톤 없음.

**MCM 구현**: `CdTable` (`cd-table`, `cd-table-head`, `cd-table-section`). 현재 코드베이스의 직접 작성 `<table>` 176곳이 전환 대상이다.


## Field

폼 필드. 레이블·입력·도움말·오류를 한 묶음으로 그린다. 입력(`Input`), 선택(`Select`), 여러 줄(`Textarea`), 체크박스(`Checkbox`), 날짜(`DateInput`)가 같은 틀을 쓴다.

**넘기는 것**: `label`, `required?`, `hint?`, `error?`, `disabled?`, 그리고 입력 종류별 값/핸들러. `placeholder`는 형식 예시("예: 2025", "YYYY-MM-DD")로만 — 레이블을 대신하지 않는다.

**규칙**
- 레이블은 **위**에, `table`(12px) 500 `ink-muted`. 입력과 `space-2`(8px). 필수는 레이블 뒤 `danger` `*`.
- 입력 높이 `control-height`(36px) 고정, 가로 패딩 `space-3`, 테두리 `border-strong` 1px, 모서리 `radius`, 글자 `compact`(13px) `ink`. placeholder는 `ink-muted`.
- 포커스: 테두리 `primary` + `focus-ring` 3px. 오류: 테두리 `danger`, 도움말 자리에 `danger` 글자로 오류 문장(도움말과 오류가 같은 자리를 쓴다 — 레이아웃이 뛰지 않는다).
- 비활성: `surface-sunken` 바탕 + `ink-muted` 글자. 읽기 전용 값은 입력처럼 보이게 하지 말고 `body` 텍스트로.
- 체크박스 16px, `radius-xs`, 선택 시 `primary` 채움. 레이블은 오른쪽 `compact`.
- 날짜는 `YYYY-MM-DD` 텍스트 입력(`YYYYMMDD` 입력 시 자동 하이픈). 네이티브 `type="date"`는 쓰지 않는다.
- 폼 행 사이 `space-4`(16px), 섹션 사이 `space-6`(24px) + `section` 제목. 섹션마다 카드를 만들지 않는다. 두 열 그리드는 한 열 폭이 240px 이상일 때만.
- 폼 하단 동작: 오른쪽 정렬, `ghost`(취소) 다음 `primary`(저장). 왼쪽에 `danger`(삭제)가 올 수 있다.

**MCM 구현**: `CdInput` / `CdSelect` / `CdTextarea` / `CdCheckbox` / `CdDateInput` (`label`, `required`, `hint`, `error` 내장). 원시 `<input className="cd-input">` 1,081곳이 전환 대상.


## KpiStrip

숫자 요약을 한 줄 스트립으로 보여준다. KPI 타일(색 아이콘 + 레이블 + 큰 숫자 카드)의 대체물이다.

**넘기는 것**: `items`(2~4개) — 각 `{ label, value, unit?, hint?, tone?: "warning" | "danger" }`. `tone`은 그 숫자가 **지금 문제**라는 뜻일 때만 준다(미처리, 지연, 오류 건수).

**규칙**
- 한 카드(`surface`, `card-border`, `radius`, `shadow-card`) 안에 묶음을 가로로 두고, 묶음 사이는 `border` 세로 hairline. 묶음마다 카드를 만들지 않는다.
- 높이 72px 이내. 레이블 `table`(12px) 500 `ink-muted` 위, 숫자 `number`(24px) 600 `tabular-nums` 아래, 보조 설명은 숫자 옆 `table` 400 `ink-muted`.
- 숫자 색은 `ink`가 기본. `tone="warning"` → `warning`, `tone="danger"` → `danger`. 0이면 tone을 주지 않는다(문제가 없으면 색도 없다).
- 아이콘 없음. 상단 색 보더 없음. 그라데이션 없음. 묶음은 최대 4개 — 다섯 번째가 필요하면 그건 요약이 아니라 표다.
- 클릭 가능하면 묶음 전체가 링크이고 hover 시 `surface-sunken`. 화살표 아이콘은 붙이지 않는다.

**하지 말 것**: 타일 6개 가로 배치, 묶음마다 다른 색, 아이콘 배경 사각, 굵기 700 이상, 숫자 뒤 "건"을 24px로.

**구현**: MCM·ESG 공통으로 새로 만든다(`CdKpiStrip`). ESG 홈의 6타일과 데이터 화면의 4타일이 첫 적용 대상.


## Button

동작 버튼. 네 변형(primary / ghost / soft / danger)과 두 크기(36px / 32px)뿐이다.

**넘기는 것**: `variant`(기본 `ghost`), `size`(`md` 36px | `sm` 32px), `icon`(16px lucide, 글자 앞), 글자(동사형 명사 2~6자), `disabled`, `aria-label`(아이콘만 있을 때 필수).

**규칙**
- `primary`는 화면당 **하나** — 폼의 저장, 목록의 "새 ○○ 등록". 모달 안에서는 모달의 확인 버튼이 그 하나다.
- `primary`는 `primary-fill`(깊은 남색) 채움 + `primary-fill-edge` 1px 테두리 + 흰 글자, hover `primary-fill-hover`. 같은 색조의 테두리가 플랫한 덩어리 느낌을 없애는 핵심이라 빼지 않는다. 그라데이션은 어디에도 쓰지 않는다.
- `ghost`가 기본값이다. 취소·닫기·보조 동작·표 안 동작은 전부 ghost. `soft`는 "승인"처럼 긍정적이지만 주 동작은 아닌 것.
- `danger`는 확인 모달 안에서만. 목록 행에 빨간 삭제 버튼을 두지 않는다 — ghost 아이콘 버튼으로 두고 확인 모달에서 `danger`.
- 글자 `compact`(13px) 500, `sm`은 `table`(12px) 500. 모서리 `radius`(10px). 포커스는 `focus-ring`.
- 그림자, hover 시 올라오는 transform, 로딩 스피너 대신 글자 변경("저장 중…")으로.

**MCM 구현**: `CdButton` / `CdIconButton` (`cd-btn cd-btn-primary|ghost|soft|danger`, `cd-btn-sm`). 원시 `<button className="cd-btn">`도 허용되지만 새 코드는 컴포넌트로.


## StatusPill

상태 필, 건수 배지, 분류 태그. 셋의 차이가 "색은 상태에만" 원칙을 지키는 방법이다.

**StatusPill** — `tone`: `neutral`(초안·대기) | `info`(진행 중) | `success`(승인·완료·정상) | `warning`(경고·기한 임박) | `danger`(반려·오류·초과). 글자는 상태명 한 단어.
- 높이 20px, `radius-pill`, 글자 `table`(12px) 500, 바탕 `*-soft` + 글자 상태색. 테두리 없음, 점(dot) 없음, 아이콘 없음.
- **한 행에 하나.** 상태가 둘이면 열을 나누거나 더 중요한 하나만.
- 같은 상태가 여러 행에 반복되면 `NoticeGroup`처럼 그룹 머리로 올린다.

**Count** — 숫자 배지. `surface-sunken` 바탕 + `ink-muted` 글자, `tabular-nums`. 빨강(`danger` 채움 + 흰 글자)은 **미처리·내가 해야 할 것**에만. 내비 항목 옆, 탭 옆, 목록 항목 오른쪽.

**Tag** — 분류·종류 표시(감축계획 / 보고서 / 평가, 환경 / 사회 / 지배구조). `surface` + `border` 1px + `ink-muted` 400, 모서리 `radius`. **색이 없다.** 분류마다 색을 배정하면 상태색과 경쟁하고, 분류가 늘수록 팔레트가 무너진다. 분류를 빨리 구분해야 하면 색이 아니라 정렬·그룹·필터로 푼다.

**MCM 구현**: `CdBadge`(`tone`), `CdCount`, `cd-pill cd-pill-*`. `cd-pill-violet`·`cd-pill-teal` 같은 색 이름 변형은 폐기 대상 — 상태 이름으로 바꾼다.


## Tabs

탭. 세 변형의 쓰임이 엄격히 다르다 — `segment`는 페이지 탭(기본값), `underline`은 카드 안 섹션 탭, `pill`은 필터.

**넘기는 것**: `items[]` — `{ key, label, count? }`; `value`; `onChange`; `variant`(기본 `segment` | `underline` | `pill`).

**segment — 페이지 탭 (기본)**
- 화면·모달의 **내용을 통째로 바꾸는** 컨트롤(전자결재 / 발송공문 / 발송견적, 표 / 목표 / 검사).
- 묶음: `surface` + `card-border` 1px + `radius`(10px) + `shadow-card`, 안쪽 패딩 4px, 탭 사이 2px, 폭은 내용만큼(`width: fit-content`).
- 탭: 높이 32px, `padding 6px 14px`, `radius-tab-inner`(7px), 글자 `compact`(13px) 500, 비선택 `ink-muted`, hover `surface-sunken` + `ink`.
- 선택: `tab-selected` 바탕 + `tab-selected-ink` 글자. 테두리·밑줄·그림자 없음.
- 한 줄 유지(`nowrap`, 넘치면 가로 스크롤·스크롤바 숨김, `flex-shrink: 0`). 767px 이하에서만 줄바꿈. 카드·모달 안이면 그림자를 뺀다.
- 보통 `PageHeader`의 `tabs`로 들어가 머리글 제목 아래 `space-5`에 놓인다.

**underline — 카드 안 섹션 탭**
- 카드 맨 위에 붙어 그 카드의 내용만 바꿀 때 `variant="underline"`을 명시한다.
- 선택 = `primary` 글자 500 + 2px `primary` 밑줄, 비선택 `ink-muted` 400. 탭 사이 `space-5`, 아래 `border` 1px.

**pill — 필터**
- 같은 목록을 **좁히는** 컨트롤(기간, 상태, 분류). 반드시 카드 안, 페이지 탭 아래.
- 높이 `control-height-sm`(32px), 모서리 `radius`(10px — "pill"이라 부르지만 `radius-pill`이 아니다), 글자 `table`(12px) 500, 필터 사이 `space-2`.
- 선택 = `primary-soft` 바탕 + `primary-strong` 글자. 비선택 = `surface` + `border` + `ink-muted`.

**하지 말 것**: 폴더 모양 탭, 칩으로 만든 페이지 탭, 한 화면에 세그먼트 두 줄, 탭에 아이콘, 선택 탭에 남색 채움 + 흰 글자(주 버튼과 경쟁한다), 탭 묶음을 화면 폭 전체로 늘리기.

**MCM 구현**: `CdTabs` (`variant="segment" | "underline" | "pill"`, 기본 `segment`) — `cd-tabs[data-variant]`, `cd-tab[aria-selected]`.


## NoticeGroup

검사 결과·알림·누락 목록처럼 같은 레벨의 항목이 여러 개일 때 쓰는 그룹 목록. 레벨과 원인을 그룹 머리에 한 번 쓰고, 행에는 대상만 남긴다.

**넘기는 것**: `groups[]` — `{ tone: "warning" | "danger" | "info", title("경고 6건 — 2021–2025 값이 없습니다"), action?, items: [{ label, meta?, href? }] }`.

**규칙**
- 그룹 머리: `*-soft` 바탕 + 상태색 글자, `table`(12px) 500, 높이 32px. 레벨 단어와 건수, 공통 원인을 한 문장으로. 오른쪽에 "전체 보기"·"일괄 수정" 같은 동작 하나.
- 행: 높이 40px, `compact`(13px) `ink` 대상명 + `table` `ink-muted` 메타(어느 표·어느 화면). `border` hairline으로만 나눈다. **행에는 필이 없다** — 레벨은 머리가 이미 말했다.
- 행마다 "~: 2021~2025 값이 없습니다." 같은 같은 문장을 반복하지 않는다. 문장은 머리로, 행은 명사로.
- 그룹은 심각한 것부터(`danger` → `warning` → `info`). 한 카드 안에 그룹이 넷을 넘으면 접기(처음 2개 펼침).
- 항목이 하나뿐이면 그룹 머리 없이 `StatusPill` + 문장 한 줄로.
- 아이콘 없음(상태색 바탕이 역할을 한다). 각 행의 색 점·삼각형·느낌표 없음.

**적용 대상**: ESG 데이터 화면 "검사" 패널, MCM 결재 문서 검증 결과, 통합허가 계획서 누락 항목 목록.


---
# 3. 토큰 (tokens.json 원문)

```json
{
  "name": "KESI Frosted",
  "version": 1,
  "meta": {
    "source": "MCM frontend/components/cdash (precision-tokens.css, cdash.css) — 2026-10-28 shadcn 결정판(C Frosted Shell) 기준 값, main 5e9fe4af. HSL 채널은 hex로 환산.",
    "note": "KESI Precision(2026-10-27)을 대체하는 MCM 그룹웨어·ESG 플랫폼·통합허가 플랫폼 공유 토큰. 값 변경은 cdash 정본과 함께."
  },
  "color": {
    "themes": [
      {
        "id": "light",
        "name": "Light"
      },
      {
        "id": "dark",
        "name": "Dark"
      }
    ],
    "tokens": [
      {
        "name": "canvas",
        "value": {
          "light": "#f9f6f0",
          "dark": "#141520"
        },
        "usage": "모바일·로그인 화면 바탕(베이지 단색)과 다크 셸 바탕. 데스크톱 라이트 셸은 `shell-from`→`shell-mid`→`shell-to` 그라데이션을 쓴다. 바탕은 간격이지 면이 아니다."
      },
      {
        "name": "surface",
        "value": {
          "light": "#ffffff",
          "dark": "#1a1d23"
        },
        "usage": "카드·표·입력·드로어의 불투명 흰 면. 모든 콘텐츠는 이 면 위에 놓인다. 1px `card-border`와 `shadow-card` 1단 그림자. 반투명·blur는 쓰지 않는다."
      },
      {
        "name": "surface-sunken",
        "value": {
          "light": "#f6f7f9",
          "dark": "#24262e"
        },
        "usage": "표 머리글 행, 비활성 입력 바탕, 카드 안 보조 영역(`cd-inset`). `surface` 안에서만 쓴다."
      },
      {
        "name": "popover",
        "value": {
          "light": "#ffffff",
          "dark": "#1d1f25"
        },
        "usage": "드롭다운·팝오버·툴팁 면. 떠 있는 요소라서 `shadow-popover`를 함께 쓴다."
      },
      {
        "name": "border",
        "value": {
          "light": "#e2e4e9",
          "dark": "#343742"
        },
        "usage": "표 가로 구분선(hairline), 구획선, 고스트 버튼 테두리. 카드 바깥 테두리는 더 옅은 `card-border`. 표에 세로선은 긋지 않는다."
      },
      {
        "name": "border-strong",
        "value": {
          "light": "#d1d4dc",
          "dark": "#484d5b"
        },
        "usage": "입력 필드 테두리. 카드보다 한 단계 진해 ‘채울 수 있는 곳’으로 읽힌다."
      },
      {
        "name": "ink",
        "value": {
          "light": "#21232c",
          "dark": "#e7e9ee"
        },
        "usage": "본문·제목·표 셀 글자. `surface`·`canvas`·`surface-sunken` 위에서 14.5:1 이상."
      },
      {
        "name": "ink-muted",
        "value": {
          "light": "#646a78",
          "dark": "#a1a8b5"
        },
        "usage": "레이블, 메타, 표 머리글, 보조 설명. `surface` 위 5.3:1(라이트)·6.9:1(다크). 11px 메타 글자도 이 색까지만 — 더 옅은 글자색은 없다."
      },
      {
        "name": "ink-on-primary",
        "value": {
          "light": "#ffffff",
          "dark": "#111522"
        },
        "usage": "`primary` 채움 위의 글자·아이콘. 다크에서는 주색이 밝아지므로 어두운 잉크."
      },
      {
        "name": "primary",
        "value": {
          "light": "#4a63d8",
          "dark": "#a9b8ff"
        },
        "usage": "주 동작 버튼 채움, 선택된 탭의 글자와 밑줄, 링크, 포커스 링 기준색. 화면당 주 버튼은 하나."
      },
      {
        "name": "primary-strong",
        "value": {
          "light": "#1a47a8",
          "dark": "#97bcfc"
        },
        "usage": "`primary-soft` 위에 올리는 글자(선택 행 안의 강조, 사이드바 선택 항목). `surface` 위 7.6:1."
      },
      {
        "name": "primary-soft",
        "value": {
          "light": "#f3f5fc",
          "dark": "#232731"
        },
        "usage": "선택 가능한 태그·목록 항목의 선택 상태 바탕, 정보 필 바탕. 글자는 `primary-strong`."
      },
      {
        "name": "row-selected",
        "value": {
          "light": "#f5f6fd",
          "dark": "#222530"
        },
        "usage": "표·목록의 선택된 행 바탕. hover는 `surface-sunken`."
      },
      {
        "name": "secondary",
        "value": {
          "light": "#3d8fc4",
          "dark": "#7ec8f0"
        },
        "usage": "주색과 나란히 두 계열을 구분해야 하는 차트 2번 계열. UI 컨트롤에는 쓰지 않는다."
      },
      {
        "name": "success",
        "value": {
          "light": "#1c784f",
          "dark": "#71d6a8"
        },
        "usage": "완료·승인·정상 상태의 글자와 아이콘. 상태에만 — 장식·카테고리 구분에는 쓰지 않는다. `surface` 위 5.4:1."
      },
      {
        "name": "success-soft",
        "value": {
          "light": "#edf4f1",
          "dark": "#212c2e"
        },
        "usage": "성공 필 바탕. 글자는 `success`."
      },
      {
        "name": "warning",
        "value": {
          "light": "#9a5609",
          "dark": "#f3be62"
        },
        "usage": "주의·경고·기한 임박 상태의 글자와 아이콘. `surface` 위 6.1:1. 색만으로 전달하지 않고 항상 단어를 붙인다."
      },
      {
        "name": "warning-soft",
        "value": {
          "light": "#f6f0e9",
          "dark": "#2d2b29"
        },
        "usage": "경고 필·경고 배너 바탕. 글자는 `warning`."
      },
      {
        "name": "danger",
        "value": {
          "light": "#b92727",
          "dark": "#f68484"
        },
        "usage": "오류·삭제·반려·초과 상태의 글자, 위험 버튼 채움. `surface` 위 6.3:1. success와 명도로도 구분된다."
      },
      {
        "name": "danger-soft",
        "value": {
          "light": "#faf0f0",
          "dark": "#29242a"
        },
        "usage": "오류 필·오류 배너 바탕. 글자는 `danger`."
      },
      {
        "name": "stamp",
        "value": {
          "light": "#d0453b",
          "dark": "#f68484"
        },
        "usage": "결재 도장·직인 표시 전용. 다른 곳에 쓰지 않는다."
      },
      {
        "name": "focus-ring",
        "value": {
          "light": "#4a63d829",
          "dark": "#a9b8ff2e"
        },
        "usage": "포커스 링: 주색 테두리 1px + 바깥 3px 이 색. `box-shadow: 0 0 0 3px var(--focus-ring)`, 120ms 페이드. outline은 쓰지 않는다."
      },
      {
        "name": "overlay",
        "value": {
          "light": "#1317203d",
          "dark": "#00000080"
        },
        "usage": "모달·드로어 뒤 어둡게 하는 막. blur는 쓰지 않는다."
      },
      {
        "name": "primary-fill",
        "value": {
          "light": "#4a63d8",
          "dark": "#5269dc"
        },
        "usage": "주 버튼 채움(남색 단색, 2026-10-28 #3a4fc4에서 한 단계 밝힘). 글자 `#ffffff`(라이트 5.2:1, 다크 4.8:1). 화면당 주 버튼은 하나. 그라데이션 없음."
      },
      {
        "name": "primary-fill-edge",
        "value": {
          "light": "#3d55c8",
          "dark": "#4a5fd0"
        },
        "usage": "주 버튼 1px 테두리 — 채움과 같은 색조, 한 단계 어둡게. 플랫한 덩어리로 보이지 않게 가장자리를 잡는다."
      },
      {
        "name": "primary-fill-hover",
        "value": {
          "light": "#4259cf",
          "dark": "#5c72e0"
        },
        "usage": "주 버튼 hover 채움. 테두리는 그대로."
      },
      {
        "name": "card-border",
        "value": {
          "light": "#171b260f",
          "dark": "#343742"
        },
        "usage": "카드·세그먼트 탭 묶음의 바깥 테두리. `border`보다 옅어 그림자와 함께 면의 가장자리만 잡는다."
      },
      {
        "name": "tab-selected",
        "value": {
          "light": "#eef1fb",
          "dark": "#1f2b47"
        },
        "usage": "세그먼트형 페이지 탭의 선택 탭 바탕(남색 틴트). 테두리 없음."
      },
      {
        "name": "tab-selected-ink",
        "value": {
          "light": "#2f41a8",
          "dark": "#97bcfc"
        },
        "usage": "세그먼트 선택 탭 글자. `tab-selected` 위 라이트 7.6:1, 다크 7.3:1."
      },
      {
        "name": "glass",
        "value": {
          "light": "#ffffff94",
          "dark": "#181a21c7"
        },
        "usage": "셸 크롬(좌측 사이드바)의 반투명 면(흰 58%), blur 18px·saturate 1.3과 함께. 본문 카드·표·입력·모달에는 쓰지 않는다."
      },
      {
        "name": "glass-bar",
        "value": {
          "light": "#ffffff8c",
          "dark": "#181a21bd"
        },
        "usage": "상단 바의 반투명 면(흰 55%), blur 16px. 셸 크롬 전용."
      },
      {
        "name": "glass-border",
        "value": {
          "light": "#ffffffbf",
          "dark": "#343742"
        },
        "usage": "글라스 사이드바·상단 바 테두리(흰 75%)."
      },
      {
        "name": "shell-from",
        "value": {
          "light": "#f4f6fb",
          "dark": "#141520"
        },
        "usage": "데스크톱 셸 바탕 그라데이션 시작(160deg, 쿨그레이). 다크·인쇄·모바일은 단색 `canvas`."
      },
      {
        "name": "shell-mid",
        "value": {
          "light": "#eef1f8",
          "dark": "#141520"
        },
        "usage": "셸 바탕 그라데이션 55% 지점."
      },
      {
        "name": "shell-to",
        "value": {
          "light": "#f6f2ec",
          "dark": "#141520"
        },
        "usage": "셸 바탕 그라데이션 끝(베이지)."
      },
      {
        "name": "shell-glow-cool",
        "value": {
          "light": "#c9d4ff",
          "dark": "#2a3350"
        },
        "usage": "셸 좌상단 흐린 빛 점(불투명도 .45, blur 90px, 520×420). 라이트 데스크톱 셸 전용 — 다크·인쇄에는 그리지 않는다."
      },
      {
        "name": "shell-glow-warm",
        "value": {
          "light": "#f3d9c4",
          "dark": "#3a2f2a"
        },
        "usage": "셸 우하단 흐린 빛 점(불투명도 .5, blur 100px, 560×460). 라이트 데스크톱 셸 전용."
      },
      {
        "name": "sidebar-bg",
        "value": {
          "light": "#f9fafb",
          "dark": "#181a21"
        },
        "usage": "글라스를 쓸 수 없을 때(`prefers-reduced-transparency`, 드로어)의 좌측 내비게이션 불투명 바탕. 데스크톱 기본은 `glass`."
      },
      {
        "name": "sidebar-ink",
        "value": {
          "light": "#4d5460",
          "dark": "#d0d4dc"
        },
        "usage": "내비게이션 항목 글자."
      },
      {
        "name": "sidebar-hover",
        "value": {
          "light": "#eeeff2",
          "dark": "#242630"
        },
        "usage": "내비게이션 항목 hover 바탕."
      },
      {
        "name": "sidebar-selected",
        "value": {
          "light": "#ffffff",
          "dark": "#272b35"
        },
        "usage": "현재 메뉴 바탕. 글자는 `sidebar-selected-ink`."
      },
      {
        "name": "sidebar-selected-ink",
        "value": {
          "light": "#1a47a8",
          "dark": "#97bcfc"
        },
        "usage": "현재 메뉴 글자. 왼쪽 색 막대나 아이콘 배경을 덧붙이지 않는다."
      },
      {
        "name": "avatar-1",
        "value": {
          "light": "#4f6bed",
          "dark": "#9ba8e8"
        },
        "usage": "이니셜 아바타 바탕 1/6. 아바타 바탕은 `surface`와 12% 혼합해 쓴다."
      },
      {
        "name": "avatar-2",
        "value": {
          "light": "#8a63d2",
          "dark": "#b0a2e0"
        },
        "usage": "이니셜 아바타 바탕 2/6."
      },
      {
        "name": "avatar-3",
        "value": {
          "light": "#2f8fd8",
          "dark": "#8ab4d8"
        },
        "usage": "이니셜 아바타 바탕 3/6."
      },
      {
        "name": "avatar-4",
        "value": {
          "light": "#1f9e82",
          "dark": "#8fc4b0"
        },
        "usage": "이니셜 아바타 바탕 4/6."
      },
      {
        "name": "avatar-5",
        "value": {
          "light": "#c47f12",
          "dark": "#c0b08c"
        },
        "usage": "이니셜 아바타 바탕 5/6."
      },
      {
        "name": "avatar-6",
        "value": {
          "light": "#e0566e",
          "dark": "#d0989f"
        },
        "usage": "이니셜 아바타 바탕 6/6. 사람 구분에만 — 카테고리·상태 구분에 아바타 팔레트를 빌려 쓰지 않는다."
      }
    ]
  },
  "type": {
    "fonts": [
      {
        "family": "Pretendard Variable",
        "file": "fonts/PretendardVariable.woff2",
        "weight": "45 920",
        "style": "normal"
      }
    ],
    "families": {
      "sans": "\"Pretendard Variable\", Pretendard, \"Malgun Gothic\", \"Apple SD Gothic Neo\", system-ui, sans-serif",
      "mono": "\"JetBrains Mono\", \"SF Mono\", Consolas, \"D2Coding\", monospace"
    },
    "groups": [
      {
        "name": "UI 스케일 (닫힘)",
        "family": "sans",
        "styles": [
          {
            "name": "number",
            "fontSize": "24px",
            "lineHeight": "28px",
            "fontWeight": 600,
            "letterSpacing": "-0.01em",
            "sample": "148",
            "usage": "요약 스트립의 숫자. tabular-nums. 이보다 큰 글자는 UI에 없다."
          },
          {
            "name": "title",
            "fontSize": "22px",
            "lineHeight": "28px",
            "fontWeight": 600,
            "letterSpacing": "-0.01em",
            "sample": "계약 관리",
            "usage": "페이지 제목. 화면당 하나."
          },
          {
            "name": "section",
            "fontSize": "16px",
            "lineHeight": "24px",
            "fontWeight": 600,
            "sample": "진행 중 계약",
            "usage": "카드 제목, 모달 제목."
          },
          {
            "name": "body",
            "fontSize": "14px",
            "lineHeight": "22px",
            "fontWeight": 400,
            "sample": "용역 단위. 분류에 따라 왼쪽 메뉴가 달라집니다.",
            "usage": "본문, 설명문, 넓은 표의 셀."
          },
          {
            "name": "prose",
            "fontSize": "14px",
            "lineHeight": "24px",
            "fontWeight": 400,
            "sample": "자료요청 링크는 PIN을 기본으로 붙입니다. 공공기관 담당자는 PIN 없이 열 수 없습니다.",
            "usage": "두 줄 이상 이어지는 설명문·안내문·빈 상태 문장·카드 안 본문. 한 줄 레이블과 표 셀은 `body`(22px)."
          },
          {
            "name": "body-strong",
            "fontSize": "14px",
            "lineHeight": "22px",
            "fontWeight": 500,
            "sample": "(주)재영물산",
            "usage": "본문 안의 이름·제목. 굵기 500이 ‘강조’의 상한이다."
          },
          {
            "name": "compact",
            "fontSize": "13px",
            "lineHeight": "20px",
            "fontWeight": 400,
            "sample": "입력값을 확인하세요",
            "usage": "입력 필드 글자, 버튼 글자, 밀도 높은 표의 셀."
          },
          {
            "name": "table",
            "fontSize": "12px",
            "lineHeight": "18px",
            "fontWeight": 400,
            "sample": "2025-10-23 · 억 원",
            "usage": "표 셀 기본, 필 글자, 폼 레이블(굵기 500)."
          },
          {
            "name": "meta",
            "fontSize": "11px",
            "lineHeight": "16px",
            "fontWeight": 400,
            "sample": "환경 · 0/20",
            "usage": "보조 메타(날짜·건수·단위). 색은 `ink-muted`. 11px 아래는 없다."
          }
        ]
      }
    ]
  },
  "spacing": {
    "note": "4px 그리드. 관련 요소 8, 그룹 안 12~16, 카드 안 20, 카드 사이 20, 섹션 사이 32, 콘텐츠 바깥 32. 표·목록 안은 밀도를 유지하고 그 바깥은 넓힌다. 임의값(9.5px, 11.5px…) 금지.",
    "tokens": [
      {
        "name": "space-1",
        "value": "4px",
        "usage": "아이콘과 글자 사이, 필 안쪽 세로."
      },
      {
        "name": "space-2",
        "value": "8px",
        "usage": "관련 요소 사이(레이블–입력, 버튼 묶음 안). 표 셀 세로 패딩."
      },
      {
        "name": "space-3",
        "value": "12px",
        "usage": "표 셀 가로 패딩, 컨트롤 가로 패딩, 필터 행과 표 사이."
      },
      {
        "name": "space-4",
        "value": "16px",
        "usage": "셸 가장자리 여백, 폼 행 사이, 작은 카드(요약 스트립 칸) 안쪽."
      },
      {
        "name": "space-5",
        "value": "20px",
        "usage": "카드 사이 간격, 카드 안쪽 패딩(`space-card`)."
      },
      {
        "name": "space-6",
        "value": "24px",
        "usage": "섹션 사이, 페이지 머리글 아래."
      },
      {
        "name": "space-card",
        "value": "20px",
        "usage": "카드 안쪽 패딩(16→20). 표처럼 가장자리까지 쓰는 카드는 머리글에만 적용."
      },
      {
        "name": "space-section",
        "value": "32px",
        "usage": "페이지 안 섹션 사이, 페이지 머리글(탭 포함)과 첫 카드 사이(24→32)."
      },
      {
        "name": "nav-item-height",
        "value": "38px",
        "usage": "사이드바 항목 높이(34→38, 2026-10-29 행간 넓힘). 항목 사이 4px, 하위 항목 34px."
      },
      {
        "name": "space-8",
        "value": "32px",
        "usage": "빈 상태 안쪽 여백."
      },
      {
        "name": "content-padding",
        "value": "32px",
        "usage": "콘텐츠 영역 바깥 여백(28→32, 결정판 밀도). 셸 가장자리와 사이드바·상단 바 사이는 `space-4`."
      },
      {
        "name": "content-max-width",
        "value": "1456px",
        "usage": "콘텐츠 최대 폭."
      },
      {
        "name": "sidebar-width",
        "value": "248px",
        "usage": "좌측 내비게이션 펼친 폭. 레일은 `sidebar-rail-width`."
      },
      {
        "name": "sidebar-rail-width",
        "value": "76px",
        "usage": "좌측 내비게이션 아이콘 레일 폭. 레일에서는 그룹과 무관하게 모든 아이콘을 보인다."
      },
      {
        "name": "topbar-height",
        "value": "56px",
        "usage": "상단 바 높이."
      },
      {
        "name": "control-height",
        "value": "36px",
        "usage": "버튼·입력·셀렉트 높이. 패딩으로 맞추지 말고 height로 고정한다."
      },
      {
        "name": "control-height-sm",
        "value": "32px",
        "usage": "표 안 버튼, 필터 필."
      },
      {
        "name": "table-header-height",
        "value": "40px",
        "usage": "표 머리글 행."
      },
      {
        "name": "table-row-height",
        "value": "51px",
        "usage": "표 본문 행(2026-10-21 +7px 결정)."
      },
      {
        "name": "sheet-width",
        "value": "460px",
        "usage": "우측 드로어 폭."
      }
    ]
  },
  "radius": {
    "note": "두 단계뿐. 10px(컨트롤·카드·탭) 과 pill. 세그먼트 탭 안쪽만 7px. 2026-10-28 8→10.",
    "tokens": [
      {
        "name": "radius",
        "value": "10px",
        "usage": "버튼, 입력, 탭, 카드, 모달, 드로어, 필터 — 모든 네모의 모서리. Tailwind `rounded-lg`가 이 값이다."
      },
      {
        "name": "radius-tab-inner",
        "value": "7px",
        "usage": "세그먼트 탭 묶음 안쪽 탭(묶음 10 − 패딩 3). 다른 곳에 쓰지 않는다."
      },
      {
        "name": "radius-pill",
        "value": "9999px",
        "usage": "상태 필, 아바타, 스위치 노브, 프로그레스 바."
      },
      {
        "name": "radius-xs",
        "value": "2px",
        "usage": "체크박스, 범례 스와치처럼 16px 이하의 아주 작은 요소만."
      }
    ]
  },
  "shadow": {
    "note": "카드는 1단 부드러운 그림자(`shadow-card`) 하나. 카드 안 카드·모달 안 카드는 그림자 없음. 떠 있는 것은 각자의 그림자.",
    "tokens": [
      {
        "name": "shadow-card",
        "value": {
          "light": "0 1px 2px #1d24350a, 0 8px 24px -12px #1d24351f",
          "dark": "0 1px 2px #0000003d"
        },
        "usage": "카드·표 카드·세그먼트 탭 묶음. 카드 안·모달 안에서는 없음. hover로 그림자를 키우지 않는다."
      },
      {
        "name": "shadow-raised",
        "value": {
          "light": "0 2px 4px #1d24350d, 0 16px 40px -16px #1d24352e",
          "dark": "0 12px 32px -12px #00000080"
        },
        "usage": "끌어서 옮기는 카드처럼 잠시 들려 있는 면."
      },
      {
        "name": "shadow-popover",
        "value": {
          "light": "0 6px 24px #1d243520",
          "dark": "0 6px 24px #00000066"
        },
        "usage": "드롭다운, 팝오버, 툴팁, 토스트."
      },
      {
        "name": "shadow-dialog",
        "value": {
          "light": "0 16px 60px #1d24352e",
          "dark": "0 16px 60px #00000099"
        },
        "usage": "모달."
      },
      {
        "name": "shadow-sheet",
        "value": {
          "light": "-16px 0 48px #1d243520",
          "dark": "-16px 0 48px #00000066"
        },
        "usage": "우측 드로어."
      }
    ]
  }
}
```
