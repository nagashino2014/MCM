# 데스크탑 위젯(Tauri) Frosted 개편 — 현황 진단과 작업 계획 (2026-11-04)

모바일 앱(`apps/mobile`)은 11-03~04 KESI Frosted 로 7차례 개편·배포됐지만, 데스크탑 위젯은 2달 넘게 손대지 않아
아이콘이 깨지고 옛 Soft Glass Ink 화면이 남아 있다. 이 문서는 **왜 그런지(진단)** 와 **모바일 구현을 충실히 재현하기
위해 무엇을 바꿀지(계획)** 를 정리한 것이다. 구현은 사용자 확인 뒤 시작한다.

## 1. 위젯 화면은 무엇으로 만들어지는가

| 층 | 위치 | 역할 | 갱신 방법 |
|---|---|---|---|
| 셸 | `apps/desktop/` (Tauri v2) | 창·상단 바(36px, 자체 제작)·트레이·뱃지·OS 알림. 화면은 `<iframe src="https://koensain.app/m-app">` | 인스톨러 재빌드 → `frontend/public/downloads/MCM-widget-setup.exe` 교체 → 사용자 PC **재설치** |
| 콘텐츠 | `frontend/public/m-app/` | `apps/mobile` 의 **Expo 웹 export 결과물을 저장소에 커밋**해 next 이미지에 포함 | `expo export --platform web` → `public/m-app` 교체 → 커밋 → next 배포 |
| 웹 분기 | `apps/mobile/src` 의 `Platform.OS === 'web'` / `IS_WEB` | 좌측 세로 탭바, 카메라 기능 숨김, localStorage 토큰, 스크롤바 숨김, 위젯 브리지(postMessage) | 모바일 코드 수정 → 재export |

즉 위젯 UI = **(a) m-app 번들의 최신성** + **(b) 모바일 코드의 웹 전용 분기** + **(c) 셸 상단 바** 세 가지로 결정된다.

## 2. 진단

### 2-1. 아이콘이 전부 깨진 원인 — 11-01 재export 번들의 폰트 경로 결함 (확정)

- 배포된 `index.html` 이 가리키는 번들 `entry-a27dd3…js`(11-01 커밋 6fb9a50b "영업 발굴 1차 확장"에서 재export)는
  아이콘 폰트를 **`/m-app/assets/________CodingProject/MCM/apps/mobile/node_modules/@expo/vector-icons/.../Ionicons.*.ttf`**
  로 참조한다. 절대 경로가 그대로 인코딩된 비정상 경로이고, 실제 요청하면 **404**(curl 로 확인).
- 직전 번들(10-20, `entry-b21c7…js`)은 `/m-app/assets/node_modules/@expo/vector-icons/...` 정상 경로였고,
  그 폰트 38개는 지금도 저장소에 추적돼 있다(`.gitignore`·`.dockerignore` 예외 적용).
- 11-01 커밋은 `public/m-app` 의 HTML·JS 54개만 바꾸고 `assets/` 는 건드리지 않았다 → 번들이 가리키는 곳에 파일이 없다.
- 오늘 같은 PC·같은 Expo(57.0.7)로 시험 export 한 결과는 **정상 경로**이고 API 호스트도 `https://koensain.app`(LAN 주소 없음)
  이었다. 따라서 **재export 만으로 아이콘 깨짐은 해결**된다. 다만 같은 사고가 재발하지 않도록 export 절차에 경로 검증을 넣는다(§3 D0).

### 2-2. 2달 전 UI 가 보이는 이유 — m-app 은 수동 재export 커밋 방식

