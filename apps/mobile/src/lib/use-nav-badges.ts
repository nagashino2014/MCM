import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { apiJson } from "./api";

export interface NavBadges {
  mailUnread: number;
  approvalPending: number;
}

const EMPTY: NavBadges = { mailUnread: 0, approvalPending: 0 };

/**
 * 탭 뱃지(미결재·안읽은 메일) — 웹 사이드바와 같은 `/api/nav/badges` 를 쓴다.
 *
 * 폴링하지 않는다(배터리). 갱신 시점 = 앱 시작 + 포그라운드 복귀.
 * 실시간성은 M1 푸시가 담당한다.
 */
export function useNavBadges(): NavBadges & { reload: () => void } {
  const [badges, setBadges] = useState<NavBadges>(EMPTY);

  const load = useCallback(async () => {
    try {
      const d = await apiJson<Partial<NavBadges>>("/api/nav/badges");
      setBadges({
        mailUnread: Number(d.mailUnread ?? 0),
        approvalPending: Number(d.approvalPending ?? 0),
      });
    } catch {
      // 뱃지는 실패해도 네비가 죽지 않게 조용히 유지한다(웹과 동일 정책).
    }
  }, []);

  useEffect(() => {
    void load();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void load();
    });
    return () => sub.remove();
  }, [load]);

  return { ...badges, reload: load };
}
