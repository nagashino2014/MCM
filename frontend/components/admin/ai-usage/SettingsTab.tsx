"use client";

// 설정 탭 — 환율·예측 창·예산 요약(P2 편집)·청구 대조 연동 상태(P3)·변경 이력(audit_log).

import { useCallback, useEffect, useState } from "react";
import { History, Loader2, Save } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { fmtUsd, type SummaryResponse } from "./types";

interface HistoryRow {
  id: number;
  createdAt: string;
  actorUserId: string | null;
  actorName: string | null;
  targetTable: string;
  targetId: string;
  before: unknown;
  after: unknown;
}

interface Props {
  data: SummaryResponse;
  canManage: boolean;
  onChanged: () => void;
}

function describeHistory(r: HistoryRow): string {
  if (r.targetTable === "ai_model_prices") {
    const a = (r.after ?? {}) as Record<string, unknown>;
    return `단가 ${r.targetId}: 입력 $${a.inputPerMtok ?? "?"} / 출력 $${a.outputPerMtok ?? "?"} (1M tok)`;
  }
  if (r.targetId === "feature_model_overrides") {
    const b = (r.before ?? {}) as Record<string, string>;
    const a = (r.after ?? {}) as Record<string, string>;
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    const changes: string[] = [];
    for (const k of keys) {
      if (b[k] !== a[k]) changes.push(`${k}: ${b[k] ?? "(기본)"} → ${a[k] ?? "(기본)"}`);
    }
    return changes.length ? `기능별 모델 — ${changes.join(", ")}` : "기능별 모델 오버라이드 변경";
  }
  if (r.targetId === "usd_krw_rate") return `환율 ${String(r.before ?? "(없음)")} → ${String(r.after ?? "(없음)")}`;
  if (r.targetId === "forecast_window_days") return `예측 창 ${String(r.before ?? 7)}일 → ${String(r.after ?? 7)}일`;
  return `${r.targetTable}.${r.targetId} 변경`;
}

export function SettingsTab({ data, canManage, onChanged }: Props) {
  const [rate, setRate] = useState(data.settings.usdKrwRate != null ? String(data.settings.usdKrwRate) : "");
  const [windowDays, setWindowDays] = useState(String(data.settings.forecastWindowDays));
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [histLoading, setHistLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const res = await fetch("/api/admin/ai-usage/settings", { cache: "no-store" });
      const j = await res.json();
      if (res.ok) setHistory(j.history ?? []);
    } finally {
      setHistLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    setRate(data.settings.usdKrwRate != null ? String(data.settings.usdKrwRate) : "");
    setWindowDays(String(data.settings.forecastWindowDays));
  }, [data.settings]);

  const save = async (body: Record<string, unknown>, key: string) => {
    setSaving(key);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/ai-usage/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "저장하지 못했습니다.");
      setMsg("저장했습니다.");
      onChanged();
      loadHistory();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const budget = data.kpis.budget;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        <h3 className="cd-card-title">표시·예측</h3>
        <label className="flex flex-col gap-1.5">
          <span className="cd-label">USD → KRW 환율 (참고 병기, 수동)</span>
          <div className="flex items-center gap-2">
            <input className="cd-input" style={{ width: 140 }} inputMode="decimal" placeholder="예: 1380" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))} disabled={!canManage} />
            <CdButton size="sm" variant="soft" disabled={!canManage || saving === "rate"} onClick={() => save({ usdKrwRate: rate ? Number(rate) : null }, "rate")} icon={saving === "rate" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}>
              저장
            </CdButton>
          </div>
          <span className="text-[11px] cd-text-faint">비우면 KRW 병기를 끕니다. 예산·집계는 USD 기준입니다.</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="cd-label">월 예상 계산 창 (기준일 전후, 일)</span>
          <div className="flex items-center gap-2">
            <input className="cd-input" style={{ width: 90 }} inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value.replace(/\D/g, ""))} disabled={!canManage} />
            <CdButton size="sm" variant="soft" disabled={!canManage || saving === "window"} onClick={() => save({ forecastWindowDays: Number(windowDays) }, "window")} icon={saving === "window" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}>
              저장
            </CdButton>
          </div>
          <span className="text-[11px] cd-text-faint">기본 7일 = 기준일 −3 ~ +3. 미래 구간은 자동으로 잘립니다.</span>
        </label>
        {msg && <div className="text-xs cd-text-muted">{msg}</div>}
      </div>

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-3">
        <h3 className="cd-card-title">예산 · 연동 상태</h3>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between border-b cd-border-c pb-2">
            <span className="cd-text-muted">월 예산(전체)</span>
            <span className="font-semibold tabular-nums">{budget.limitUsd != null ? fmtUsd(budget.limitUsd, 0) : "미설정"}</span>
          </div>
          <div className="flex items-center justify-between border-b cd-border-c pb-2">
            <span className="cd-text-muted">초과 시 정책</span>
            <span className="cd-chip cd-chip-sm">{budget.action === "block_all" ? "전체 차단" : budget.action === "block_noncritical" ? "비필수 차단" : "경고만"}</span>
          </div>
          <div className="flex items-center justify-between border-b cd-border-c pb-2">
            <span className="cd-text-muted">경고 임계</span>
            <span className="tabular-nums">50 / 80 / 100%</span>
          </div>
          <div className="flex items-center justify-between border-b cd-border-c pb-2">
            <span className="cd-text-muted">Console 계정</span>
            <span className="cd-chip cd-chip-sm">개인 계정 (사비)</span>
          </div>
          <div className="flex items-center justify-between pb-1">
            <span className="cd-text-muted">실제 청구 대조(Admin API)</span>
            <span className="cd-pill cd-pill-idle text-[11px]">미연동 — 법인 조직 전환 후</span>
          </div>
        </div>
        <p className="text-[11px] cd-text-faint">예산 편집·경고 알림 발송은 P2 에서, Console CSV 수동 대조는 P1 후반에 붙습니다.</p>
      </div>

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-3 xl:col-span-3">
        <div className="flex items-center justify-between">
          <h3 className="cd-card-title inline-flex items-center gap-1.5"><History className="w-4 h-4" /> 변경 이력</h3>
          <span className="text-[11px] cd-text-faint">기능별 모델·단가·설정 변경(audit_log) 최근 50건</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="cd-text-faint text-xs border-b cd-border-c">
                <th className="py-2 px-2 text-left w-40">일시</th>
                <th className="py-2 px-2 text-left w-32">변경자</th>
                <th className="py-2 px-2 text-left">내용</th>
              </tr>
            </thead>
            <tbody>
              {histLoading ? (
                <tr><td colSpan={3} className="py-8 text-center cd-text-faint"><Loader2 className="w-4 h-4 animate-spin inline-block mr-2 align-[-2px]" />불러오는 중…</td></tr>
              ) : history.length === 0 ? (
                <tr><td colSpan={3} className="py-8 text-center cd-text-faint">변경 이력이 없습니다.</td></tr>
              ) : (
                history.map((r) => (
                  <tr key={r.id} className="border-b cd-border-c">
                    <td className="py-2 px-2 font-mono text-[11px] cd-text-faint">{r.createdAt.slice(0, 19).replace("T", " ")}</td>
                    <td className="py-2 px-2">{r.actorName ?? r.actorUserId ?? "시스템"}</td>
                    <td className="py-2 px-2 text-xs">{describeHistory(r)}</td>
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
