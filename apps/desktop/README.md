# MCM 데스크탑 위젯 (WID-P0 · P1)

사내 메신저를 상주형으로 쓰기 위한 데스크탑 셸. **화면(콘텐츠)은 이 저장소에 없다** —
실행할 때마다 `https://koensain.app/m-app`(모바일 앱의 Expo 웹 빌드)을 그대로 로드한다.

- 앱 기능 업데이트 = **next 배포로 끝**(위젯 재설치 불필요). 위젯을 다시 만드는 경우는
  트레이·알림 같은 셸 기능이 바뀔 때뿐이다.
- 모바일 앱과 화면·기능이 100% 같다(같은 번들). 카메라가 필요한 명함 촬영만 웹에서 숨긴다.

## 왜 Tauri 인가
Electron 은 크로미움을 통째로 동봉해 설치본이 150MB+ 지만, Tauri 는 Windows 에 이미 있는
**WebView2** 를 빌려 쓰므로 설치본이 수 MB 다. 셸이 하는 일(트레이·창·알림·자동시작)은
전부 Tauri 공식 플러그인으로 덮인다. 콘텐츠가 원격이라 셸이 얇고, 필요하면 같은 URL 을 여는
Electron 셸로 갈아타는 비용도 하루 수준이다(락인 없음).

## 개발 환경 (Windows)
1. **WebView2 런타임** — Windows 11 기본 포함(대부분 이미 있음)
2. **VS Build Tools(C++ 데스크탑 개발)** — MSVC 링커
3. **Rust stable** — `https://win.rustup.rs/x86_64` (rustup-init)

## 명령
```
npm install          # @tauri-apps/cli
npm run icon         # 모바일 앱 아이콘으로 트레이·창·인스톨러 아이콘 생성(최초 1회)
npm run dev          # 개발 실행(원격 로드라 dev 서버 불필요)
npm run build        # NSIS 인스톨러 생성 → src-tauri/target/release/bundle/nsis/
```

## 동작
- 창 560×860(최소 360×520), 자유 리사이즈, 위치·크기 기억(window-state 플러그인)
- 닫기(X) = 트레이로 숨김(종료 아님). 트레이 아이콘 클릭 = 창 토글,
  우클릭 = 메뉴(**MCM 열기 · 종료**). "항상 위 고정"은 창 상단 바의 토글이 단일 소스다.
- **중복 실행 차단**(single-instance) — 시작 메뉴·바탕화면에서 다시 눌러도 새 창이 뜨지 않고
  트레이에 숨어 있던 원래 창이 앞으로 나온다.
- **미읽음 뱃지·OS 알림**(P1) — 웹앱이 15초마다 미읽음을 postMessage 로 올리면 셸이
  트레이 아이콘에 빨간 점, 작업표시줄에 숫자 뱃지를 그리고 새 메시지면 Windows 알림을 띄운다.
  창을 보고 있는 중(표시 + 포커스)에는 알림을 생략한다.
- 로그인 상태는 웹뷰 저장소에 남아 재시작해도 유지된다(모바일과 같은 토큰 방식).
  로그인 화면의 "자동 로그인"을 끄면 다음 실행 때 다시 로그인해야 한다.

### iframe ↔ 셸 브리지
웹앱은 원격 오리진(`koensain.app`)이라 `window.__TAURI__` 가 주입되지 않는다. 그래서
`postMessage` 로만 대화한다 — 웹앱이 `mcm:widget-ready` 를 올리면 셸이 `mcm:widget-hello` 로
자기 오리진을 밝히고, 그때부터 웹앱이 `mcm:unread`(count + 최근 메시지)를 그 오리진으로만 보낸다.
셸 쪽 수신부는 `src/index.html`, 웹앱 쪽은 `apps/mobile/src/lib/use-widget-bridge.ts`.

> ⚠ `tauri.conf.json` 의 `dragDropEnabled: false` 는 **웹 드래그앤드롭을 살리기 위한 필수 설정**이다.
> 기본값(true)이면 Tauri 가 OS 드롭을 가로채 웹뷰에 DOM `drop` 이벤트가 오지 않는다.

## 설치 (사내 배포)
`npm run build` 산출물(`src-tauri/target/release/bundle/nsis/MCM_<ver>_x64-setup.exe`)을
`frontend/public/downloads/MCM-widget-setup.exe` 로 복사해 두면 **웹 홈 우상단 "데스크탑 위젯 설치"**
버튼에서 내려받을 수 있다. 셸이 바뀔 때만 이 과정을 반복하면 되고, 앱 화면·기능 변경은
next 배포(=`/m-app` 갱신)만으로 위젯에 반영된다.

**반드시 인스톨러(setup.exe)로 설치한다.** `target/release/MCM.exe` 를 직접 실행하면 그 자리에서
돌기만 할 뿐 **시작 메뉴·앱 목록에 등록되지 않아 껐다 켤 방법이 없다**(2026-08-10 실측).
인스톨러가 하는 일:
- `%LOCALAPPDATA%\MCM` 에 설치(관리자 권한 불필요 — `installMode: currentUser`)
- **시작 메뉴에 "MCM" 등록** + 마지막 화면의 체크박스로 바탕화면 바로가기
- **설정 > 앱**(HKCU Uninstall)에 등록 → 제거도 여기서

버전을 올릴 때는 `src-tauri/tauri.conf.json` 과 `Cargo.toml` 의 `version` 을 함께 올린다
(NSIS 가 같은 제품을 덮어쓰며 업그레이드한다).
