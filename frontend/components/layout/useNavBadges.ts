"use client";

// 네비 카운트 뱃지 훅(G1) — 안읽은 메일·미결재·할 일(오늘+지연) 60초 폴링. AppShell 에서 1회 구독해 Sidebar/드로어에 공유.
// mailNotify: 같은 폴링 응답의 신호(메일·결재·메신저 도착 시각)로 PC 알림을 판단한다(AppShell 만 켠다 — 홈 통계 카드의 두 번째 구독은 끔).

import { useEffect, useState } from "react";
import type { MenuBadgeKey } from "@/config/menu";
import { handlePcNotifySignals, readPcNotifySignals } from "@/lib/notify/pc-notify-client";

export type NavBadges = Record<MenuBadgeKey, number>;

const EMPTY: NavBadges = { mailUnread: 0, approvalPending: 0, todoDue: 0 };

export function useNavBadges(opts?: { mailNotify?: boolean }): NavBadges {
  const mailNotify = opts?.mailNotify === true;
  const [badges, setBadges] = useState<NavBadges>(EMPTY);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/nav/badges", { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (alive) {
          setBadges({
            mailUnread: Number(d.mailUnread) || 0,
            approvalPending: Number(d.approvalPending) || 0,
            todoDue: Number(d.todoDue) || 0,
          });
        }
        if (alive && mailNotify) void handlePcNotifySignals(readPcNotifySignals(d));
      } catch {
        /* 네비는 실패해도 침묵 */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [mailNotify]);

  return badges;
}
