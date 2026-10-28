# MCM × shadcn/ui — 디자인 컨셉 4안과 도입 계획 (2026-10-28)

- 배경: KESI Precision(10-27) 적용 뒤에도 "깔끔함 부족·색감 불만·밀도 과다·메뉴 지저분" 문제가 남아 shadcn/ui 도입을 검토한다.
- 요구: MCM 색상 구조의 큰 틀(남색 주색·베이지 바탕·흰 카드·상태색 4종·Pretendard)은 유지하되 톤을 부드럽게, 요소 간 간격을 넓히고, 글라스·그림자·그라데이션은 포인트에만 제한적으로 쓴다.
- 컨셉 캔버스(클로드 디자인): https://claude.ai/artifact/MVb2RZSZm5rMqkHw32Y6MU — 전자결재 결재함 한 화면을 네 가지 룩으로. 실제 메뉴(협업·업무·주요 업무 그룹, 전자결재 하위 7개)와 가상 데이터.
- 소스 파일: 세션 scratchpad `mcm-concepts/project/*.dc.html` (저장소 밖, 캔버스가 정본).

## 1. 현재 상태 진단

| 항목 | 현재 | 의미 |
|---|---|---|
| 스택 | Next 15.5 · React 19 · **Tailwind 3.4** · tailwind-merge 2 · clsx · lucide | shadcn 미도입(components.json·radix 없음) |
| 토큰 | `precision-tokens.css`(HSL 채널, shadcn과 같은 이름 체계: background/card/popover/primary/muted/accent/border/input/ring/sidebar) → `cdash.css`의 `--cd-*` 별칭 → 1,220개 화면 파일이 `--cd-*`·`cd-*` 클래스 소비 | **shadcn 변수와 1:1 매핑 가능**. `--cd-*` API를 유지하면 화면 파일을 건드리지 않고 룩을 바꿀 수 있다 |
| 컴포넌트 | cdash 15종(Cd Button/Field/Modal/Dropdown/Tabs/Table/Badge/Toast …) + `components/ui` 7종 | 내부 구현만 shadcn으로 바꾸고 props는 유지하는 전략이 가능 |
| 규칙 문서 | `ui-precision-standard.md` P01(무광·blur 금지)·P02(그림자 금지·8px) | 채택 컨셉에 따라 **같은 커밋에서 개정** 필요 |
| 밀도 | 컨트롤 36, 행 51, 카드 패딩 16, 섹션 24, 콘텐츠 패딩 28, 내비 항목 32px·협업 그룹 10개 | 수치 자체보다 "모든 틈이 비슷해서 그룹이 안 보임"이 문제 |

## 2. 사례 조사 요약

업무용 앱에서 shadcn을 쓴 공개 사례와 참고할 디자인 방향.

- **satnaing/shadcn-admin** (MIT, 16k★): 사이드바·글로벌 검색·10+ 페이지·RTL. 가장 널리 쓰이는 shadcn 관리자 셸. 사이드바 그룹/접힘 패턴의 기준점. https://github.com/satnaing/shadcn-admin
- **arhamkhnz/next-shadcn-admin-dashboard** (MIT, 3.2k★): 테마 프리셋 4종(Default·Tangerine·Neo Brutalism·**Soft Pop**), 접히는 사이드바, 콘텐츠 폭 가변, CRM·Finance·Users/Roles·Kanban·Calendar·Invoice 등 업무 화면 다수. **프리셋 교체 구조**가 참고 대상. https://github.com/arhamkhnz/next-shadcn-admin-dashboard
- **Kiranism/next-shadcn-dashboard-starter** (MIT): 표 검색·필터·페이지네이션, 폼, 인증. 백오피스 기본형. https://github.com/Kiranism/next-shadcn-dashboard-starter
- **shadcn 공식 Sidebar/Blocks**: `collapsible="icon"`(아이콘 레일) 옵션이 MCM의 248/76px 레일 구조와 일치. https://ui.shadcn.com/docs/components/sidebar · https://www.shadcnblocks.com/blocks/sidebar
- **SACS-PAYROLL PR #11**: 직원·관리자·HR·회계 포털을 shadcn으로 재구성(근태·급여명세·휴가). 그룹웨어와 가장 가까운 실사례. https://github.com/punyoz/SACS-PAYROLL/pull/11
- **approvals-ui**: 결재 워크플로 컴포넌트를 shadcn 레지스트리로 배포. 결재선 편집 UI 참고. https://approvals-ui.vercel.app/
- **tweakcn**: shadcn 테마 편집기(색·반경·그림자·글꼴·자간 편집, 프리셋 40여 종, CSS 변수 export). 컨셉 확정 후 토큰 미세 조정 도구로 적합. https://tweakcn.com/
- 디자인 방향: 2026 B2B UI는 Linear·Notion류 "calm design"(기본 화면은 여백 중심, 설정·필터는 progressive disclosure)이 주류. 반론으로 데이터 밀도가 필요한 엔터프라이즈 화면은 여백 남용이 오히려 해롭다는 글도 있다. MCM은 **목록·표는 밀도 유지, 그 바깥(셸·헤더·카드 사이)은 여백 확대**가 맞다. https://saasui.design/blog/7-saas-ui-design-trends-2026 · https://uxdesign.cc/how-white-space-killed-an-enterprise-app-and-why-data-density-matters-b3afad6a5f2a
- 글라스: 가이드들은 공통으로 "크롬(사이드바·상단바)에만 frosted, 데이터 영역은 불투명"을 권한다. https://www.superdesign.dev/styles/glassmorphism/dashboard
- 한국 그룹웨어(네이버웍스·플렉스·잔디) UI를 분석한 공개 자료는 찾지 못했다. 토스 TDS 등 공식 디자인 시스템 문서가 필요하면 별도 조사.

