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

### 6-4. ①② 구현 결과 (2026-11-04, 사용자 결정 "설계안대로 진행")
- `lib/platform.ts`: `WIDE_MIN_WIDTH = 900`, `WEB_SHELL_MAX_WIDTH = 88 + 952`. `lib/use-wide-layout.ts`: `useWideLayout()` = 레일 환경 && 창 폭 ≥ 900.
- `app/chat/[roomId].tsx`: 본문을 `ChatRoomView({ roomId, name, embedded, onLeft })` 로 부품화. 라우트 default export 는 넓은 배치면 `/(tabs)/chat?roomId=` 로 replace(알림·검색 딥링크 대응), 아니면 전체 화면 방. embedded 면 안전영역 없음·뒤로가기 없음·나가기는 onLeft.
- `app/(tabs)/chat.tsx`: 넓은 배치면 왼쪽 목록 360(검색·세그먼트·FAB 그대로, 선택 행 pillSelected) + 오른쪽 `ChatRoomView embedded`(미선택 시 빈 안내). 방 선택·검색 결과·새 대화 생성 모두 `openRoom()` 한 곳 — 넓으면 선택만, 아니면 라우트 이동. 파라미터 선택 동기화는 effect 가 아닌 파생 상태 패턴.
- 위젯 창 기본 1000×860(최소 560×520).
- 미구현(③④): 메일·결재 2분할, 홈 2열·전체 메뉴 3열 — ①② 확인 뒤.
- 위젯 1.4.0 빌드 완료(`MCM_1.4.0_x64-setup.exe` 1.27MB) → `frontend/public/downloads/MCM-widget-setup.exe` 교체. 서명은 환경변수가 없어 생략(스크립트가 "서명 생략" 을 찍고 통과).
  ⚠ 첫 빌드는 `failed to run powershell` 로 실패 — `sign.ps1` 에 한글 주석이 있는데 **UTF-8 BOM 이 없어 PowerShell 5.1 이 ANSI 로 읽다 파싱 오류**(exit 1). BOM(utf-8-sig)+CRLF 로 저장해 해결. 한글이 든 .ps1 은 BOM 필수.
