"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { AlertDrawer } from "./AlertDrawer";

interface AlertBellProps {
  /** 사이드바 / 헤더에 따른 사이즈 변형 — 기본은 사이드바 */
  variant?: "sidebar" | "compact";
  /** editor+ 면 ack 가능 */
  canAck: boolean;
}

export function AlertBell({ variant = "sidebar", canAck }: AlertBellProps) {
  const [count, setCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/alerts/unread-count", { cache: "no-store", signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { count: number };
      setCount(Number(json.count) || 0);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      // 401 등은 무시 (로그인 페이지에서는 안 보임)
      setCount(0);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    reload(ctrl.signal);
    const id = setInterval(() => reload(), 60_000);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [reload]);

  const hasUnread = (count ?? 0) > 0;

  if (variant === "compact") {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative rounded-xl w-9 h-9 flex items-center justify-center cd-surface-bg border cd-border-c cd-text-muted hover:text-[color:var(--cd-text)]"
          title="운영 알람"
        >
          <Bell className="w-4 h-4" />
          {hasUnread && (
            <span
              className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
              style={{ background: "var(--cd-error)" }}
            >
              {count}
            </span>
          )}
        </button>
        <AlertDrawer
          open={open}
          onClose={() => setOpen(false)}
          canAck={canAck}
          onChanged={() => reload()}
        />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "w-full rounded-2xl border p-3 flex items-center gap-3 transition-colors",
          hasUnread ? "cd-error-bg" : "cd-surface-bg cd-border-c"
        )}
        style={hasUnread ? { borderColor: "var(--cd-error)" } : undefined}
        title="운영 알람"
      >
        <div
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center relative",
            hasUnread ? "cd-error-bg cd-error-text" : "cd-soft-primary"
          )}
        >
          <Bell className="w-4 h-4" />
          {hasUnread && (
            <span
              className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
              style={{ background: "var(--cd-error)" }}
            >
              {count}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="text-xs font-bold cd-text truncate">운영 알람</div>
          <div className="text-[11px] cd-text-faint truncate">
            {count === null
              ? "로딩 중"
              : hasUnread
                ? `미확인 ${count}건`
                : "미확인 알람 없음"}
          </div>
        </div>
      </button>
      <AlertDrawer
        open={open}
        onClose={() => setOpen(false)}
        canAck={canAck}
        onChanged={() => reload()}
      />
    </>
  );
}
