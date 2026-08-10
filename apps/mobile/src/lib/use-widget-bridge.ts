import { useEffect } from 'react';
import { Platform } from 'react-native';

import { apiJson } from './api';

interface BridgeRoom {
  roomId: number;
  name: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  muted: boolean;
}

const POLL_MS = 15000;

/**
 * 데스크탑 위젯 브리지(WID-P1) — 미읽음 수와 최근 메시지를 셸(Tauri)로 올린다.
 * 셸은 이 값으로 트레이 뱃지·작업표시줄 카운트·OS 알림을 그린다.
 *
 * 웹앱은 원격 오리진이라 Tauri API 를 직접 못 쓴다. 그래서 postMessage 로만 대화하고,
 * **셸이 먼저 hello 로 자기 오리진을 밝힌 뒤에만** 전송한다(대상 오리진을 '*' 로 흘리지 않기 위함).
 * 위젯이 아닌 브라우저·데모 페이지에서는 hello 가 오지 않으므로 아무 것도 하지 않는다.
 */
export function useWidgetBridge(authed: boolean) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !authed) return;
    if (typeof window === 'undefined' || window.parent === window) return;

    let shellOrigin: string | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let alive = true;

    const tick = async () => {
      if (!shellOrigin) return;
      try {
        const r = await apiJson<{ rooms: BridgeRoom[] }>('/api/chat/rooms');
        if (!alive || !shellOrigin) return;
        const rooms = r.rooms ?? [];
        const count = rooms.reduce((s, x) => s + (Number(x.unreadCount) || 0), 0);
        const latest = rooms
          .filter((x) => x.unreadCount > 0 && !x.muted && x.lastMessageAt)
          .sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)))[0];
        window.parent.postMessage(
          {
            type: 'mcm:unread',
            count,
            latest: latest
              ? {
                  key: `${latest.roomId}:${latest.lastMessageAt}`,
                  title: latest.name,
                  body: latest.lastMessagePreview ?? '새 메시지가 도착했습니다.',
                }
              : null,
          },
          shellOrigin
        );
      } catch {
        // 브리지 실패는 조용히 — 앱 동작에는 영향이 없다.
      }
    };

    const onMessage = (e: MessageEvent) => {
      if (!e.data || (e.data as { type?: string }).type !== 'mcm:widget-hello') return;
      if (shellOrigin) return;
      shellOrigin = e.origin;
      void tick();
      timer = setInterval(() => void tick(), POLL_MS);
    };

    window.addEventListener('message', onMessage);
    // 셸이 iframe 로드 시점을 놓쳐도 되도록 이쪽에서 먼저 알린다(내용 없는 신호).
    window.parent.postMessage({ type: 'mcm:widget-ready' }, '*');

    return () => {
      alive = false;
      window.removeEventListener('message', onMessage);
      if (timer) clearInterval(timer);
    };
  }, [authed]);
}
