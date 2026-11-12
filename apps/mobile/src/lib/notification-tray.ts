/**
 * 알림 센터·앱 아이콘 배지 정리(2026-11-12) — 읽은 대화·메일의 알림이 남아 숫자가 줄지 않던 결함 대응.
 *
 * - 앱 아이콘 숫자: 탭 배지와 같은 합계(안읽은 메일+미결재+안읽은 대화)로 맞춘다. 서버도 푸시에 같은 합계를 싣는다.
 * - 알림 센터: 앱에서 직접 방·메일을 열어 읽으면 그 알림이 센터에 남아(안드로이드 런처는 남은 알림 수를 숫자로 보인다)
 *   읽은 뒤에도 표시가 사라지지 않았다 → 읽은 대상의 알림을 지운다.
 * 웹 번들(데스크탑 위젯·PWA)은 notification-tray.web.ts 의 no-op 이 대신 쓰인다(expo-notifications 가 웹에서 던짐).
 */
import * as Notifications from "expo-notifications";

/** 앱 아이콘 배지 숫자. */
export async function syncAppBadge(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, Math.floor(count)));
  } catch {
    /* 런처가 배지를 지원하지 않는 기기 등 — 조용히 */
  }
}

/** data.link 가 조건에 맞는 알림을 알림 센터에서 지운다. */
async function dismissWhere(match: (link: string) => boolean): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const n of presented) {
      const link = (n.request.content.data as { link?: unknown } | undefined)?.link;
      if (typeof link === "string" && match(link)) {
        await Notifications.dismissNotificationAsync(n.request.identifier);
      }
    }
  } catch {
    /* 지우기 실패는 표시만 남을 뿐 — 조용히 */
  }
}

/** 그 대화방의 새 메시지·멘션 알림을 지운다(읽음 처리 직후). */
export function dismissChatNotifications(roomId: number): Promise<void> {
  return dismissWhere((link) => link.split("?")[0] === `/chat/${roomId}`);
}

/** 그 메일의 알림과, 여러 통을 묶은 "새 메일 N통" 알림을 지운다(메일을 연 직후). */
export function dismissMailNotifications(messageId: string): Promise<void> {
  return dismissWhere((link) => {
    const [path, query] = link.split("?");
    if (path !== "/mail") return false;
    const id = new URLSearchParams(query ?? "").get("id");
    return !id || id === messageId;
  });
}