## 3. 디자인 컨셉 4안

네 안 모두 공통: 사이드바 248px·상단바 56~60px·페이지 헤더(제목+설명+주 버튼+탭)·요약 4칸·필터 행+표·하단 카드 2개. 구조는 같고 **면·색·반경·그림자·간격**만 다르다. 모두 Pretendard, 상태색은 대기(주황)·진행(남색)·승인(녹색)·반려(빨강) 네 가지.

### A · Quiet Workspace — Linear식 중립·여백
- 바탕 `#F7F7F5`(베이지 흔적만 남긴 웜그레이), 카드 흰색 + 1px `#E8E8E4`, 그림자·블러·그라데이션 **없음**. 사이드바는 바탕과 같은 면(경계선 없음), 현재 항목만 흰 pill + 남색 글자.
- 주색 `#4A63D8`/주 버튼 `#3A4FC4`(현행 유지). 제목 20/600, 본문 14, 표 13, 행 48px, 컨트롤 34~36px, 카드 패딩 20, 섹션 간격 24, 콘텐츠 패딩 32.
- 요약은 카드 네 개가 아니라 **한 카드를 세로 hairline으로 나눈 스트립**(Precision 규칙과 같음).
- 장점: 현행 규칙(P01·P02)과 거의 충돌 없음, 가장 적은 변경으로 "깔끔"을 얻음. 다크 모드 전환 쉬움. 단점: 사용자가 원한 "부드러운 색감·포인트 효과"는 가장 약함.

### B · Soft Tint — 파스텔 층·부드러운 그림자
- 바탕 `#FAF8F4`(베이지 유지, 더 밝게), 사이드바 옅은 라벤더 `#F3F4FB` + 우측 1px, 카드 흰색 + 1px `#ECEAE4` + **그림자 0 1px 2px 4%**, 반경 14(카드)/10(컨트롤).
- 주색을 한 단계 부드럽게 `#5468DA`, 주 버튼만 **저채도 그라데이션**(`#5468DA → #6C7CE6`) + 색 그림자. 요약 첫 칸(결재 대기)에만 틴트 배경+아이콘 원으로 포인트. 상태 필은 파스텔 배경+진한 글자. 탭은 세그먼트형(흰 pill).
- 장점: 사용자 요구(부드러운 톤·절제된 그라데이션·그림자)에 가장 직접 부합, 아바타 6색 팔레트와 잘 어울림. 단점: 반경 14는 "8px 통일" 규칙을 바꿔야 하고, 그라데이션은 10-27에 폐기한 결정을 일부 되돌림(단, 블루→보라가 아닌 같은 색조 안의 명도 차이).

