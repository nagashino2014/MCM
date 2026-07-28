import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";

import { useAuth } from "./auth-context";
import { registerForPush } from "./push";
import { routeForLink } from "./deeplink";

/**
 * 푸시 배선 — 로그인 상태에서 토큰을 갱신하고, 알림 탭 시 해당 화면으로 이동한다.
 *
 * 알림 탭은 두 경로로 들어온다: 실행 중이면 리스너, 앱이 꺼져 있었으면 `useLastNotificationResponse`.
 * 같은 알림이 두 번 처리되지 않도록 처리한 식별자를 기억한다.
 */
export function usePushSetup(): void {
  const { status } = useAuth();
  const router = useRouter();
  const lastResponse = Notifications.useLastNotificationResponse();
  const handled = useRef<Set<string>>(new Set());

  // 앱 시작·로그인 직후 토큰 갱신(권한이 이미 허용된 경우에만 — 권한 요청은 설정 화면에서).
  useEffect(() => {
    if (status !== "authed") return;
    void registerForPush(false);
  }, [status]);

  const open = (data: unknown, id: string) => {
    if (handled.current.has(id)) return;
    handled.current.add(id);
    const link = (data as { link?: string } | undefined)?.link;
    const route = routeForLink(link);
    if (route) router.push(route);
  };

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      if (status !== "authed") return;
      open(res.notification.request.content.data, res.notification.request.identifier);
    });
    return () => sub.remove();
    // router/open 은 매 렌더 새로 만들어지므로 status 만 의존한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // 알림을 눌러 앱이 켜진 경우(콜드 스타트).
  useEffect(() => {
    if (status !== "authed" || !lastResponse) return;
    open(
      lastResponse.notification.request.content.data,
      lastResponse.notification.request.identifier
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, lastResponse]);
}
