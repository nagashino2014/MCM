"use client";

// 네비 카운트 뱃지 훅(G1) — 안읽은 메일·미결재 60초 폴링. AppShell 에서 1회 구독해 Sidebar/드로어에 공유.

import { useEffect, useState } from "react";
import type { MenuBadgeKey } from "@/config/menu";

/** menuPermissions = 권한키로 노출을 가르는 메뉴(MenuItem.permissionKey) 중 내가 가진 키. */
export type NavBadges = Record<MenuBadgeKey, number> & { menuPermissions: string[] };

const EMPTY: NavBadges = { mailUnread: 0, approvalPending: 0, menuPermissions: [] };

export function useNavBadges(): NavBadges {
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
            menuPermissions: Array.isArray(d.menuPermissions) ? d.menuPermissions.map(String) : [],
          });
        }
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
  }, []);

  return badges;
}