### C · Frosted Shell — 크롬에만 글라스
- 바탕은 옅은 블루그레이→웜 그라데이션(`#F4F6FB → #EEF1F8 → #F6F2EC`) + 가장자리에 저채도 블롭 2개(블루·피치, blur 90px). **사이드바·상단바만 반투명 흰 58%/55% + blur 18/16px**, 데이터 카드는 완전 불투명 흰색 + 2겹 그림자(0 1px 2px 4% + 0 8px 24px -12px 12%).
- 주색·주 버튼은 현행(`#3A4FC4`, 위쪽 1px 하이라이트만 추가). 반경 12(카드)/8(컨트롤). 상태 필은 배경+1px 테두리. 밑줄 탭 유지.
- 장점: "글라스를 포인트에만" 요구에 정확히 대응, 다크 모드에서 가장 돋보임, 표·입력은 불투명이라 가독성 손실 없음. 단점: `backdrop-filter`는 스크롤 성능 비용(FHD·구형 PC에서 사이드바 blur 확인 필요), 인쇄·캡처에서 블롭이 노출되지 않도록 예외 처리 필요.

### D · Paper & Ink — 모노크롬·잉크 버튼
- 바탕 흰색, 사이드바 `#FAFAFA` + 우측 1px, 카드 1px `#EAEAEA` + 그림자 0 1px 2px 3%, 반경 10. 글자 `#141414`/`#6F6F6F` 두 단계.
- **주 버튼이 남색이 아니라 잉크(검정)**. 블루 `#3451C9`는 링크·선택·강조 숫자에만. 상태는 색 pill 대신 **점(dot) + 글자**. 요약은 카드 없이 숫자·레이블만(세로 hairline). 그래프 막대도 잉크색. 콘텐츠 최대 폭 1200, 패딩 36~40, 섹션 간격 32로 가장 넓은 여백.
- 장점: 네 안 중 가장 "깔끔", 타이포 위계만으로 읽히고, 색을 쓰는 곳이 줄어 상태색이 또렷해짐. 단점: "색상 구조 큰 틀 유지" 요구에서 가장 멀다(주 버튼 색 변경). 베이지가 사라짐.

### 비교

| | A Quiet | B Soft Tint | C Frosted | D Paper&Ink |
|---|---|---|---|---|
| 색상 구조 유지 | ◎ | ○(주색 톤다운) | ◎ | △(잉크 버튼) |
| 부드러운 톤 | ○ | ◎ | ○ | ○ |
| 포인트 효과(그림자·그라데이션·글라스) | 없음 | 그림자·버튼 그라데이션 | 글라스·2겹 그림자 | 극소 그림자 |
| 여백·가독성 | ◎ | ○ | ○ | ◎ |
| 현행 규칙 개정 폭 | 작음 | 큼(반경·그림자·그라데이션) | 중간(blur·그림자 예외) | 중간(주 버튼 색) |
| 다크 모드 | 쉬움 | 보통(틴트 재설계) | 가장 유리 | 쉬움 |
| 구현 위험 | 낮음 | 낮음 | 중(성능·인쇄) | 낮음 |

권장: **C를 기본으로 B의 상태 필·요약 포인트를 섞는 조합**이 요구(큰 틀 유지 + 부드러운 톤 + 제한적 글라스·그림자)에 가장 가깝다. 가장 보수적으로 가려면 A, 가장 과감하게 가려면 D.

## 4. shadcn 도입 방식 결정

