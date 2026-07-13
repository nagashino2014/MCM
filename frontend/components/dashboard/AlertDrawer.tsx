"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Bell, AlertTriangle, AlertCircle, Info, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AlertItem {
  id: number;
  severity: "info" | "warn" | "error";
  source: string;
  code: string;
  title: string;
  body: string | null;
  payloadJson: string | null;
  jobId: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

interface AlertDrawerProps {
  open: boolean;
  onClose: () => void;
  /** editor 이상이면 ack 가능. viewer 면 disabled. */
  canAck: boolean;
  /** ack 후 외부 카운터 갱신 콜백 (선택) */
  onChanged?: () => void;
}

export function AlertDrawer({ open, onClose, canAck, onChanged }: AlertDrawerProps) {
  const [tab, setTab] = useState<"open" | "all">("open");
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ackingId, setAckingId] = useState<number | null>(null);

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/alerts?status=${tab}&limit=50`, {
          cache: "no-store",
          signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { alerts: AlertItem[] };
        setAlerts(json.alerts);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [tab]
  );

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    reload(ctrl.signal);
    return () => ctrl.abort();
  }, [open, reload]);

  const ack = async (id: number) => {
    if (!canAck) return;
    setAckingId(id);
    try {
      const res = await fetch(`/api/alerts/${id}/ack`, {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await reload();
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAckingId(null);
    }
  };

  if (!open) return null;

  // 사이드바(position: sticky) 내부에서 렌더되면 sticky 의 stacking context 에 갇혀
  // 메인 컨텐츠 뒤로 깔리므로(닫기 불가·메뉴 비활성), body 포털로 최상위에 띄운다.
  return createPortal(
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer">
        <header className="px-6 py-5 border-b border-stone-200/70 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-stone-400 uppercase tracking-wide">
                운영 알람
              </div>
              <h3 className="text-base font-bold text-stone-800 mt-0.5">
                Operations Alerts
              </h3>
            </div>
          </div>
          <button
            type="button"
            className="glass-button rounded-xl w-9 h-9 flex items-center justify-center text-stone-600"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-6 pt-4 pb-2 flex items-center gap-2">
          {(["open", "all"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-bold transition-colors",
                tab === t
                  ? "bg-primary text-white"
                  : "bg-white/60 text-stone-600 border border-stone-200/60 hover:text-stone-900"
              )}
            >
              {t === "open" ? "미확인" : "전체"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => reload()}
            className="ml-auto glass-button rounded-xl px-3 py-1.5 text-xs font-bold text-stone-700"
          >
            {loading ? "로딩..." : "새로고침"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {error && (
            <div className="text-[11px] text-red-600 font-bold">로딩 실패: {error}</div>
          )}
          {loading && !alerts && (
            <div className="text-[12px] text-stone-400 italic">로딩 중...</div>
          )}
          {alerts && alerts.length === 0 && (
            <div className="text-[12px] text-stone-400 italic">
              {tab === "open" ? "미확인 알람이 없습니다." : "알람 기록이 없습니다."}
            </div>
          )}
          {alerts?.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              canAck={canAck}
              acking={ackingId === a.id}
              onAck={() => ack(a.id)}
            />
          ))}
        </div>
      </aside>
    </>,
    document.body
  );
}

function AlertCard({
  alert,
  canAck,
  acking,
  onAck,
}: {
  alert: AlertItem;
  canAck: boolean;
  acking: boolean;
  onAck: () => void;
}) {
  const Icon =
    alert.severity === "error" ? AlertCircle : alert.severity === "warn" ? AlertTriangle : Info;
  const tone =
    alert.severity === "error"
      ? "border-red-200 bg-red-50/60"
      : alert.severity === "warn"
        ? "border-amber-200 bg-amber-50/60"
        : "border-stone-200 bg-white/70";
  const accent =
    alert.severity === "error"
      ? "text-red-600"
      : alert.severity === "warn"
        ? "text-amber-600"
        : "text-sky-600";
  const isAcked = !!alert.acknowledgedAt;

  return (
    <div
      className={cn(
        "rounded-2xl border p-3 flex flex-col gap-2 transition-opacity",
        tone,
        isAcked && "opacity-60"
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className={cn("w-4 h-4 mt-0.5", accent)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-[10px] font-bold uppercase tracking-wide", accent)}>
              {alert.severity}
            </span>
            <span className="text-[10px] font-bold text-stone-400 uppercase">
              {alert.source} · {alert.code}
            </span>
          </div>
          <div className="text-sm font-bold text-stone-800 mt-0.5 break-words">
            {alert.title}
          </div>
          {alert.body && (
            <div className="text-[12px] text-stone-600 mt-1 break-words">{alert.body}</div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] text-stone-500">
        <span>{formatDate(alert.createdAt)}</span>
        {isAcked ? (
          <span className="flex items-center gap-1 text-primary">
            <CheckCircle2 className="w-3 h-3" />
            {alert.acknowledgedBy ? `${alert.acknowledgedBy} 확인` : "확인됨"}
          </span>
        ) : canAck ? (
          <button
            type="button"
            onClick={onAck}
            disabled={acking}
            className="rounded-lg px-2 py-1 text-[11px] font-bold text-white bg-primary hover:bg-primary/90 disabled:opacity-50"
          >
            {acking ? "처리..." : "확인"}
          </button>
        ) : (
          <span
            className="rounded-lg px-2 py-1 text-[11px] font-bold text-stone-400 bg-stone-100/80 border border-stone-200/60"
            title="editor 이상만 확인 가능"
          >
            확인 (권한 없음)
          </span>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0") +
      " " +
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  } catch {
    return iso;
  }
}
