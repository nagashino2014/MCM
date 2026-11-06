import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { apiJson } from './api';
import { IS_CHAT_POPUP, IS_STANDALONE_PWA } from './platform';

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

/**
 * 셸(Tauri 상단 바 문서)의 오리진과 지원 기능 — hello 로 받은 값을 모듈에 보관해 훅 밖(lib/chat-popup.ts)에서도 쓴다.
 * caps 는 셸 버전에 따라 다르다: 'chat-popup'(1.5.0~) 이 없으면 옛 셸이므로 팝업 요청을 보내지 않는다.
 */
let knownShellOrigin: string | null = null;
let knownShellCaps: string[] = [];

/** 셸이 이 기능을 지원하는가(hello 를 받기 전·브라우저에서는 항상 거짓). */
export function shellSupports(cap: string): boolean {
  return !!knownShellOrigin && knownShellCaps.includes(cap);
}

/** 셸로 메시지를 보낸다 — 오리진을 아는 경우에만('*' 로 흘리지 않는다). 보냈으면 참. */
export function postToShell(msg: Record<string, unknown>): boolean {
  if (!knownShellOrigin || typeof window === 'undefined' || window.parent === window) return false;
  window.parent.postMessage(msg, knownShellOrigin);
  return true;
}

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
 *
 * PWA(브라우저 "앱으로 설치" 창, 2026-11-04)에는 셸이 없으므로 같은 폴링으로 **작업표시줄 뱃지(Badging API)** 를 직접 그린다
 * (미읽음 + 오늘 할 일). OS 알림(Web Push)은 서버 VAPID 가 필요해 후속.
 *
 *   mcm:theme    — 앱 테마(dark 여부)를 셸 상단 바에 맞춘다(로그인 전에도, 11-04). 셸의 hello 뒤에만 보낸다.
 *   mcm:open-chat / mcm:close-window — 대화 팝업 창 열기·닫기(11-06, lib/chat-popup.ts 가 postToShell 로 보낸다).
 */
export function useWidgetBridge(authed: boolean, dark = false) {
  const themeOriginRef = useRef<string | null>(null);

  // 테마 동기화 — 인증과 무관. hello 로 셸 오리진을 알게 되면 즉시, 이후 테마가 바뀔 때마다(effect 재실행) 보낸다.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || window.parent === window) return;
    const send = () => {
      if (themeOriginRef.current) window.parent.postMessage({ type: 'mcm:theme', dark }, themeOriginRef.current);
    };
    const onMessage = (e: MessageEvent) => {
      if (!e.data || (e.data as { type?: string }).type !== 'mcm:widget-hello') return;
      themeOriginRef.current = e.origin;
      if (e.source === window.parent) {
        knownShellOrigin = e.origin;
        const caps = (e.data as { caps?: unknown }).caps;
        knownShellCaps = Array.isArray(caps) ? caps.filter((x): x is string => typeof x === 'string') : [];
      }
      send();
    };
    window.addEventListener('message', onMessage);
    send();
    // 셸이 iframe 로드 시점을 놓쳤거나 앱이 늦게 떴을 때를 위한 준비 신호(내용 없음) — 로그인 전·팝업 창에서도 보낸다.
    if (!themeOriginRef.current) window.parent.postMessage({ type: 'mcm:widget-ready' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, [dark]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !authed) return;
    if (typeof window === 'undefined') return;
    // 대화 팝업 창은 뱃지·알림을 맡지 않는다(주 창이 이미 같은 폴링을 한다).
    if (IS_CHAT_POPUP) return;
    const inFrame = window.parent !== window;
    const badgeApi = !inFrame && IS_STANDALONE_PWA && typeof navigator.setAppBadge === 'function';
    if (!inFrame && !badgeApi) return;

    let shellOrigin: string | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let alive = true;

    const tick = async () => {
      if (!shellOrigin && !badgeApi) return;
      let unread = 0;
      let due = 0;
      try {
        const r = await apiJson<{ rooms: BridgeRoom[] }>('/api/chat/rooms');
        if (!alive) return;
        const rooms = r.rooms ?? [];
        const count = rooms.reduce((s, x) => s + (Number(x.unreadCount) || 0), 0);
        unread = count;
        const latest = rooms
          .filter((x) => x.unreadCount > 0 && !x.muted && x.lastMessageAt)
          .sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)))[0];
        if (shellOrigin)
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
        if (!alive) return;
        const today = todayLocal();
        const dueToday = (t.items ?? []).filter((x) => (x.doDate && x.doDate <= today) || (x.dueDate && x.dueDate <= today));
        due = dueToday.length;
        if (shellOrigin)
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
      if (badgeApi) {
        try {
          if (unread + due > 0) await navigator.setAppBadge(unread + due);
          else await navigator.clearAppBadge();
        } catch {
          // 뱃지 미지원 브라우저 — 무시
        }
      }
    };

    const onMessage = (e: MessageEvent) => {
      if (!e.data || (e.data as { type?: string }).type !== 'mcm:widget-hello') return;
      if (shellOrigin) return;
      shellOrigin = e.origin;
      void tick();
      timer = setInterval(() => void tick(), POLL_MS);
    };

    if (inFrame) {
      window.addEventListener('message', onMessage);
      // 셸이 iframe 로드 시점을 놓쳐도 되도록 이쪽에서 먼저 알린다(내용 없는 신호).
      window.parent.postMessage({ type: 'mcm:widget-ready' }, '*');
    } else {
      // PWA 창 — 셸 핸드셰이크 없이 바로 폴링
      void tick();
      timer = setInterval(() => void tick(), POLL_MS);
    }

    return () => {
      alive = false;
      window.removeEventListener('message', onMessage);
      if (timer) clearInterval(timer);
    };
  }, [authed]);
}
