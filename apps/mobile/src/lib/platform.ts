import { Platform } from 'react-native';

/**
 * 실행 환경 판정(웹 전용) — 데스크탑 위젯·PWA·폰 목업 데모를 한 곳에서 가른다(2026-11-04).
 * 모듈 평가 시점에 한 번 정한다. window.name 은 SPA 네비게이션·리로드에도 유지되므로 첫 렌더에 동기 판정할 수 있다.
 * 정적 렌더(export) 시점에는 window 가 없어 전부 "일반 웹" 으로 그려지고, 브라우저에서 하이드레이션 뒤 실제 값으로 바뀐다.
 */
const win = Platform.OS === 'web' && typeof window !== 'undefined' ? window : null;

/** 폰 목업 데모(m-demo.html) — 부모 iframe 이 name="mcm-phone-demo" 로 자신을 밝힌다. 390px 좁은 화면이라 네이티브와 같은 하단 탭으로 그린다. */
export const IS_PHONE_DEMO = !!win && win.name === 'mcm-phone-demo';

/** 데스크탑 위젯·브라우저·PWA — 하단 글라스 탭 바 대신 **좌측 세로 레일**(SideRail)로 그리는 기준. */
export const IS_WEB_RAIL = Platform.OS === 'web' && !IS_PHONE_DEMO;

/** 데스크탑 위젯(Tauri 셸)의 iframe 안 — 셸이 뱃지·알림을 맡으므로 PWA 설치 안내·배지 API 를 쓰지 않는다. */
export const IS_IN_WIDGET = !!win && win.parent !== win && !IS_PHONE_DEMO;

/** 브라우저 "앱으로 설치" 로 열린 창(PWA standalone) — 작업표시줄 뱃지(Badging API)를 직접 그린다. */
export const IS_STANDALONE_PWA =
  !!win && typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches;

/**
 * 대화 팝업 창(2026-11-06) — 넓은 배치에서 이미 방이 열려 있을 때 새 대화는 별도 창으로 띄운다(lib/chat-popup.ts).
 * 그 창은 URL 에 ?popup=1 을 달고 열린다(window.name 은 대화방 화면이 덮어쓰므로 쓰지 않는다). 팝업 안에서는
 * 2분할로 넘기지 않고 대화방 하나만 그리며, 뒤로가기 대신 창 닫기를 쓴다.
 */
export const IS_CHAT_POPUP = !!win && new URLSearchParams(win.location.search).get('popup') === '1';

/**
 * 마우스·물리 키보드로 쓰는 웹(데스크탑 위젯·PC 브라우저·PC 에 설치한 PWA) — 대화 입력창에서 Enter 가 전송, Shift+Enter 가 줄바꿈이다.
 * 휴대폰 브라우저(터치 키보드)는 주 포인터가 coarse 라 빠지고, 거기서는 네이티브처럼 Enter 가 줄바꿈으로 남는다.
 */
export const IS_DESKTOP_WEB =
  IS_WEB_RAIL && !!win && typeof win.matchMedia === 'function' && win.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** 넓은 배치(목록+상세 2분할·홈 2열)를 켜는 창 폭 — 설계안 §6-3(2026-11-04). 이보다 좁으면 모바일 흐름(한 화면씩). */
export const WIDE_MIN_WIDTH = 900;

/** 레일 레이아웃의 콘텐츠 최대 폭(레일 88 포함) — 창을 최대화해도 늘어지지 않게 가운데 섬으로 둔다. 넓은 배치 기준 952 + 레일 88. */
export const WEB_SHELL_MAX_WIDTH = 88 + 952;

/** 대화 2분할의 왼쪽 목록 폭(고정). */
export const CHAT_LIST_PANE_WIDTH = 360;

/**
 * 대화 탭에서만 쓰는 섬 최대 폭(2026-11-06 사용자 요청) — 오른쪽 대화방 칸을 지금 최대(952 − 360 = 592)보다 30% 넓은 770 까지
 * 넓힐 수 있게 한다. 레일 88·목록 360 은 그대로다. 다른 탭은 WEB_SHELL_MAX_WIDTH 그대로.
 */
export const WEB_SHELL_CHAT_MAX_WIDTH = 88 + CHAT_LIST_PANE_WIDTH + 770;
