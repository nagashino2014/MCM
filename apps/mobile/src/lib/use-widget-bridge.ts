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

interface DueItem {
  itemId: string;
  title: string;
  doDate: string | null;
  dueDate: string | null;
}

const POLL_MS = 15000;

/** 위젯 PC 의 오늘(YYYY-MM-DD, 로컬). */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 데스크탑 위젯 브리지(WID-P1·P3) — 미읽음 수와 최근 메시지, 그리고 오늘 할 일·지연 건수를 셸(Tauri)로 올린다.
 * 셸은 이 값으로 트레이 뱃지·작업표시줄 카운트(미읽음 + 오늘 할 일 합산)·OS 알림을 그린다.
 *   mcm:unread   — 메신저 미읽음(count, latest 메시지)
 *   mcm:todo-due — 오늘까지 해야 하는 할 일(count=오늘·지연 건수, latest 는 하루 1회 알림 키)
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
      try {
        // 할 일(274) — 다음 24시간의 예정·마감·지연 중 오늘까지인 것만 센다(내일 것은 뱃지에 넣지 않는다).
        const t = await apiJson<{ count: number; items: DueItem[] }>('/api/todo/due-soon?hours=24');
        if (!alive || !shellOrigin) return;
        const today = todayLocal();
        const dueToday = (t.items ?? []).filter((x) => (x.doDate && x.doDate <= today) || (x.dueDate && x.dueDate <= today));
        window.parent.postMessage(
          {
            type: 'mcm:todo-due',
            count: dueToday.length,
            latest: dueToday.length
              ? {
                  // 날짜가 키 — 같은 날에는 건수가 바뀌어도 알림을 다시 띄우지 않는다(뱃지만 갱신).
                  key: `todo:${today}`,
                  title: `오늘 할 일 ${dueToday.length}건`,
                  body: dueToday
                    .slice(0, 3)
                    .map((x) => x.title)
                    .join(' · '),
                }
              : null,
          },
          shellOrigin
        );
      } catch {
        // 277 미적용·권한 없음 등 — 메신저 뱃지에는 영향 없음.
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
