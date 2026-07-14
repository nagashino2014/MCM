"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 홈 위젯 공용 데이터 훅.
 * - 403/401 → forbidden: 권한 없는 위젯은 카드 자체를 숨긴다(프론트 권한 분기 코드 없이 API 403 으로 게이팅).
 * - 그 외 실패 → error, 성공 → ok.
 * reload() 로 요청/발행 등 mutation 후 재조회한다.
 */
export type WidgetState<T> =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

export function useHomeWidget<T>(url: string): WidgetState<T> & { reload: () => void } {
  const [state, setState] = useState<WidgetState<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (!alive) return;
        if (res.status === 403 || res.status === 401) {
          setState({ status: "forbidden" });
          return;
        }
        if (!res.ok) {
          setState({ status: "error", message: `HTTP ${res.status}` });
          return;
        }
        const data = (await res.json()) as T;
        if (alive) setState({ status: "ok", data });
      })
      .catch((e) => {
        if (alive) setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      alive = false;
    };
  }, [url, nonce]);

  return { ...state, reload };
}
