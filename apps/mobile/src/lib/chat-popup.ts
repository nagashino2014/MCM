import { Platform } from 'react-native';

import { IS_CHAT_POPUP, IS_IN_WIDGET } from './platform';
import { postToShell, shellSupports } from './use-widget-bridge';

/** 팝업 창 크기(브라우저·PWA 의 window.open). 위젯 셸은 같은 값을 apps/desktop/src/index.html 에서 쓴다. */
const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 720;

/**
 * 대화 팝업 창(2026-11-06 사용자 요청) — 넓은 배치에서 오른쪽 칸에 이미 대화방이 열려 있을 때, 새 대화는 그 방을
 * 밀어내지 않고 **별도 창**으로 띄운다.
 *  - 데스크탑 위젯: 원격 오리진이라 창을 직접 못 만든다 → 셸(Tauri)에 mcm:open-chat 을 보내면 셸이 chat-<roomId> 창을 연다.
 *    'chat-popup' 기능을 밝히지 않은 옛 셸(1.4.0 이하)에는 보내지 않는다 → 호출부가 지금처럼 오른쪽 칸에 연다.
 *  - 브라우저·PWA: window.open 으로 /chat/<roomId>?popup=1 을 연다(차단되면 거짓).
 * 네이티브와 팝업 창 안에서는 항상 거짓.
 */
export function openChatPopup(roomId: number, name?: string): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || IS_CHAT_POPUP) return false;
  if (!Number.isSafeInteger(roomId) || roomId <= 0) return false;
  if (IS_IN_WIDGET) {
    if (!shellSupports('chat-popup')) return false;
    return postToShell({ type: 'mcm:open-chat', roomId, name: name ?? '' });
  }
  // 정적 export 는 /m-app 아래, 개발 서버는 루트.
  const base = window.location.pathname.startsWith('/m-app') ? '/m-app' : '';
  const qs = new URLSearchParams({ popup: '1' });
  if (name) qs.set('name', name);
  const w = window.open(
    `${base}/chat/${roomId}?${qs.toString()}`,
    `mcm-chat-popup-${roomId}`,
    `popup=yes,width=${POPUP_WIDTH},height=${POPUP_HEIGHT}`
  );
  if (!w) return false;
  w.focus();
  return true;
}

/** 팝업 창 닫기 — 방을 나갔을 때. 위젯은 셸에 맡기고, 브라우저 팝업은 스스로 닫는다. */
export function closeChatPopup(): void {
  if (!IS_CHAT_POPUP || typeof window === 'undefined') return;
  if (window.parent !== window) postToShell({ type: 'mcm:close-window' });
  else window.close();
}
