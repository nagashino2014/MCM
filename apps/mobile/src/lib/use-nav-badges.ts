import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { apiJson } from "./api";
import { syncAppBadge } from "./notification-tray";

export interface NavBadges {
  mailUnread: number;
  approvalPending: number;
  chatUnread: number;
}

const EMPTY: NavBadges = { mailUnread: 0, approvalPending: 0, chatUnread: 0 };

/*
 * 탭 뱃지(미결재·안읽은 메일·안읽은 대화) — 웹 사이드바와 같은 `/api/nav/badges` 를 쓴다.
 *
 * 앱 전체가 한 저장소를 나눠 쓴다(2026-11-12). 예전에는 화면마다 따로 받고 앱 시작·포그라운드 복귀 때만
 * 다시 받아, 대화방을 열어 읽어도 하단 탭의 붉은 숫자가 앱을 껐다 켤 때까지 남았다.
 * 갱신 시점 = 앱 시작 + 포그라운드 복귀 + `refreshNavBadges()`(대화 읽음·메일 열람·포그라운드 푸시 수신 직후).
 * 주기 폴링은 하지 않는다(배터리). 받을 때마다 앱 아이콘 숫자도 같은 합계로 맞춘다.
 */
let current: NavBadges = EMPTY;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;
let again = false;

async function loadOnce(): Promise<void> {
  try {
    const d = await apiJson<Partial<NavBadges>>("/api/nav/badges");
    current = {
      mailUnread: Number(d.mailUnread ?? 0),
      approvalPending: Number(d.approvalPending ?? 0),
      chatUnread: Number(d.chatUnread ?? 0),
    };
    for (const l of listeners) l();
    void syncAppBadge(current.mailUnread + current.approvalPending + current.chatUnread);
  } catch {
    // 뱃지는 실패해도 네비가 죽지 않게 조용히 유지한다(웹과 동일 정책).
  }
}

/** 뱃지를 다시 받는다. 받는 중에 또 부르면 끝난 뒤 한 번 더 받는다(읽음 직후 값이 빠지지 않게). */
export function refreshNavBadges(): Promise<void> {
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = (async () => {
    do {
      again = false;
      await loadOnce();
    } while (again);
    inflight = null;
  })();
  return inflight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => current;

export function useNavBadges(): NavBadges & { reload: () => void } {
  const badges = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    void refreshNavBadges();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refreshNavBadges();
    });
    return () => sub.remove();
  }, []);

  const reload = useCallback(() => void refreshNavBadges(), []);
  return { ...badges, reload };
}
