/**
 * 웹 번들(데스크탑 위젯·PWA·디자인 미리보기)에는 앱 알림 센터·아이콘 배지가 없다 — no-op.
 * (위젯 트레이·작업표시줄 배지는 use-widget-bridge.ts 가 따로 맡는다.)
 */
export async function syncAppBadge(_count: number): Promise<void> {}

export async function dismissChatNotifications(_roomId: number): Promise<void> {}

export async function dismissMailNotifications(_messageId: string): Promise<void> {}