- `public/m-app` 재export 이력: 10-20 두 번, 11-01 한 번이 전부. Frosted 개편(PR #107~#113, 11-03~04)은 네이티브 OTA 로만
  나갔고 웹 번들은 한 번도 다시 만들지 않았다.
- 재export 하면 7라운드 결과(토큰·`AppHeader`·`KpiStrip`·할 일 박스·세그먼트 탭·근태 MonthNav·대화방 목록 흰 바탕 등)가
  **코드 수정 없이 그대로** 위젯에 들어온다. 손질이 필요한 것은 웹 전용 분기(§2-3)뿐이다.

### 2-3. 웹(위젯) 전용 분기가 Frosted 이전 상태

| # | 항목 | 현재 | 문제 |
|---|---|---|---|
| W1 | 좌측 세로 탭바 | `(tabs)/_layout.tsx` 가 웹이면 react-navigation 기본 바(`material` 변형, 폭 88, 흰 면 + 우측 1px, 선택 = 연남색 둥근 사각) | 모바일의 글라스 플로팅 탭바(`GlassTabBar`)는 네이티브 전용. 레일 모양이 Frosted 와 다르고 토큰도 안 쓴다 |
| W2 | 하단 여백 | 9개 화면이 하단에 `TAB_BAR_INSET`(96px)을 더함(하단 글라스 바 뒤로 콘텐츠를 잇기 위해) | 웹은 하단 바가 없어 **96px 빈 공간**이 생긴다. 웹에서는 0 이어야 한다 |
| W3 | 홈 빠른 실행 | 웹은 카메라 타일 2개(명함·영수증)를 숨겨 4개가 `justify-between` 으로 퍼짐 | 폭 472 에서 타일 간격이 과도(스샷). 열 간격을 고정해야 한다 |
| W4 | 창 폭 가변 | 창 560×860 기본, 자유 리사이즈·최대화 | 최대화하면 콘텐츠가 화면 폭 전체로 늘어진다. 최대 폭 제한(중앙 정렬)이 필요 |
| W5 | 셸 바탕 그라데이션 | `ShellBackground` 가 웹에서도 그려짐(루트 폴백 + 화면별) | 레일이 불투명 흰색이라 바탕이 레일에서 끊긴다. 레일을 반투명으로 하면 자연스럽다 |
| W6 | 다크 모드 | 앱은 설정(system/light/dark), 셸 상단 바는 OS `prefers-color-scheme` 만 따름 | 앱을 라이트로 고정하고 OS 가 다크면 **상단 바만 다크**. 브리지에 테마 메시지를 더해 맞춰야 한다 |
| W7 | 글꼴 | Pretendard 웹 로드 없음(모바일도 후속 과제) | PC 에 Pretendard 가 없으면 맑은 고딕. 웹 전용 `@font-face`(자체 호스팅 woff2)로 해결 가능 — 선택 |
| W8 | 마우스 환경 | hover 없음(Pressable active 만), 스크롤바 숨김(global.css) | 기능상 문제는 없음. 커서 pointer 는 RN-web 기본 제공 |

웹 안전영역은 0 이라 `AppHeader`(safe pad/extend)·홈 `ScreenHeader` 는 그대로 동작한다. 명함·영수증 숨김, localStorage 토큰,
위젯 브리지(`use-widget-bridge.ts`, 미읽음·오늘 할 일 → 트레이 뱃지)는 유지한다.

### 2-4. 셸(`apps/desktop/src/index.html`) 자체

- 색이 전부 하드코딩(`#1b2144`, `#4353e4`, `#6b7cf6`, `#e5e8f2` …)이고 제목 굵기 800, 반경 7~8 — Frosted 규격(굵기 ≤600,
  반경 10, 토큰 색)과 어긋난다. 다크 색도 모바일 토큰(`tokens.ts`)과 다르다.
- 버전 불일치: `tauri.conf.json` 1.3.0 vs `Cargo.toml` 1.2.0(둘을 함께 올리는 규칙 위반). `downloads/MCM-widget-setup.exe` 는 10-14 빌드.
- 셸 변경은 **사용자 PC 재설치**가 필요한 유일한 부분이다. 콘텐츠(m-app)만 바꾸면 next 배포로 끝난다.

### 2-5. 설치 파일 다운로드·실행 시 보안 경고 (사용자 추가 지적)

- 원인은 **코드 서명이 없는 실행 파일**이다. Edge/Chrome 은 "일반적으로 다운로드되지 않는 파일"로 다운로드를 막고,
  실행 시 Windows SmartScreen 이 "PC 보호" 창을 띄운다(디펜더 바이러스 탐지가 아니라 **평판 없음** 경고). 압축(zip)으로 싸도
  실행 단계의 SmartScreen 은 그대로다.
- 없애는 방법은 서명뿐이고, 서명 종류에 따라 효과가 다르다.
  - **OV 코드 서명 인증서**(연 수십만 원, 2023-06 이후 하드웨어 토큰/HSM 필수): 서명해도 다운로드 횟수로 평판이 쌓일 때까지
    SmartScreen 경고가 남을 수 있다. 사내 30명 규모로는 평판이 잘 쌓이지 않는다.
  - **EV 코드 서명 인증서**(연 수십만~백만 원대): 통상 평판을 빠르게 얻어 경고가 거의 즉시 사라진다.
  - **Azure Trusted Signing**(Microsoft, 월 약 1만 원대 Basic): 가장 저렴하고 SmartScreen 평판 연동이 좋다. 다만 조직 신원 검증의
    국가·사업 이력 요건이 있어 **한국 법인 가입 가능 여부를 먼저 확인**해야 한다.
  - Tauri 는 `bundle.windows.certificateThumbprint`(토큰 인증서) 또는 `signCommand`(Trusted Signing 의 signtool+dlib)로 빌드에 서명을 붙일 수 있다.
- 서명 없이 줄이는 방법(보완책): ① 다운로드 버튼 옆에 "경고가 뜨면 추가 정보 → 실행" 그림 안내, ② IT 담당자가 직원 PC 에
  Edge 정책(SmartScreen 허용 도메인에 koensain.app)을 한 번에 적용(도메인/Intune 없으면 PC 마다 레지스트리) — 둘 다 근본 해결은 아니다.
- **설치 자체를 없애는 대안**: m-app 을 PWA(manifest + service worker)로 만들어 Edge/Chrome 의 "앱으로 설치"를 쓰면 보안 경고가 전혀
  없고 창 모드·시작 메뉴 등록·작업표시줄 뱃지(Badging API)·알림(Web Push, 서버 VAPID 필요)까지 된다. 잃는 것은 **트레이 상주·항상 위 고정**
  두 가지다. 위젯 셸의 기능 대부분을 대체할 수 있어, 서명 비용을 쓰지 않을 거라면 이쪽이 현실적이다.

### 2-6. 서명 조사 결과 (2026-11-04, 웹 검색)

- **EV 인증서의 "즉시 평판" 혜택은 사라졌다.** Microsoft 의 현행 안내는 EV 서명 파일도 OV 와 같은 평판 축적 과정을 거친다고 적고,
  DigiCert·ToDesktop 도 같은 내용을 확인한다. 평판은 파일 해시 단위라 **위젯을 새로 빌드할 때마다 다시 쌓인다** —
  사내 30명 규모에서는 서명을 해도 경고가 당분간 남을 가능성이 높다.
- **Azure Trusted Signing(현 Artifact Signing)** 은 Q&A 답변 기준으로 한국이 조직 검증 지원국 목록(미국·캐나다·EU·영국·호주·뉴질랜드·일본·싱가포르·스위스·노르웨이·이스라엘·한국)에
  있으나, "3년 이상 세무 이력" 요건이 남아 있다는 답변과 아니라는 답변이 엇갈리고, 2026-10 한국 법인의 AU10TIX 신원 검증 실패 사례가 보고돼 있다.
  공식 문서로 확정되지 않아 **가입 시도 전 Azure 지원에 자격 확인**이 먼저다. 비용은 월 1만 원대.
- 결론: **설치 경고를 "지금" 없애는 확실한 길은 PWA** 이고, 서명은 비용·절차 대비 효과가 불확실한 보조 수단이다. 이번 구현(D5)은 PWA 를 기본 경로로
  넣고, 서명은 사용자가 Trusted Signing 자격을 확인한 뒤 Tauri 빌드에 붙이는 후속으로 둔다.

## 3. 작업 계획

| 단계 | 내용 | 산출물 | 반영 경로 |
|---|---|---|---|
| **D0 재export 절차 스크립트화** | `apps/mobile` 에 `npm run export:web` 추가: `expo export --platform web` → **검증 게이트**(아이콘 폰트 경로가 `/m-app/assets/node_modules/...` 인지, API 호스트가 `koensain.app` 이고 `192.168` 이 없는지) → `frontend/public/m-app` 교체(옛 `_expo` 정리, `assets/node_modules` 폰트 갱신) | 스크립트 + 재export 커밋 | next 배포 |
| **D1 좌측 레일 Frosted 화** | 웹에서도 커스텀 탭바 사용: `GlassTabBar` 의 세로 변형 `SideRail`(폭 88, 반투명 글라스 면 + hairline, 아이콘 22 + 라벨 11/500, 선택 = `pillSelected` 상자(반경 10) + primary 아이콘, 뱃지 유지). 커스텀 바면 `material` 변형 함정(uikit throw)과 무관해진다. `TAB_BAR_INSET` 은 웹에서 0 | 모바일 코드 | 재export → next |
| **D2 웹 레이아웃 보정** | 빠른 실행 타일 열 간격 고정(W3), 콘텐츠 최대 폭 제한·중앙 정렬(W4, 예: 640), 레일 뒤까지 바탕 그라데이션(W5) | 모바일 코드 | 재export → next |
| **D3 셸 상단 바 Frosted 토큰화** | 색·굵기·반경을 모바일 토큰 값으로, 테마 동기화 브리지(`mcm:theme` — 앱 설정을 셸로), 버전 1.4.0(conf·Cargo 동시), 인스톨러 빌드 → `downloads` 교체 | 위젯 1.4.0 | next 배포 + **재설치** |
| **D5 설치 경고 해소** | 사용자 결정에 따라: (a) 코드 서명(Trusted Signing 가입 가능 여부 확인 → 불가 시 EV 인증서) + Tauri 빌드 서명 연동 / (b) PWA 설치 경로 추가(manifest·service worker·설치 안내) / 공통: 다운로드 버튼 옆 설치 안내 | 서명된 인스톨러 또는 PWA | next 배포(+ 재설치) |
| **D4 검증·배포** | 로컬 `expo start --web` 을 560 폭 창으로 열어 전 탭 라이트/다크 스샷, 실제 위젯 설치 후 사용자 실화면 확인. 매뉴얼 changelog·메모리 갱신 | 보고 | — |

권장 순서: **D0 → D1 → D2 를 한 묶음(PR 1건)으로 먼저 배포**해 아이콘·옛 UI 문제를 바로 걷어내고, D3(재설치 필요)는 별도 PR 로 뒤따른다.
D4 의 웹 전용 화면 검증은 로그인이 필요한 화면이 대부분이라, 코드 검증은 로컬 웹 미리보기로 하고 최종 확인은 사용자 스샷에 의존한다.

### 3-1. 구현 결과 (2026-11-04, 결정: 추천안 + 서명·PWA 병행)

| 단계 | 결과 |
|---|---|
| D0 | `apps/mobile/scripts/export-web.mjs`(`npm run export:web`): export → 검증(절대 경로 인코딩·LAN 주소·Ionicons 경로·API 호스트·폰트 파일·PWA 파일) → `frontend/public/m-app` 교체. 첫 실행에서 보조 청크에 호스트가 없어 게이트가 막혔고(의도대로 public/m-app 은 보존), 호스트 검사를 번들 합산으로 고친 뒤 통과(100 파일). |
| D1 | `components/ui/SideRail.tsx`(글라스 세로 레일, 선택 = pillSelected 상자) + `lib/platform.ts`(IS_WEB_RAIL·IS_IN_WIDGET·IS_STANDALONE_PWA·IS_PHONE_DEMO 한 곳). `(tabs)/_layout` 이 웹에서도 커스텀 tabBar 를 쓰고 `TAB_BAR_INSET`·FAB bottom 은 레일 환경 0/24. |
| D2 | 루트 `_layout` 이 레일 환경에서 최대 폭 728(레일 88 + 640) 가운데 섬, 홈 빠른 실행 타일은 `justify-start gap-x-7`. 바탕 그라데이션은 루트(ThemeProvider)가 창 전체에 깔아 레일 뒤로 비친다. |
| D5 | PWA: `public/manifest.webmanifest`·`sw.js`(캐시 없음)·`pwa/icon-*.png`(PIL 로 생성, maskable 포함), `app/+html.tsx`(manifest·theme-color·설치 프롬프트 선점·SW 등록, iframe 안에서는 생략), `lib/use-install-prompt.ts` + 전체 메뉴 "PC 앱으로 설치"(프롬프트 없으면 안내 시트), 위젯 브리지가 PWA 창에서 Badging API 로 뱃지. next.config `headers()` 로 `/m-app/sw.js` 에 `Service-Worker-Allowed: /m-app`(scope 를 끝 슬래시 없이 맞춤 — next 가 `/m-app/` 를 308 로 돌리기 때문). 웹 홈 "데스크탑 위젯 설치" → "PC 앱 설치" 드롭다운(브라우저 설치 권장 + exe + SmartScreen 안내). 매뉴얼 home.dashboard·start.mobile 절 추가, changelog. |
| D4 | 로컬 `expo start --web`: dev-preview UI 부품 탭의 SideRail 샘플(560 폭), 로그인 화면 560/1280(가운데 섬) 확인. 로그인 뒤 화면(실제 레일·홈·뱃지)과 PWA 설치는 배포 후 사용자 확인이 필요하다. |
| D3 | 미착수(별도 PR). |

## 4. 사용자 결정이 필요한 항목

1. **레일 모양**: (a) 모바일 글라스 탭바의 세로판(반투명·그림자·바탕 비침) — 추천 / (b) 지금처럼 불투명 흰 면에 색만 Frosted 로.
2. **최대화 창 대응**: 콘텐츠 최대 폭 제한(640 중앙 정렬)으로 갈지, 폭 전체를 쓰게 둘지. 추천: 제한(모바일 화면 충실 재현 원칙).
3. **셸 상단 바(D3)**: 이번에 함께 진행할지, 콘텐츠(D0~D2) 배포 뒤 별도로 할지. 추천: 별도(재설치가 필요해 사용자 작업이 생김).
4. **Pretendard 웹 폰트(W7)**: 이번에 넣을지(자체 호스팅 woff2 약 1~2MB 추가), 후속으로 미룰지.
5. **설치 보안 경고(§2-5)**: 코드 서명 비용을 쓸지(Trusted Signing 가능 여부 확인 후 EV), PWA 설치 경로로 갈지, 둘 다 갈지. 추천: 서명 가능 여부 확인과 PWA 를 병행 검토.

## 5. 참고 — 확인에 쓴 근거

- 배포 번들 폰트 URL 404: `curl -I https://koensain.app/m-app/assets/________CodingProject/.../Ionicons.b4eb097d….ttf` → 404(text/html).
- 시험 export(스크래치 디렉터리): 폰트 경로 `/m-app/assets/node_modules/@expo/vector-icons/...`, 번들 내 호스트 `https://koensain.app` 1건, `192.168` 0건.
- `git log -- frontend/public/m-app`: 85cc35bb(10-20), 2c5f7678(10-20), 6fb9a50b(11-01). 6fb9a50b 는 `assets/node_modules` 변경 0건.
- 웹 분기 파일: `(tabs)/_layout.tsx`(IS_WEB 탭바), `(tabs)/index.tsx`(카메라 타일 숨김), `GlassTabBar.tsx`(backdropFilter 웹만), `lib/tokens.ts`·`lib/kv.ts`(localStorage), `global.css`(스크롤바), `lib/use-widget-bridge.ts`.

## 6. 2차 — 셸 상단 바·코드 서명(구현)과 넓은 창 배치·대화 2분할(설계, 2026-11-04 사용자 요청)

### 6-1. 구현한 것
- **셸 상단 바 Frosted 화**(`apps/desktop/src/index.html`): 색을 모바일 토큰 값(card·cardBorder·ink·ink-muted·surface·primary-fill·pillSelected)의 CSS 변수로, 제목 14/600, 반경 10, 높이 38. 테마는 OS 기본 + 앱이 보내는 `mcm:theme`(dark 여부)가 우선(`data-theme`). 앱 쪽은 `use-widget-bridge.ts` 가 hello 뒤·테마 변경 때마다 보낸다(로그인 전에도).
- **코드 서명 연동**: `tauri.conf.json` `bundle.windows.signCommand` → `src-tauri/scripts/sign.ps1`. 환경변수가 없으면 서명을 건너뛰고 빌드는 계속된다.
  Trusted Signing 은 `MCM_SIGN_METADATA`(metadata.json) + `MCM_SIGN_DLIB`(Azure.CodeSigning.Dlib.dll) + `az login`, 로컬 인증서는 `MCM_SIGN_THUMBPRINT`. signtool 은 Windows SDK 에서 자동 탐색(`MCM_SIGNTOOL` 로 지정 가능).
- 버전 1.4.0(`tauri.conf.json`·`Cargo.toml` 동시). **빌드·인스톨러 교체는 아직** — 실행 중인 위젯(`mcm-desktop.exe`)을 종료해야 cargo 가 exe 를 덮어쓸 수 있다.

### 6-2. Trusted Signing 가입 절차(사용자 작업)
1. Azure 구독에서 **Trusted Signing(Artifact Signing) 계정** 생성(지원 리전 중 선택 — 포털 목록 확인, Basic 요금제).
2. **Identity validation → Organization**: 사업자등록 정보·도메인(koensain.app)·담당자 신원 확인. 한국 법인 가능 여부는 여기서 판가름 난다(3년 이력 요건·AU10TIX 실패 사례 있음). 거절되면 Azure 지원 티켓으로 자격 확인.
3. **Certificate profile(Public Trust)** 생성 → 계정명·프로필명·엔드포인트를 `metadata.json` 에 적는다.
4. 빌드 PC: Windows SDK(signtool), NuGet `Microsoft.Trusted.Signing.Client`(dlib), Azure CLI `az login`(또는 서비스 주체 환경변수). `MCM_SIGN_METADATA`·`MCM_SIGN_DLIB` 를 설정하고 `npm run build`.
5. 서명된 인스톨러를 `frontend/public/downloads/MCM-widget-setup.exe` 로 복사 → next 배포. SmartScreen 평판은 파일 해시 단위라 **처음 몇 번은 경고가 남을 수 있다**.

### 6-3. 설계안 — 대화 2분할과 넓은 창 배치 (결정 필요)
사용자 요청: 대화 목록(왼쪽)·선택한 대화방(오른쪽)을 한 화면에(다우오피스 메신저 방식). 가로 폭이 필요하므로 다른 메뉴 배치도 함께 검토.

| 항목 | 안 | 비고 |
|---|---|---|
| 창 기본 크기 | **560×860 → 1000×860**(최소 폭 560). 폭이 900 미만이면 지금처럼 한 화면씩(모바일 흐름) | 사용자가 좁혀도 깨지지 않게 폭 기준 반응형 |
| 대화 | 폭 ≥ 900: 왼쪽 목록 360(검색·전체/개인/그룹 탭·+ 버튼 유지) + 오른쪽 대화방(`chat/[roomId]` 화면을 roomId prop 으로 받는 부품으로 분리, 헤더에 방 이름·검색·알림·즐겨찾기). 방을 누르면 라우트 이동 없이 오른쪽만 바뀜. 미선택 상태는 빈 안내 | 모바일·좁은 창은 현행 유지 |
| 메일 | 같은 구조: 왼쪽 목록 380 + 오른쪽 본문(`mail/[messageId]`) | 대화와 같은 부품으로 |
| 결재 | 왼쪽 문서 목록 + 오른쪽 문서 상세(`approval/[docId]`) | 승인·반려 버튼이 오른쪽에 |
| 홈 | 콘텐츠 최대 폭 728 → **1040**: 요약 스트립 6칸 1줄, 아래 카드(결재 대기·안읽은 메일·오늘 일정·경과 미입력·최근 공지·오늘 할 일) **2열 그리드**, 날씨 위젯은 한 칸 폭 | 카드 안 구성은 모바일 그대로 |
| 전체 메뉴·설정·일정·사업장 등 | 최대 폭 1040 가운데 섬, 타일 2열 → 3열(폭 ≥ 900) | 구조 변경 없이 열 수만 |
| 가운데 섬 vs 꽉 채우기 | 레일 + 콘텐츠 최대 폭 1040 을 **가운데 섬**으로 유지(그 이상은 바탕) | 초광폭 모니터에서 줄 길이 제한 |

구현 순서 제안: ① 창 기본 폭 1000·반응형 기준(`useWindowDimensions`, 폭 ≥ 900 = "wide") + 섬 최대 폭 1040 → ② 대화 2분할(화면 부품 분리) → ③ 메일·결재 2분할 → ④ 홈 2열·전체 메뉴 3열. ①②를 먼저 배포해 확인받고 ③④로 간다. 네이티브 앱에는 영향이 없다(wide 는 웹 레일 환경에서만 참).

### 6-5. 설치 경고 — 사용자 결정 "인트라넷 등록 + Store 준비" (2026-11-04)
위젯 1.4.0 은 서명 없이 빌드돼 경고가 그대로였고, 사용자는 브라우저 안에서 도는 PWA 가 아니라 **독립 실행 메신저**를 원한다.
- **즉시 적용 — 인트라넷 영역 등록**: `frontend/public/downloads/mcm-trust-koensain.reg`(HKCU). koensain.app 을 로컬 인트라넷 영역(ZoneMap https=1)에 두면
  그 사이트에서 받은 파일에 Mark-of-the-Web 이 붙지 않아 Windows SmartScreen 이 검사하지 않는다. Edge `SmartScreenAllowListDomains`·Chrome
  `SafeBrowsingAllowlistDomains` 도 같이 넣어 브라우저 다운로드 차단도 없앤다. 관리자 권한 불필요, PC 당 1회. 웹 홈 "PC 앱 설치" 의 1단계로 노출.
  ⚠ 로컬 인트라넷 영역은 Windows 통합 인증 자동 전송 등 IE 시대 동작이 따라오지만 우리 도메인 한 곳이라 영향 없음.
  검증은 사용자 PC 에서: .reg 적용 → 웹 홈에서 exe 다시 내려받기(기존 파일은 이미 MOTW 가 붙어 있음) → 실행 시 경고 없음 확인.
- **최종 경로 — Microsoft Store 비공개 배포**: `apps/desktop/msix/AppxManifest.xml` + `scripts/make-msix.ps1` 로 Store 업로드용 MSIX 를 만든다(§7).

### 6-4. ①② 구현 결과 (2026-11-04, 사용자 결정 "설계안대로 진행")
- `lib/platform.ts`: `WIDE_MIN_WIDTH = 900`, `WEB_SHELL_MAX_WIDTH = 88 + 952`. `lib/use-wide-layout.ts`: `useWideLayout()` = 레일 환경 && 창 폭 ≥ 900.
- `app/chat/[roomId].tsx`: 본문을 `ChatRoomView({ roomId, name, embedded, onLeft })` 로 부품화. 라우트 default export 는 넓은 배치면 `/(tabs)/chat?roomId=` 로 replace(알림·검색 딥링크 대응), 아니면 전체 화면 방. embedded 면 안전영역 없음·뒤로가기 없음·나가기는 onLeft.
- `app/(tabs)/chat.tsx`: 넓은 배치면 왼쪽 목록 360(검색·세그먼트·FAB 그대로, 선택 행 pillSelected) + 오른쪽 `ChatRoomView embedded`(미선택 시 빈 안내). 방 선택·검색 결과·새 대화 생성 모두 `openRoom()` 한 곳 — 넓으면 선택만, 아니면 라우트 이동. 파라미터 선택 동기화는 effect 가 아닌 파생 상태 패턴.
- 위젯 창 기본 1000×860(최소 560×520).
- 미구현(③④): 메일·결재 2분할, 홈 2열·전체 메뉴 3열 — ①② 확인 뒤.
- 위젯 1.4.0 빌드 완료(`MCM_1.4.0_x64-setup.exe` 1.27MB) → `frontend/public/downloads/MCM-widget-setup.exe` 교체. 서명은 환경변수가 없어 생략(스크립트가 "서명 생략" 을 찍고 통과).
  ⚠ 첫 빌드는 `failed to run powershell` 로 실패 — `sign.ps1` 에 한글 주석이 있는데 **UTF-8 BOM 이 없어 PowerShell 5.1 이 ANSI 로 읽다 파싱 오류**(exit 1). BOM(utf-8-sig)+CRLF 로 저장해 해결. 한글이 든 .ps1 은 BOM 필수.

## 7. Microsoft Store 비공개 배포 절차 (준비 완료, 사용자 작업 필요)

| 단계 | 내용 | 비고 |
|---|---|---|
| 1 | **Partner Center 개발자 계정**(회사 계정) 등록 — 사업자 정보·결제, 일회 등록비 | 승인 수일 |
| 2 | 앱 이름 예약("MCM" 또는 "KESI MCM") → **제품 ID 페이지**의 패키지 ID(`Identity Name`)·게시자 ID(`CN=…`)·게시자 표시 이름 확보 | 매니페스트 Identity 는 이 값과 정확히 일치 |
| 3 | 빌드 PC: `npm run build` → `scripts/make-msix.ps1 -IdentityName … -Publisher … -PublisherDisplay …` → `MCM_<ver>.0.msix` | 서명 없이 업로드(Store 가 서명) |
| 4 | 제출: 패키지 업로드, **표시 여부 = 비공개(특정 대상)** 또는 숨김 + 직접 링크, 연령 등급 설문, 개인정보처리방침 URL(koensain.app 안 페이지), 스크린샷 1장 이상, 설명 | 심사 1~3일 |
| 5 | 직원 PC: Store 링크(`ms-windows-store://pdp/?productid=…`) 또는 웹 홈 버튼 → 설치. 이후 업데이트는 Store 가 자동 | 경고 0, 설정 > 앱 등록 |

**주의·위험**
- Store 정책 10.2.1(웹 콘텐츠 앱): 단순 사이트 래퍼는 거절될 수 있다. 트레이·뱃지·알림·항상 위 등 네이티브 기능이 있어 통과 가능성은 높지만 심사 결과에 따라 설명 보강이 필요할 수 있다.
- MSIX 안에서 레지스트리·AppData 는 가상화된다. 자동 시작은 Run 키 대신 매니페스트의 StartupTask(기본 꺼짐, 설정 > 앱 > 시작 프로그램)로 바뀌며, Tauri autostart 플러그인 토글은 Store 판에서는 동작하지 않을 수 있다(확인 항목).
- 버전은 `tauri.conf.json` 의 x.y.z 에 `.0` 을 붙인 네 자리. Store 에 올릴 때마다 올려야 한다.
- 로컬 사이드로딩 시험(선택): `-SignThumbprint` 로 자체 서명 → 그 인증서를 시험 PC 의 "신뢰할 수 있는 사람"에 설치 → .msix 더블클릭(App Installer). 이것이 §2-5 의 ④ 경로이며 Store 없이도 경고 없이 설치된다.

### 7-1. 사용자 결정(2026-11-04): Store 배포로 확정 — 상세 절차(웹 조사 반영)
.reg 적용으로 경고가 사라진 것을 실측했지만 최종은 **Store 배포(①)** 로 간다.

**조사로 바뀐 전제**
- 회사 계정 등록비는 2026-05 온보딩 개편으로 **무료**(기존 $99 면제). 개인 계정은 2025-09 부터 무료. 시작점은 `storedeveloper.microsoft.com`(옛 경로는 요금 화면이 뜰 수 있음).
- 회사 검증: D-U-N-S 번호 입력(빠름) 또는 사업자 서류 업로드(수동 검토 3~5 영업일). **제출 3회 제한** — 서류를 한 번에 정확히.
- Entra ID(Microsoft 365 회사 계정)로 가입하면 테넌트 전체가 온보딩된다.
- "Private audience" 는 **개인 Microsoft 계정(MSA) 이메일**만 받는다(회사 Entra 계정 불가). 직원마다 MSA 가 있어야 하므로 번거롭다 → **"표시 여부: Store 에서 검색되지 않음 + 직접 링크로만 설치"** 를 쓴다. 링크는 웹 홈 "PC 앱 설치" 버튼에 둔다(앱 자체가 로그인을 요구하므로 링크 노출 위험은 없다).

**절차**
1. **계정**: `storedeveloper.microsoft.com` → 등록 → "회사(Company)" → Microsoft 365 회사 계정(Entra ID)으로 로그인 권장. 게시자 표시 이름(예: KESI / 한국환경안전연구원), 연락처, 사업자등록번호·주소. D-U-N-S 가 있으면 입력, 없으면 사업자등록증 PDF 업로드. 검증 메일이 오면 완료(3~5 영업일).
   - **(11-05 정정) 새 온보딩 흐름에서는 검증 3단계(이메일·비즈니스·고용)가 모두 끝나기 전에는 Partner Center 에 들어갈 수 없다.** 온보딩 포털(`storedeveloper.microsoft.com/ko-KR/onboarding`)의 "계정 검증" 화면에 머물며, 완료 메일이 오면 그 화면에서 계정 설정을 마치고 **"Store 에 게시(Publish to Store)"** 를 눌러야 Partner Center 계정이 만들어지고 "앱 및 게임" 작업영역으로 넘어간다(같은 계정 선택, 최대 30분 반영 지연 → `aka.ms/submitwindowsapp`). 따라서 이름 예약도 검증 뒤에만 가능하다(옛 흐름의 "대기 중 예약 가능" 안내는 새 흐름에 맞지 않음). `partner.microsoft.com` 으로 직접 들어가면 요금이 있는 옛 흐름이 뜨므로 쓰지 않는다.
   - 11-05 현재 상태: 이메일·비즈니스 확인됨, **고용 확인 검토 중**(영업일 5일). 확인 메일 도메인이 `koensain.com`, 등록 웹사이트가 `koensain.kr` 이라 도메인 불일치로 **도메인 소유 증빙(구매 영수증·등록 기록)** 요청이 올 수 있다. 항소는 유형별 3회.
2. **앱 이름 예약**: Partner Center → 앱 및 게임 → 새 제품 → **MSIX 또는 PWA 앱** → 이름 "MCM"(이미 쓰이면 "KESI MCM"). 예약 후 **제품 관리 → 제품 ID** 에서 `Package/Identity/Name`, `Package/Identity/Publisher`(CN=…), `Package/Properties/PublisherDisplayName` 세 값을 복사.
3. **패키지 생성**(개발 PC): `cd apps/desktop && npm run build` → `powershell -ExecutionPolicy Bypass -File scripts/make-msix.ps1 -IdentityName "<Name>" -Publisher "<Publisher>" -PublisherDisplay "<표시 이름>"` → `src-tauri/target/msix/MCM_1.4.0.0.msix`. 서명하지 않는다(Store 가 서명).
4. **제출 작성**(제품 → 제출 시작):
   - 가격 및 가용성: 가격 무료, 시장 = 대한민국(또는 전체), **표시 여부 = "Store 에서 검색할 수 없음, 직접 링크가 있는 사용자만"**, 출시 = 인증 즉시.
   - 속성: 범주 "비즈니스" 또는 "생산성", 개인정보처리방침 URL(koensain.app 안에 짧은 페이지 필요 — 앱이 개인정보를 다루므로 필수), 지원 연락처(이메일).
   - 연령 등급: 설문 응답(업무용·사용자 생성 콘텐츠 = 메신저이므로 "사용자 간 통신 있음" 체크).
   - 패키지: .msix 업로드(x64), 지원 OS 는 매니페스트대로.
   - Store 등록 정보(ko-KR): 설명(독립 실행 사내 메신저·결재·메일·할 일 위젯, 사내 계정 필요), 스크린샷 1장 이상(1366×768 또는 1920×1080 권장 — 로그인 후 홈·대화 화면), 앱 아이콘은 패키지에서 가져옴.
   - 인증 참고 사항(심사관 메모): "사내 직원 전용. 평가용 테스트 계정: ID/비밀번호" — **심사관이 로그인해 볼 수 있는 테스트 계정이 필요**하다(스테이징에 평가용 계정 하나 준비).
5. **심사**: 보통 1~3 일. 웹 콘텐츠 래퍼 정책(10.2.1) 지적이 오면 트레이·뱃지·알림·항상 위 등 네이티브 기능을 설명해 재제출.
6. **배포**: 인증되면 제품 페이지의 Store 링크(`https://apps.microsoft.com/detail/<ProductId>` 또는 `ms-windows-store://pdp/?productid=<ProductId>`)를 웹 홈 "PC 앱 설치" 의 1순위 버튼으로 교체. 직원은 링크 → "설치". 이후 버전은 패키지만 올리면 Store 가 자동 업데이트(버전 네 자리 증가).
7. **후속 정리**: Store 판이 자리 잡으면 .reg 1단계·exe 2단계는 대체 경로로 남기거나 제거.

**준비물 체크리스트**: Microsoft 365 회사 계정(없으면 개인 MSA 로도 회사 계정 등록 가능) · 사업자등록증 PDF(또는 D-U-N-S) · 개인정보처리방침 URL · 지원 이메일 · 스크린샷 1~3장 · 심사용 테스트 계정 · Partner Center 의 Identity 세 값.

## 8. 4차 — 글자 흐림 진단, 선택 표시·대화 틀, 새 대화 팝업 창 (2026-11-06 사용자 요청)

### 8-1. 위젯 글자가 흐릿해 보이는 원인(진단만, 수정은 사용자 결정 대기)
증상: 위젯 화면의 글자·요소가 "캡처한 것처럼" 덜 선명하다(사용자 스크린샷 1558×1522, 배율 150%).

**측정** — 스크린샷에서 글자 가장자리 픽셀의 색 번짐(채널 간 차이)을 쟀다. ClearType(서브픽셀)이면 값이 크고, 회색조 안티앨리어싱이면 0 에 가깝다.

| 위치 | 색 번짐 평균 | 판정 |
|---|---|---|
| 셸 상단 바 "MCM" | 110 | ClearType |
| 셸 상단 바 "항상 위" | 48 | ClearType |
| 앱 헤더 "대화" | 7 | 회색조 |
| 대화 목록 이름 | 6 | 회색조 |
| 대화방 제목 | 6 | 회색조 |

1px 경계선은 번지지 않았다(창 전체가 저해상도로 확대된 것이 아니다). 즉 **같은 창 안에서 상단 바만 ClearType 이고 iframe 안 글자는 전부 회색조**다. Windows 에서 회색조 글자는 획이 굵고 뿌옇게 보인다.

**재현 실험**(Edge = 같은 Chromium 엔진, 배율 150%, 다른 사이트의 iframe 으로 셸 구조를 흉내 냄):

| 조건 | 결과 |
|---|---|
| 최상위 문서 글자 | ClearType |
| iframe, 문서(html) 배경 없음 — 본문 글자 / 흰 상자 위 글자 | 둘 다 회색조 |
| iframe, **문서(html) 배경을 불투명**으로 | ClearType |
| 셸 쪽 iframe 요소에만 흰 배경 | 회색조(효과 없음) |
| `translateZ(0)` 스크롤 층(react-native-web ScrollView·FlatList), 층 안에 불투명 배경 없음 | 회색조 |
| 같은 스크롤 층 + 층 자체나 내용 상자가 불투명 배경 / 흰 카드 위 글자 | ClearType |
| `translateZ(0)` 를 없앤 일반 스크롤 | 150% 에서는 오히려 회색조(없애면 안 됨) |

**원인 두 가지**
1. 위젯은 앱을 다른 오리진의 iframe 으로 싣는데, 앱 문서(html)에 배경색이 없어 Chromium 이 "투명 문서"로 취급한다 → 그 문서의 글자 전체에서 ClearType 이 꺼진다. 브라우저·PWA 로 직접 열면 기본 흰 배경이라 이 문제는 없다(위젯만의 문제).
2. react-native-web 의 스크롤 영역은 `transform: translateZ(0)` 로 별도 합성 층이 되는데, 그 층에 불투명 배경이 없으면(흰 화면의 목록, 그라데이션 위 맨 글자) 글자가 회색조가 된다. 이 부분은 PWA 에서도 같다.

보조 원인: 앱은 웹에서 글꼴을 따로 싣지 않아 한글이 맑은 고딕으로 나온다(웹앱은 Pretendard). 맑은 고딕의 굵은 글자가 회색조로 그려지면 더 뭉개져 보인다.

**수정안(미적용)**
- A. `apps/mobile/src/app/+html.tsx` 에 문서 배경색(라이트 흰색, 다크는 테마 값으로 갱신) — 헤더·제목 등 스크롤 밖 글자가 ClearType 이 된다. 화면 모양은 그대로(셸 그라데이션이 덮는다).
- B. 흰 바탕 화면(`Screen plain`: 대화 목록 등)의 FlatList 에 불투명 배경 — 목록 글자가 ClearType.
- C. 좌측 레일(SideRail)을 불투명 면으로(유리 효과 제거) — 레일 라벨이 ClearType. 레일 뒤에는 흐르는 콘텐츠가 없어 유리 효과의 실익이 작다.
- D. (선택) 웹 번들에 Pretendard 를 실어 웹앱과 같은 글꼴로.
- 한계: 그라데이션 바탕 위에 카드 없이 놓인 맨 글자(날짜 구분선의 시각 등)는 회색조로 남는다. 카드·말풍선 안 글자는 A 만으로 ClearType 이 된다.

### 8-2. 선택 표시(구현)
- `pillSelected` 를 한 단계 옅게: 라이트 `#e6e8ee → #eef0f4`, 다크 `#30333e → #2a2d37`. 위젯 셸 `--pill` 도 같은 값(셸에서는 정의만 있고 쓰는 곳 없음).
- 전수조사 — 이 색을 선택 바탕으로 쓰는 곳은 세 군데뿐이다: 색 점 없는 필터 필(`Chip.tsx` FilterPill — 할 일·입찰·메일 등 필터 줄 전부), 좌측 레일 선택 항목(`SideRail.tsx`), 대화 목록의 열린 방(`chat.tsx` RoomRow). 토큰 한 곳만 바꿔 모바일 앱·위젯·PWA 에 함께 반영된다. 세그먼트 탭("전체·개인·그룹")의 선택은 남색 틴트로 다른 토큰이라 그대로다.
- 대화 목록의 열린 방은 넓은 배치에서 좌우 8 을 들인 **둥근 상자(반경 10)**, 행 구분선 없음. 좁은 배치(모바일)는 구분선 목록 그대로.

### 8-3. 대화 화면 틀(구현)
넓은 배치의 오른쪽 칸과 팝업 창("틀 배치")에서만: 흰 바탕 위에 **대화 영역(그라데이션, 좌우·위 12, 반경 10)** 과 **입력 상자(테두리 1, 반경 10, 좌우·아래 12)** 를 각각 둥근 사각형으로 띄운다. 입력 상자가 입력창 테두리를 대신하고(안쪽 TextInput 은 테두리 없음), 포커스는 상자 테두리 색(primary)으로 보인다. 답장 인용·첨부 미리보기 줄도 같은 상자 안에 들어간다. 모바일 전체 화면 대화방은 그대로.

### 8-4. 새 대화 팝업 창(구현)
- 조건: 넓은 배치에서 오른쪽에 방이 열려 있을 때 + 로 만든 새 대화(같은 방이면 제외).
- 웹앱: `lib/chat-popup.ts` `openChatPopup()` — 위젯이면 셸에 `mcm:open-chat {roomId, name}`, 브라우저·PWA 는 `window.open(/chat/<id>?popup=1)`. 실패하면 거짓 → 지금처럼 오른쪽 칸에 연다.
- 하위 호환: 셸이 hello 에 `caps: ["chat-popup"]` 을 싣는다. 옛 셸(1.4.0 이하)은 caps 가 없으므로 웹앱이 팝업을 요청하지 않는다. **팝업은 위젯 1.5.0 재설치 후부터.**
- 팝업 판정: `IS_CHAT_POPUP`(URL `?popup=1`). 팝업에서는 2분할로 넘기지 않고, 뒤로가기 없이, 방을 나가면 `mcm:close-window`(브라우저는 `window.close()`), 뱃지 폴링은 하지 않는다.
- 셸: `src/chat.html`(상단 바 + 대화방 iframe), 공용 스타일 `src/shell.css` 분리, 창 라벨 `chat-<roomId>`(같은 방은 기존 창을 앞으로), 480×720·최소 360×480. 권한에 `chat-*` 창과 창 생성·표시·포커스·닫기 추가. Rust 는 닫기를 트레이로 숨기는 동작을 주 창에만 적용. 버전 1.5.0.

### 8-4b. 대화방 칸 최대 폭 +30%, 프로필 아이콘 +20% (같은 날 추가 요청)
- 섬 최대 폭은 레일 88 + 콘텐츠 952 = 1040 이라 대화방 칸이 592 에서 멈췄다. **대화 탭에서만** 섬 최대 폭을 88 + 360 + 770 = 1218 로 올렸다(`WEB_SHELL_CHAT_MAX_WIDTH`, 대화방 칸 592 → 770). 레일·목록 폭은 그대로, 다른 탭은 1040 그대로.
- 대화 탭의 섬은 가운데 정렬 대신 **다른 탭과 같은 왼쪽 끝에서 오른쪽으로만** 늘어난다(`_layout.tsx` `WebIsland`) — 탭을 오갈 때 레일·목록이 좌우로 튀지 않는다. 창이 아주 넓으면 좌우 여백이 비대칭이 된다(왼쪽이 더 넓다).
- 말풍선 옆 상대 프로필: 28 → 34(`Avatar` 에 `px` 지정 추가, 자리 폭 32 → 38). 모바일 앱 대화방에도 같이 적용된다. 대화 목록의 아바타(40)는 그대로.
- 확인: 창 폭 1500 에서 섬 x=230·폭 1218, 대화방 칸 770, 메일 탭은 섬 x=230·폭 1040(레일 위치 동일), 프로필 34.

### 8-5. 검증
- `npx tsc --noEmit` 수정 파일 0건, eslint 는 기존 오류 3건(수정 전과 동일)만, `npm run test:manual` 9/9, `cargo check` 통과.
- 로컬 웹 미리보기(가짜 API): 2분할의 둥근 선택 행·대화 틀·입력 상자(라이트/다크), 입력 포커스 테두리, `/chat/2?popup=1` 이 넓은 창에서도 방 하나만(뒤로가기·레일 없음), 좁은 창 `/chat/2` 는 기존 모양.
- 위젯 개발 빌드(별도 식별자, 원격 디버깅): 잘못된 방 번호 무시, 팝업 열림(chat-2·480×720·장식 없음·주소 정확), 같은 방 재요청 시 창 1개 유지, 다른 방은 창 추가, 항상 위 토글, 닫기·`mcm:close-window` 로 실제 닫힘, 주 창 닫기는 숨김.
- 미검증: 실제 로그인 상태의 위젯에서 + → 팝업까지의 전 구간(웹앱 재export·배포와 위젯 1.5.0 설치 후 사용자 확인), 브라우저·PWA 의 `window.open` 경로(팝업 차단 설정에 따라 다름), 네이티브 앱 실기기.
- 남은 일: `npm run export:web` 재export, 위젯 1.5.0 릴리스 빌드 후 `frontend/public/downloads/MCM-widget-setup.exe` 교체 — 커밋·배포 때 함께.

## 9. 5차 — 홈 2열 배치, 빠른 실행 편집, 글자 흐림 수정 적용 (2026-11-06 사용자 요청)

### 9-1. 홈 2열(넓은 창, 폭 ≥ 900)
세로 한 줄을 그대로 늘리던 홈을 좌우 2열로 나눴다(`apps/mobile/src/app/(tabs)/index.tsx`). 카드 부품은 한 벌이고 배치만 다르다. 좁은 창·네이티브는 기존 한 줄 순서 그대로다.

| 왼쪽 | 오른쪽 |
|---|---|
| 날씨 위젯 | 일정 카드: 달력(위) + 오늘 일정(아래) — 높이 = 왼쪽 날씨 + 요약 스트립 |
| 요약 스트립 2줄 | 경과 미입력(영업 담당자) 또는 근태·휴가(그 외) |
| 빠른 실행 | 오늘 할 일 |
| 결재 대기 | 최근 공지 |
| 안읽은 메일 | |
| (사용자 위젯) | |

- **일정 카드**(`components/home/HomeCalendarCard.tsx`): 일정 화면과 같은 통합 조회(`/api/calendar`)·같은 태그 설정을 쓴다. 달력은 `MonthCalendar` 의 새 `dots` 변형(바 대신 색 점, 셀 높이 38 고정, 다른 달만 있는 주는 숨김)과 `bare`(바깥 카드 없음). 휴무일은 붉은 숫자 + 휴무일명(당월 휴무일이 있는 주만 12 높아진다) — 처음에는 이름을 뺐다가 사용자 지적으로 넣었다. 로컬 미리보기에서 공휴일이 전혀 안 보였던 것은 시험용 가짜 API 가 휴무일을 빈 목록으로 돌려줬기 때문이며 DB 문제가 아니다(실서버는 `/api/home/holidays` 가 법정공휴일 + 사내 지정 휴무일을 준다). 카드 높이는 왼쪽 "날씨 + 요약 스트립" 묶음을 `onLayout` 으로 재서 맞추고, 남는 높이가 오늘 일정 목록이 된다(넘치면 목록 안에서 스크롤). 날짜·일정을 누르면 일정 화면으로 간다.
- **영업 담당자 판정**: 영업 제설정의 영업 담당자 지정은 영업 메뉴 권한(sales.view)으로 이어진다. 홈 위젯 권한 목록(`/api/home/layout` 의 available)에 "경과 미입력"이 있으면 영업 담당자로 본다(대표이사·관리자 포함). 서버 변경 없음.
- **근태·휴가 카드**(`components/home/AttendanceLeaveCard.tsx`, 신설): 근태·휴가 화면과 같은 데이터원에서 남은 연차 / 이번 주 근무 / 초과근무 세 숫자. 높이는 빠른 실행 카드와 같게 맞춘다.
- **목록 카드 높이 고정**: 결재 대기·안읽은 메일·오늘 할 일·최근 공지의 본문을 3건 높이(200)로 고정 — 건수가 없어도 좌우 줄이 맞는다. 오늘 할 일은 건수가 3건을 넘으면 그만큼 늘어난다.
- 2열에서는 영업 활동 기준의 "오늘 일정" 카드를 빼고 일정 카드의 오늘 일정이 대신한다.

### 9-2. 빠른 실행 편집(모바일 앱·위젯 공통, 모든 계정)
- 카드 오른쪽 위 "편집" → 시트에서 기능을 고른다(최대 8개, 고른 순서대로). 고를 수 있는 기능 목록은 `apps/mobile/src/lib/quick-actions.ts` 가 단일 원천(16종).
- 저장은 계정별로 서버에: `/api/home/layout` PUT 에 `quickActions`(키 배열, null = 기본 구성). 마이그레이션 없이 기존 `home_layouts.layout`(jsonb) 안의 `mobileQuick` 키로 보관한다. 웹 홈의 배치 저장은 이 값을 건드리지 않는다.
- 휴대폰과 PC 가 같은 구성을 쓴다. 카메라가 필요한 명함·영수증은 PC 목록에 없고, PC 에서 저장해도 구성에 남겨 휴대폰에서 사라지지 않는다.
- 서버가 아직 옛 버전이면 저장 요청은 무시되고 기본 구성이 보인다 → **next 배포가 먼저**.

### 9-3. 위젯 초기 창 크기
- 1000×860 → **1040×1060**. 폭 1040 은 섬 최대 폭(2열이 꽉 차는 폭), 높이는 홈에서 결재 대기 카드 아래까지 보이는 값(상단 바 38 + 카드 아래 1005 + 여백). 그 아래는 스크롤(스크롤바 없음).
- FHD 에서는 1060 이 세로를 가득 채운다(작업 영역 높이: 배율 100% 약 1032, 125% 약 816). 사용자 결정(11-06): **처음 실행할 때 높이를 작업 영역의 85% 까지로 제한**하고 가운데에 놓는다(`lib.rs` `fit_main_window_to_monitor`·`is_first_run` — 저장된 창 상태 파일이 없을 때). FHD 100% 는 약 877, 125% 는 약 694 로 열리고 아래는 스크롤. 그 뒤에는 사용자가 정한 크기를 존중하고, 작업 영역보다 클 때만 줄인다.
- 확인: 개발 빌드에 일부러 큰 높이(2000)를 주고 처음 실행 → 바깥 높이 1775(작업 영역 2088 의 85%), 작업 영역 가운데 배치.
- 이미 설치해 쓰던 PC 는 저장된 창 크기가 복원되므로 새 초기 크기는 **처음 설치하는 PC** 에 적용된다(기존 PC 는 창을 한 번 늘려 두면 기억된다).

### 9-4. 글자 흐림 수정(§8-1 의 A·B·C 적용)
- A. `+html.tsx` 에 문서 배경색(라이트 #f1f3f9·다크 #141520) + `_layout.tsx` 가 앱 테마에 맞춰 실행 중 갱신.
- B. 대화 목록 FlatList 와 일정 카드의 오늘 일정 스크롤에 불투명 바탕.
- C. 좌측 레일을 불투명 카드 면으로(backdrop-filter 제거).
- D(Pretendard 싣기)는 적용하지 않았다. 모바일 앱은 글꼴 파일을 싣지 않아 네이티브는 OS 기본 글꼴, 웹(위젯)은 맑은 고딕으로 나온다(global.css 에 Pretendard 이름만 선언돼 있고 쓰이지 않는다).
- 확인 범위: 원리는 §8-1 의 재현 실험으로 확인했다. 실제 앱 화면에서의 픽셀 측정은 시험 창이 다른 창에 가려 끝내지 못했다 — 배포 후 위젯에서 확인이 필요하다.

### 9-5. 검증
- `npx tsc --noEmit`(앱·서버) 수정 파일 0건, eslint 는 기존 오류만, `cargo check` 통과.
- 로컬 미리보기(가짜 API): 2열 배치(라이트·다크), 일정 카드 높이 = 날씨 + 요약 스트립(472), 근태·휴가 = 빠른 실행(153), 목록 카드 4종 269 로 동일·좌우 줄 일치, 영업 담당자/그 외 전환, 편집 시트에서 "할 일" 추가 후 저장 → 타일·서버 값 반영, 폭 560 에서는 기존 한 줄.
- 미검증: 실서버에서의 빠른 실행 저장(로컬은 가짜 API), 네이티브 실기기, 위젯 1.5.0 설치본의 새 창 크기·작은 화면 맞춤, 흐림 수정의 실화면 효과.

### 9-6. 선택 배경색 재조정(같은 날)
`pillSelected` 를 한 번 더 옅게: 라이트 `#eef0f4 → #f2f3f7`, 다크 `#2a2d37 → #272a33`(위젯 셸 `--pill` 동일). surface(#f6f7f9)보다는 한 단계 진하게 남겨 흰 바탕 위에서 선택이 보인다.
