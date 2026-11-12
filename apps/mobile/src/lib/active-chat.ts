/**
 * 지금 화면에 띄워 둔 대화방(2026-11-12) — 그 방의 새 메시지 푸시는 앱이 켜져 있는 동안 배너를 띄우지 않는다.
 * (서버는 누가 어느 방을 보고 있는지 모르므로, 생략은 앱이 받는 순간 판단한다 — lib/push.ts 의 알림 처리기.)
 * 대화방 화면이 포커스를 얻으면 set, 잃으면 clear 한다. 순수 모듈이라 웹 번들에서도 안전하다.
 */
let activeRoomId: number | null = null;

export function setActiveChatRoom(roomId: number | null): void {
  activeRoomId = roomId;
}

/** roomId 를 넘기면 그 방이 지금 활성일 때만 해제한다(화면 전환 순서가 겹쳐도 다른 방을 지우지 않게). */
export function clearActiveChatRoom(roomId?: number): void {
  if (roomId == null || activeRoomId === roomId) activeRoomId = null;
}

export function getActiveChatRoom(): number | null {
  return activeRoomId;
}

/** 푸시 data.link 가 지금 보고 있는 방의 링크(/chat/{roomId})인지. */
export function isActiveChatLink(link: unknown): boolean {
  if (activeRoomId == null || typeof link !== "string") return false;
  return link.split("?")[0] === `/chat/${activeRoomId}`;
}