### 4-1. Tailwind 경로
shadcn 공식 문서상 Tailwind v3 프로젝트는 계속 지원되며 v3 프로젝트에 추가되는 컴포넌트는 v3·HSL 방식으로 들어온다(https://ui.shadcn.com/docs/tailwind-v4). 두 경로:

| | (a) Tailwind 3.4 유지 + shadcn v3 컴포넌트 | (b) Tailwind v4 업그레이드 + shadcn 최신 |
|---|---|---|
| 변경 범위 | `components.json`·`tailwind.config.ts` 확장·radix 추가 | 1,220 파일의 임의값 문법·`@apply`·설정을 CSS-first로 이전, OKLCH·`@theme inline`·`tw-animate-css`·`data-slot` |
| React 19 | radix 패키지 peer deps 때문에 npm은 `--legacy-peer-deps` 필요할 수 있음(공식 안내) | 동일 |
| 위험 | 낮음. 문서는 v3.shadcn.com | 높음. 빌드가 타입·린트 에러를 막지 않는 상태(next.config)라 회귀 탐지가 약함 |

**권장 (a).** v4 전환은 디자인 시스템이 안정된 뒤 별도 작업으로 분리한다.

### 4-2. 토큰 3층 구조 (화면 파일 무변경의 핵심)
```
:root / .dark            shadcn 표준 변수  --background --card --primary --muted --border --ring --sidebar-* --radius   ← 정본, tweakcn export 그대로
.cdash / .cdash-vars     --precision-* = var(--shadcn 변수)                                                           ← 별칭(기존 파일 유지)
cdash.css                --cd-* = hsl(var(--precision-*))                                                            ← 기존 소비 API 유지
```
- `precision-tokens.css`의 값을 shadcn 변수 참조로 바꾸면 1,220개 화면 파일은 그대로 새 룩을 받는다.
- 컨셉별로 다른 것은 shadcn 변수 값 세트 하나(= tweakcn 프리셋 하나). 라이트/다크는 `html[data-theme]`(기존) ↔ `.dark`(shadcn) 둘 다 선택자에 포함.
- 새로 추가하는 토큰: `--shadow-card`·`--shadow-raised`·`--glass-bg`·`--glass-blur`·`--primary-gradient`(채택 컨셉에서만 값, 나머지는 none)·밀도 토큰 `--space-section`(24→32)·`--space-card`(16→20)·`--content-padding`(28→32)·`--nav-item-height`(32→34).

### 4-3. 컴포넌트 전략 — "Cd* 껍데기 유지, 속은 shadcn"
| 순서 | 대상 | shadcn 원천 | 비고 |
|---|---|---|---|
| 1 | Sidebar·TopBar | `sidebar`(collapsible="icon"), `tooltip`, `dropdown-menu` | 248/76 레일·메뉴 순서·`aria-current` 보존. 그룹 간 여백 확대, 현재 그룹만 자동 펼침은 **구조 변경이라 승인 후** |
| 2 | CdButton·CdIconButton | `button`(cva variants: primary/ghost/soft/danger) | `cd-btn` 클래스 호환 유지 |
| 3 | CdField·입력·select | `input`·`select`·`textarea`·`label` | `CdDateInput` YYYYMMDD 정규화 유지 |
| 4 | CdDropdown·CdModal·시트 | `dropdown-menu`·`dialog`·`sheet`·`popover` | 포커스 가두기·Escape·복귀를 radix가 제공 |
| 5 | CdTabs·CdBadge | `tabs`·`badge` | 밑줄형 variant 추가 |
| 6 | CdTable | `table` + 기존 `useClientPaging` | 행 높이 토큰화 |
| 7 | CdToast | `sonner` | 기존 Toast API 래핑 |
| 8 | GlobalSearch | `command` | ⌘K |

### 4-4. 단계
- **P0 결정 — 2026-10-28 사용자 확정**
  - 컨셉 **C Frosted Shell** 기본. 글라스(반투명+blur)는 사이드바·상단바에만, 데이터 카드는 불투명 흰색 + 2겹 그림자. 주색·주 버튼(`#3A4FC4`)·상태색은 현행 유지.
  - **페이지 탭은 B안 세그먼트형**을 차용하되 **바탕은 다른 카드와 같은 흰색**(B의 진한 베이지 `#F0EEE8` 아님). 선택 탭은 남색 틴트 `#EEF1FB` + 글자 `#2F41A8`. 밑줄형(U-8)에서 세그먼트형으로 바뀌므로 `CdTabs`의 페이지 탭 variant 기본값이 바뀐다.
  - **반경 10px** — 카드·버튼·입력·탭·드롭다운·모달. 상태 필 6px, 아바타·배지 pill. `--mcm-action-radius: 8px → 10px`, `--precision-ui-radius-card: 8 → 10`, `--precision-ui-radius-control: 6 → 10`.
  - **사이드바는 현재 경로가 속한 그룹만 자동 펼침.** 나머지 그룹은 헤더(라벨 + 항목 수 + 화살표)만 보이고 클릭으로 펼친다. 홈은 그룹 없이 항상 표시. 248/76 레일·메뉴 순서·`aria-current`는 유지(구조 변경 승인: 10-28).
  - Tailwind 경로 (a) 유지. 결정판 아트보드: 캔버스 두 번째 행 "C 결정판(10-28)".
- **P1 기반(1 PR)**: `npx shadcn@latest init`(v3 감지), `components.json`, radix·cva·tailwindcss-animate 설치, 토큰 3층 연결, 밀도·효과 토큰 추가, `ui-precision-standard.md` P01·P02 개정, `ds-lint` 규칙 갱신. 화면 변화는 색·간격뿐.
- **P2 셸(1 PR)**: Sidebar·TopBar·CdPageHeader. FHD·1024·390·다크·키보드 검증.

#### P1 + P2 파일 단위 (결정판 기준, 브랜치 `claude/shadcn-foundation`)
| 파일 | 변경 |
|---|---|
| `frontend/package.json` | `@radix-ui/react-{slot,dialog,dropdown-menu,popover,tabs,tooltip,select}`, `class-variance-authority`, `tailwindcss-animate`, `sonner`, `cmdk` 추가. React 19 peer 경고는 `--legacy-peer-deps`, lock 함께 커밋 |
| `frontend/components.json` | 신규. style `new-york`, `tailwind.cssVariables: true`, `css: app/globals.css`, alias `@/components/ui` → **`@/components/shadcn`**(기존 `components/ui` 7종과 충돌 회피) |
| `frontend/tailwind.config.ts` | `darkMode: ["selector", 'html[data-theme="dark"]']`, colors에 shadcn 변수(`hsl(var(--background))` …), `borderRadius` `lg/md/sm` → `var(--radius)` 계열, `tailwindcss-animate` 플러그인 |
| `frontend/app/globals.css` | `:root`/`html[data-theme="dark"]`에 shadcn 표준 변수 세트(결정판 값: `--radius: 10px`, `--sidebar-*`, 추가 `--shadow-card`·`--shadow-raised`·`--glass-bg`·`--glass-blur`·`--canvas-gradient`·`--space-section`·`--space-card`). `--mcm-action-radius: 10px` |
| `frontend/components/cdash/precision-tokens.css` | 값을 shadcn 변수 참조로 교체(`--precision-background: var(--background)` …), `--precision-ui-radius-card/control: 10px`. 다크 블록도 동일 |
| `frontend/components/cdash/cdash.css` | `--cd-shadow: var(--shadow-card)`, `.cd-card` 그림자·반경 10, `.cd-canvas` 그라데이션+블롭(`::before/::after`, `@media print`·`prefers-reduced-transparency`에서 제거), `.cd-tabs[data-variant="segment"]` 추가, 사이드바 glass 클래스 `.cd-glass` |
| `frontend/components/cdash/CdTabs.tsx` | `variant: "underline" \| "pill" \| "segment"`, 페이지 탭 기본값 `segment` |
| `frontend/components/layout/Sidebar.tsx` | 그룹 접힘 상태 `openGroups`(localStorage `nav-open-groups-v1`), 경로 변경 시 현재 그룹 자동 펼침·나머지 접힘, 그룹 헤더 `button[aria-expanded]` + 항목 수 + chevron. 기존 `openSections`(부모 펼침)·76px 레일·`aria-current`는 유지 |
| `frontend/components/layout/AppShell.tsx` | 사이드바·상단바 wrapper에 `.cd-glass`, 본문 패딩 토큰화 |
| `frontend/components/layout/TopBar.tsx` | 배경 glass, 컨트롤 반경 10 |
| `frontend/components/shadcn/*` | CLI가 생성(button·input·dialog·dropdown-menu·popover·tabs·tooltip·select·sonner·command). 화면에서 직접 쓰지 않고 Cd* 내부에서만 사용 |
| `frontend/scripts/ds-lint.mjs` | R3 반경 허용값 8→10, R4 그림자 허용 토큰(`--shadow-card`·`--shadow-raised`) 추가, blur는 `.cd-glass` 밖에서만 금지 |
| `docs/ui-precision-standard.md` | P01(글라스는 셸 크롬에만 허용)·P02(반경 10·카드 그림자 토큰 허용)·§4 탭 규칙(페이지 탭 = 세그먼트형, 흰 바탕) 개정. CLAUDE.md "버튼 반경 8px" 문구도 같은 커밋 |
| `frontend/content/manual/` | 사이드바 그룹 접힘·탭 모양 변경에 해당하는 기사 `reviewedAt` 갱신 + `changelog.ts` 한 줄, `npm run test:manual` |

검증: `npx tsc --noEmit | grep -E "Sidebar|CdTabs|AppShell|TopBar"`, dev 서버에서 FHD(1920×1080)·1024·390, 라이트/다크, Tab/Escape, 인쇄 미리보기(블롭·glass 제거 확인).

#### P1 + P2 실제 반영(2026-10-28, 브랜치 `claude/shadcn-foundation`) — 위 표와 달라진 점
- **shadcn 표준 변수는 `:root`에 두지 않았다.** 기존 코드가 같은 이름을 다른 의미로 쓴다: `--primary`는 완성 색(`text-primary` 346곳·globals.css 20여 곳), `--accent`는 채용·회사소개서 모듈의 지역 변수, `cd-text-muted` 1,548곳은 Tailwind `muted` 색을 추가하면 `text-muted` 유틸과 이름이 겹칠 위험이 있다. 정본은 그대로 `precision-tokens.css`(HSL 채널, shadcn과 같은 이름에 `--precision-` 접두)이고, 새 효과 토큰(`--precision-ui-shadow-card/raised`·`-card-border`·`-glass(-bar/-border)`·`-backdrop-blur`·`-tab-selected(-text)`·`-radius-tab-inner`)도 여기에 라이트·다크로 둔다. `--cd-*` 별칭(`--cd-shadow`·`--cd-card-border`·`--cd-glass*`·`--cd-tab-selected*`)이 화면에 노출된다.
- **Tailwind 색 이름 연결과 radix·cva·sonner·cmdk 설치는 P3로 미뤘다.** 쓰는 곳 없이 의존성과 lock만 바뀌면 배포 위험만 생긴다. P3에서 첫 shadcn 컴포넌트를 넣을 때 `tailwind.config.ts` colors에 `--cd-*` 연결(+`darkMode: ["selector", '[data-theme="dark"]']`)과 함께 설치한다. `components.json`은 미리 넣었다(alias `@/components/shadcn`).
- **반경 10**: `--radius: 10px` + Tailwind `borderRadius.lg = var(--radius)` 한 줄로 앱 전체 `rounded-lg`(1,474곳)가 10px. `--mcm-action-radius`·`--precision-ui-radius-card/control` 10. 탭 묶음 안쪽 탭은 7px(전역 버튼 반경 `!important`보다 구체적인 선택자).
- **바탕 그라데이션·빛 점은 데스크톱 셸(`.cd-shell`, AppShell 루트)에만.** 같은 `.cd-canvas`를 쓰는 모바일 `/m`·로그인은 베이지 단색 유지. 다크·인쇄는 단색.
- **세그먼트 탭**: `CdTabs` 기본값 `segment`. 한 줄 고정(가로 스크롤)이고, 767px 이하에서만 줄바꿈. 카드·모달 안에서는 그림자 없음. 명시적 `variant="underline"`(할 일 보드)과 `cd-tabs data-variant="underline"` 직접 마크업(착수계·영업 상세 패널·할 일)은 카드 안 섹션 탭이라 유지.
- **사이드바 그룹 접힘**: localStorage 없이 경로가 바뀔 때마다 현재 그룹만 펼친다(메뉴에 없는 경로에서는 직전 상태 유지). 접힌 머리는 메뉴 수, 미확인 건수가 있으면 그 합계를 채움 배지로 보인다. 76px 레일에서는 그룹 머리를 숨기고 모든 아이콘을 보인다. 드로어는 불투명 면.
- **ds-lint**: R3 기준 10px, R4 문구 갱신, R13(본문 `backdrop-blur`·`backdropFilter`) 추가.
- **P3 기초 컴포넌트(모듈별 PR)**: 표 4-3 순서로 Cd* 내부 교체. 계약 → 시설 → 결재 → 재무 → 영업(10-27 정리 순서 그대로).
- **P4 간격 정리**: `ds-codemod`에 간격 규칙(C6) 추가 — 카드 패딩·섹션 gap·필터 행 간격을 토큰으로.
- **P5 포인트 효과**: 채택 컨셉의 글라스/그림자/그라데이션을 셸·주 버튼·요약 포인트 등 지정 위치에만. 인쇄 서식·캡처·모바일 `/m`은 제외.
- **P6 검증·동기화**: 매뉴얼 캡처 갱신(`npm run test:manual`), 사용 매뉴얼 changelog 한 줄, next 배포.

### 4-5. 주의
- `next.config.mjs`가 타입·린트 에러를 무시하므로 교체한 Cd* 파일은 `npx tsc --noEmit | grep` 로 개별 확인.
- radix 설치 시 React 19 peer 경고는 공식 안내대로 처리하고 `package-lock.json` 을 함께 커밋한다.
- `backdrop-filter`(C안)는 `prefers-reduced-transparency`·인쇄 미디어에서 끈다.
- 베이지 바탕·블루 버튼은 사용자 결정 사항(09-10·09-11)이므로 D안 채택 시 그 결정을 명시적으로 뒤집는 기록을 남긴다.
