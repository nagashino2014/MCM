"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, AlertCircle, Info, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AlertDrawer, type AlertItem } from "./AlertDrawer";

interface AlertBannerProps {
  canAck: boolean;
}

export function AlertBanner({ canAck }: AlertBannerProps) {
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [open, setOpen] = useState(false);

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/alerts?status=open&limit=5", {
        cache: "no-store",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { alerts: AlertItem[] };
      setAlerts(json.alerts ?? []);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setAlerts([]);
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

  if (!alerts || alerts.length === 0) return null;

  // severity 우선순위: error > warn > info
  const severityRank: Record<AlertItem["severity"], number> = { error: 3, warn: 2, info: 1 };
  const top = [...alerts].sort(
    (a, b) => severityRank[b.severity] - severityRank[a.severity]
  )[0];
  const tone =
    top.severity === "error"
      ? "border-red-300 cd-error-bg"
      : top.severity === "warn"
        ? "border-amber-300 cd-warn-bg"
        : "border-sky-300 bg-sky-50/80";
  const Icon =
    top.severity === "error" ? AlertCircle : top.severity === "warn" ? AlertTriangle : Info;
  const accent =
    top.severity === "error"
      ? "cd-error-text"
      : top.severity === "warn"
        ? "text-amber-600"
        : "text-sky-600";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "w-full rounded-2xl border-2 p-4 flex items-start gap-3 cd-reveal transition-all hover:shadow-md text-left",
          tone
        )}
      >
        <Icon className={cn("w-5 h-5 mt-0.5", accent)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-[10px] font-bold uppercase tracking-wide", accent)}>
              {top.severity}
            </span>
            <span className="text-[10px] font-bold cd-text-faint uppercase">
              {top.source} · {top.code}
            </span>
            {alerts.length > 1 && (
              <span className="text-[10px] font-bold cd-text-faint px-2 py-0.5 rounded-full cd-surface-bg border cd-border-c">
                외 {alerts.length - 1}건
              </span>
            )}
          </div>
          <div className="text-sm font-bold cd-text mt-1 break-words">{top.title}</div>
          {top.body && (
            <div className="text-[12px] cd-text-muted mt-1 break-words">{top.body}</div>
          )}
        </div>
        <ArrowRight className="w-4 h-4 cd-text-faint mt-1 shrink-0" />
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
