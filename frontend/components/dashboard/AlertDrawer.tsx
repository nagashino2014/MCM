"use client";

// 운영 알람 드로어 — G4: 구식 glass 스타일을 걷어내고 G0 CdDrawer(포털 cdash-vars 내장) 기반으로 표준화.
// 탑바 AlertBell·데이터 현황 AlertBanner 에서 공용. 항목은 윤곽선 기본(cd-border), severity 는 테두리·아이콘 색으로.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, AlertCircle, Info, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CdDrawer } from "@/components/cdash/CdModal";

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

  return (
    <CdDrawer open={open} onClose={onClose} title="운영 알람" widthClass="max-w-md">
      <div className="flex items-center gap-1.5 mb-3">
        {(["open", "all"] as const).map((t) => (
          <button key={t} type="button" className="cd-chip cd-chip-sm" data-active={tab === t} onClick={() => setTab(t)}>
            {t === "open" ? "미확인" : "전체"}
          </button>
        ))}
        <button type="button" className="ml-auto cd-btn cd-btn-soft rounded-lg px-3 py-1.5 text-xs font-semibold" onClick={() => reload()}>
          {loading ? "로딩..." : "새로고침"}
        </button>
      </div>

      <div className="space-y-3">
        {error && <div className="text-[11px] font-bold text-[color:var(--cd-danger,#FA896B)]">로딩 실패: {error}</div>}
        {loading && !alerts && <div className="text-[12px] cd-text-faint">로딩 중...</div>}
        {alerts && alerts.length === 0 && (
          <div className="text-[12px] cd-text-faint">
            {tab === "open" ? "미확인 알람이 없습니다." : "알람 기록이 없습니다."}
          </div>
        )}
        {alerts?.map((a) => (
          <AlertCard key={a.id} alert={a} canAck={canAck} acking={ackingId === a.id} onAck={() => ack(a.id)} />
        ))}
      </div>
    </CdDrawer>
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
  const toneBorder =
    alert.severity === "error"
      ? "border-[color:var(--cd-danger,#FA896B)]"
      : alert.severity === "warn"
        ? "border-[color:var(--cd-warning,#FFAE1F)]"
        : "cd-border-c";
  const accent =
    alert.severity === "error"
      ? "text-[color:var(--cd-danger,#FA896B)]"
      : alert.severity === "warn"
        ? "text-[color:var(--cd-warning,#FFAE1F)]"
        : "cd-text-primary";
  const isAcked = !!alert.acknowledgedAt;

  return (
    <div className={cn("rounded-2xl border p-3 flex flex-col gap-2 transition-opacity", toneBorder, isAcked && "opacity-60")}>
      <div className="flex items-start gap-2">
        <Icon className={cn("w-4 h-4 mt-0.5", accent)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-[10px] font-bold uppercase tracking-wide", accent)}>{alert.severity}</span>
            <span className="text-[10px] font-bold cd-text-faint uppercase">
              {alert.source} · {alert.code}
            </span>
          </div>
          <div className="text-sm font-bold cd-text mt-0.5 break-words">{alert.title}</div>
          {alert.body && <div className="text-[12px] cd-text-muted mt-1 break-words">{alert.body}</div>}
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] cd-text-faint">
        <span>{formatDate(alert.createdAt)}</span>
        {isAcked ? (
          <span className="flex items-center gap-1 cd-text-primary">
            <CheckCircle2 className="w-3 h-3" />
            {alert.acknowledgedBy ? `${alert.acknowledgedBy} 확인` : "확인됨"}
          </span>
        ) : canAck ? (
          <button
            type="button"
            onClick={onAck}
            disabled={acking}
            className="cd-btn cd-btn-primary rounded-lg px-2 py-1 text-[11px] font-bold disabled:opacity-50"
          >
            {acking ? "처리..." : "확인"}
          </button>
        ) : (
          <span className="rounded-lg px-2 py-1 text-[11px] font-bold cd-text-faint border cd-border-c" title="editor 이상만 확인 가능">
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
