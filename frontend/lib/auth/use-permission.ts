"use client";

/**
 * 클라이언트 권한 훅(role 일원화 WP5) — 세션에 실린 권한 요약(perms)으로 버튼·탭·화면 게이트를 판정한다.
 *
 *   const { can, canAny, ready } = usePermission();
 *   const canEdit = can("facility.edit");            // 키 보유(범위 무관)
 *   const isGlobal = can("work_plan.view", { global: true }); // 전사 범위 보유
 *
 * ready=false 인 동안(세션 로딩)은 모두 false 다 — 화면은 "세션 확인 중…" 을 보이거나 버튼을 숨긴다.
 * 서버 컴포넌트·API 는 이 훅 대신 lib/auth/perms.ts 의 hasPerm(session.user.perms, key) 또는
 * requirePermission(DB 판정)을 쓴다.
 */

import { useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { hasAnyPerm, hasPerm, isSystemAdminPerms, permsOf } from "./perms";

export function usePermission() {
  const { data: session, status } = useSession();
  const perms = useMemo(() => permsOf(session?.user), [session?.user]);
  const can = useCallback((key: string, opts?: { global?: boolean }) => hasPerm(perms, key, opts), [perms]);
  const canAny = useCallback((keys: string | readonly string[]) => hasAnyPerm(perms, keys), [perms]);
  return {
    perms,
    can,
    canAny,
    /** 시스템 관리자(tpl-system-admin) 표식 — 라벨·개발용 토글 전용. */
    isSystemAdmin: isSystemAdminPerms(perms),
    ready: status !== "loading",
    status,
  };
}
