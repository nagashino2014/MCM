"use client";

// 외부 연동 상태(/admin/integrations) — 316 integration_health. 감시 틱(KST 08~20시 매시)과 [지금 점검]이 갱신한다.
// 이상이 생기면 시스템 관리자에게 운영 알람·모바일 push·메일로 알리고, 복구되면 한 번 더 알린다.
// docs/integration-watchdog-blueprint.md

import { useCallback, useEffect, useState } from "react";
import { Activity, Loader2, RefreshCw } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";

type Status = "ok" | "failing" | "unknown";

interface HealthRow {
  key: string;
  grp: "intel" | "adt" | "bid" | "barobill";
  label: string;
  status: Status;
  reason: string | null;
  lastOkAt: string | null;
  failingSince: string | null;
  lastAlertAt: string | null;
  lastCheckedAt: string | null;
}

const GROUP_LABEL: Record<HealthRow["grp"], string> = {
  intel: "영업 수집",
  adt: "근태",
  bid: "공공입찰",
  barobill: "바로빌",
};

const STATUS_PILL: Record<Status, { cls: string; text: string }> = {
  ok: { cls: "cd-pill-success", text: "정상" },
  failing: { cls: "cd-pill-error", text: "이상" },
  unknown: { cls: "cd-pill-idle", text: "확인 불가" },
};

/** ISO(UTC) → KST "MM-DD HH:mm" */
function kst(iso: string | null): string {
  if (!iso) return "-";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "-";
  const d = new Date(t + 9 * 3600 * 1000).toISOString();
  return `${d.slice(5, 10)} ${d.slice(11, 16)}`;
}

export function IntegrationHealthBoard() {
  const { theme } = useCdashTheme();
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/integrations", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "연동 상태를 불러오지 못했습니다.");
      setRows(data.rows ?? []);
    } catch (err) {
      setRows([]);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const checkNow = async () => {
    setChecking(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/integrations/check", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "점검하지 못했습니다.");
      setRows(data.rows ?? []);
      const s = data.summary ?? {};
      const sent = (s.newlyFailing?.length ?? 0) + (s.reminders?.length ?? 0) + (s.recovered?.length ?? 0);
      setNotice(`점검 완료 — 이상 ${s.failing ?? 0}건${sent ? ` · 변화 ${sent}건을 관리자에게 알렸습니다` : ""}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const failing = rows.filter((r) => r.status === "failing").length;
  const lastChecked = rows.reduce<string | null>((m, r) => (r.lastCheckedAt && (!m || r.lastCheckedAt > m) ? r.lastCheckedAt : m), null);

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<Activity className="w-5 h-5" />}
        title="외부 연동 상태"
        meta={rows.length ? `${rows.length}개 대상 · 이상 ${failing}건 · 마지막 점검 ${kst(lastChecked)}` : undefined}
        helpTopic="admin.integrations"
        actions={
          <div className="flex items-center gap-2">
            <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2" title="새로고침" aria-label="새로고침" onClick={load}>
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5"
              disabled={checking}
              onClick={checkNow}
            >
              {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
              지금 점검
            </button>
          </div>
        }
      />
      {error && <p className="text-sm text-[color:var(--cd-error)]">{error}</p>}
      {notice && <p className="text-sm cd-text-faint" role="status">{notice}</p>}

      <div className="cd-card rounded-3xl p-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="cd-table-head">
              <tr className="cd-text-faint text-xs border-b cd-border-c">
                <th className="py-2 px-2 text-left w-24">구분</th>
                <th className="py-2 px-2 text-left">대상</th>
                <th className="py-2 px-2 text-left w-24">상태</th>
                <th className="py-2 px-2 text-left w-28">마지막 성공</th>
                <th className="py-2 px-2 text-left">사유</th>
                <th className="py-2 px-2 text-left w-28">이상 시작</th>
                <th className="py-2 px-2 text-left w-28">최근 알림</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center cd-text-faint">
                    <Loader2 className="w-4 h-4 animate-spin inline-block mr-2 align-[-2px]" />
                    불러오는 중…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center cd-text-faint">
                    아직 점검 기록이 없습니다. [지금 점검]을 누르면 바로 판정합니다.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.key} className="border-b cd-border-c">
                    <td className="py-2 px-2 cd-text-faint text-xs whitespace-nowrap">{GROUP_LABEL[r.grp] ?? r.grp}</td>
                    <td className="py-2 px-2 font-medium">{r.label}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className={`cd-pill ${STATUS_PILL[r.status]?.cls ?? "cd-pill-idle"} text-[11px]`}>
                        {STATUS_PILL[r.status]?.text ?? r.status}
                      </span>
                    </td>
                    <td className="py-2 px-2 font-mono text-[11px] cd-text-faint whitespace-nowrap">{kst(r.lastOkAt)}</td>
                    <td className="py-2 px-2 text-xs">{r.reason ?? ""}</td>
                    <td className="py-2 px-2 font-mono text-[11px] cd-text-faint whitespace-nowrap">{kst(r.failingSince)}</td>
                    <td className="py-2 px-2 font-mono text-[11px] cd-text-faint whitespace-nowrap">{kst(r.lastAlertAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
