"use client";

// 예산·알림 탭(P2) — 예산 카드(전체/기능별/모델별: 한도·누계 게이지·임계·정책·수신자) + 편집 모달 + 알림 이력.

import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2, Pencil, Plus, ShieldAlert, Trash2, UserPlus, X } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdModal } from "@/components/cdash/CdModal";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";
import { AI_FEATURES } from "@/lib/ai/features";
import type { AiBudgetAlertRow, AiBudgetStatus, BudgetAction } from "@/lib/ai/budget";
import { fmtInt, fmtKstFull, fmtPct, fmtUsd, modelLabel, type SummaryResponse } from "./types";

interface Props {
  data: SummaryResponse;
  canManage: boolean;
  onChanged: () => void;
}

interface BudgetsResponse {
  budgets: AiBudgetStatus[];
  alerts: AiBudgetAlertRow[];
  userNames: Record<string, string>;
}

type ScopeKind = "org" | "feature" | "model";

interface FormState {
  budgetId: string | null;
  scopeKind: ScopeKind;
  scopeTarget: string;
  label: string;
  monthlyLimitUsd: string;
  warnPcts: string;
  action: BudgetAction;
  recipients: string[];
  enabled: boolean;
}

const ACTION_LABEL: Record<BudgetAction, string> = {
  notify: "경고만 (호출 계속)",
  block_noncritical: "비필수 기능 차단",
  block_all: "전체 차단",
};

const KIND_LABEL: Record<string, string> = { threshold: "임계 도달", forecast: "초과 전망", single_call: "단건 고비용" };
/** 예산 카드 최대 개수(전체 1 + 기능/모델 2) — 한 줄 3열 카드 레이아웃에 맞춘다(2026-09-03 사용자 지시). */
const MAX_BUDGETS = 3;

function toForm(b: AiBudgetStatus | null): FormState {
  if (!b) return { budgetId: null, scopeKind: "feature", scopeTarget: "", label: "", monthlyLimitUsd: "", warnPcts: "50,80,100", action: "notify", recipients: [], enabled: true };
  const kind: ScopeKind = b.scope === "org" ? "org" : b.scope.startsWith("feature:") ? "feature" : "model";
  return {
    budgetId: b.budgetId,
    scopeKind: kind,
    scopeTarget: kind === "org" ? "" : b.scope.slice(kind === "feature" ? 8 : 6),
    label: b.label,
    monthlyLimitUsd: String(b.monthlyLimitUsd),
    warnPcts: b.warnPcts.join(","),
    action: b.action,
    recipients: b.recipients,
    enabled: b.enabled,
  };
}

function gaugeColor(pct: number | null): string {
  if (pct == null) return "var(--cd-primary)";
  if (pct >= 100) return "var(--cd-error)";
  if (pct >= 80) return "var(--cd-warning)";
  return "var(--cd-primary)";
}

export function BudgetsTab({ data, canManage, onChanged }: Props) {
  const [res, setRes] = useState<BudgetsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/ai-usage/budgets", { cache: "no-store" });
      const j = (await r.json()) as BudgetsResponse & { error?: string };
      if (!r.ok) throw new Error(j.error ?? "예산을 불러오지 못했습니다.");
      setRes(j);
      setNames((n) => ({ ...n, ...j.userNames }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!editing) return;
    const f = editing;
    const scope = f.scopeKind === "org" ? "org" : f.scopeKind === "feature" ? `feature:${f.scopeTarget}` : `model:${f.scopeTarget}`;
    if (f.scopeKind !== "org" && !f.scopeTarget) return setErr("범위 대상을 선택하세요.");
    const limit = Number(f.monthlyLimitUsd);
    if (!Number.isFinite(limit) || limit < 0) return setErr("월 한도(USD)를 확인하세요.");
    const warnPcts = f.warnPcts.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!warnPcts.length) return setErr("경고 임계(%)를 1개 이상 입력하세요(예: 50,80,100).");
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/ai-usage/budgets", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ budgetId: f.budgetId, scope, label: f.label, monthlyLimitUsd: limit, warnPcts, action: f.action, recipients: f.recipients, enabled: f.enabled }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? "저장하지 못했습니다.");
      setEditing(null);
      await load();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (b: AiBudgetStatus) => {
    if (!window.confirm(`"${b.label}" 예산을 삭제할까요? 알림 이력은 남습니다.`)) return;
    const r = await fetch(`/api/admin/ai-usage/budgets?id=${encodeURIComponent(b.budgetId)}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(j?.error ?? "삭제하지 못했습니다.");
    await load();
    onChanged();
  };

  const setF = (patch: Partial<FormState>) => setEditing((e) => (e ? { ...e, ...patch } : e));
  const hasOrg = !!res?.budgets.some((b) => b.scope === "org");
  const budgetCount = res?.budgets.length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      {err && <div className="cd-card rounded-2xl p-3 text-sm cd-error-text">{err}</div>}

      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="cd-card-title">예산</h3>
        <span className="text-[11px] cd-text-faint">
          USD 기준 · 당월({data.asOf.slice(0, 7)}) 누계 대비 · 임계 통과 시 홈 알림벨·푸시·메일(수신자 비면 시스템 관리자) · 최대 {MAX_BUDGETS}개
        </span>
        {canManage && (
          <CdButton
            size="sm"
            variant="soft"
            className="ml-auto"
            icon={<Plus className="w-3.5 h-3.5" />}
            disabled={budgetCount >= MAX_BUDGETS}
            title={budgetCount >= MAX_BUDGETS ? `예산은 최대 ${MAX_BUDGETS}개까지 둘 수 있습니다` : undefined}
            onClick={() => { setErr(null); setEditing(toForm(null)); }}
          >
            예산 추가{budgetCount >= MAX_BUDGETS ? ` (${MAX_BUDGETS}/${MAX_BUDGETS})` : ""}
          </CdButton>
        )}
      </div>

      {loading && !res ? (
        <div className="cd-card rounded-3xl p-10 text-center cd-text-faint text-sm"><Loader2 className="w-4 h-4 animate-spin inline-block mr-2 align-[-2px]" />불러오는 중…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(res?.budgets ?? []).map((b) => (
            <div key={b.budgetId} className={`cd-card rounded-2xl p-4 flex flex-col gap-3 ${b.enabled ? "" : "opacity-60"}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{b.label}</div>
                  <div className="text-[10px] cd-text-faint font-mono truncate">{b.scope}</div>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  {b.blockedNow && <span className="cd-pill cd-pill-error text-[10px] inline-flex items-center gap-1"><ShieldAlert className="w-3 h-3" />차단 중</span>}
                  {!b.enabled && <span className="cd-pill cd-pill-idle text-[10px]">비활성</span>}
                  {canManage && (
                    <>
                      <button type="button" className="cd-btn rounded-lg border cd-border-c p-1.5" title="편집" onClick={() => { setErr(null); setEditing(toForm(b)); }}><Pencil className="w-3.5 h-3.5" /></button>
                      {b.scope !== "org" && (
                        <button type="button" className="cd-btn rounded-lg border cd-border-c p-1.5" title="삭제" onClick={() => remove(b)}><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-bold tabular-nums">{fmtUsd(b.monthCost)}</span>
                  <span className="text-xs cd-text-muted tabular-nums">한도 {fmtUsd(b.monthlyLimitUsd, 0)} · {fmtPct(b.pctOfLimit)}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden mt-1.5" style={{ background: "var(--cd-surface)" }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, b.pctOfLimit ?? 0))}%`, background: gaugeColor(b.pctOfLimit) }} />
                </div>
                {b.scope === "org" && (
                  <div className="text-[11px] cd-text-faint mt-1">
                    {b.daysToExceed === 0
                      ? "한도 초과"
                      : b.daysToExceed != null
                        ? b.daysToExceed <= data.kpis.month.days - data.kpis.month.elapsedDays
                          ? `지금 속도면 ${b.daysToExceed}일 뒤 한도 도달`
                          : "지금 속도면 이번 달 내 한도 도달 없음"
                        : "예측 근거 부족"}
                    {b.forecastBlended != null && ` · 월 예상 ${fmtUsd(b.forecastBlended)}`}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                {b.warnPcts.map((p) => (
                  <span key={p} className={`cd-pill text-[10px] ${b.pctOfLimit != null && b.pctOfLimit >= p ? (p >= 100 ? "cd-pill-error" : "cd-pill-warn") : "cd-pill-outline"}`}>{p}%</span>
                ))}
                <span className="cd-chip cd-chip-sm ml-auto">{ACTION_LABEL[b.action]}</span>
              </div>
              <div className="text-[11px] cd-text-faint truncate">
                수신자: {b.recipients.length ? b.recipients.map((id) => names[id] ?? id).join(", ") : "시스템 관리자(기본)"}
              </div>
            </div>
          ))}
          {!hasOrg && !loading && <div className="cd-card rounded-2xl p-4 text-sm cd-text-faint">전체 예산이 없습니다(217 시드 확인).</div>}
        </div>
      )}

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="cd-card-title inline-flex items-center gap-1.5"><BellRing className="w-4 h-4" /> 알림 이력</h3>
          <span className="text-[11px] cd-text-faint">임계 도달은 월 1회 · 초과 전망은 일 1회 · 단건 고비용은 건별 (최근 50건 · {fmtInt(res?.alerts.length ?? 0)}건 표시)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="cd-text-faint text-xs border-b cd-border-c">
                <th className="py-2 px-2 text-left w-40">일시(KST)</th>
                <th className="py-2 px-2 text-left w-28">예산</th>
                <th className="py-2 px-2 text-left w-24">종류</th>
                <th className="py-2 px-2 text-right w-20">임계</th>
                <th className="py-2 px-2 text-right w-24">금액</th>
                <th className="py-2 px-2 text-left w-28">채널</th>
                <th className="py-2 px-2 text-left">내용</th>
              </tr>
            </thead>
            <tbody>
              {!res?.alerts.length ? (
                <tr><td colSpan={7} className="py-8 text-center cd-text-faint">발송된 알림이 없습니다.</td></tr>
              ) : (
                res.alerts.map((a) => (
                  <tr key={a.alertId} className="border-b cd-border-c">
                    <td className="py-2 px-2 font-mono text-[11px] cd-text-faint">{fmtKstFull(a.sentAt)}</td>
                    <td className="py-2 px-2">{a.budgetLabel}</td>
                    <td className="py-2 px-2"><span className={`cd-pill text-[10px] ${a.kind === "threshold" && a.pct >= 100 ? "cd-pill-error" : a.kind === "threshold" ? "cd-pill-warn" : "cd-pill-info"}`}>{KIND_LABEL[a.kind] ?? a.kind}</span></td>
                    <td className="py-2 px-2 text-right tabular-nums">{a.kind === "threshold" ? `${a.pct}%` : "-"}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{a.amountUsd != null ? fmtUsd(a.amountUsd) : "-"}</td>
                    <td className="py-2 px-2 text-xs cd-text-faint">{a.channels || "-"}</td>
                    <td className="py-2 px-2 text-xs">{a.message ?? ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CdModal open={!!editing} onClose={() => (saving ? undefined : setEditing(null))} title={editing?.budgetId ? "예산 편집" : "예산 추가"} size="lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <CdButton variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={saving}>취소</CdButton>
            <CdButton variant="primary" size="sm" onClick={save} disabled={saving} icon={saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}>저장</CdButton>
          </div>
        }
      >
        {editing && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="cd-label">범위</span>
              <select className="cd-select" value={editing.scopeKind} onChange={(e) => setF({ scopeKind: e.target.value as ScopeKind, scopeTarget: "" })} disabled={editing.scopeKind === "org" && !!editing.budgetId}>
                {!hasOrg || editing.scopeKind === "org" ? <option value="org">전체</option> : null}
                <option value="feature">기능별</option>
                <option value="model">모델별</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="cd-label">대상</span>
              {editing.scopeKind === "org" ? (
                <input className="cd-input" value="전체 Claude 호출" disabled />
              ) : editing.scopeKind === "feature" ? (
                <select className="cd-select" value={editing.scopeTarget} onChange={(e) => setF({ scopeTarget: e.target.value })}>
                  <option value="">기능 선택</option>
                  {Object.entries(AI_FEATURES).map(([k, v]) => (
                    <option key={k} value={k}>{v.group} · {v.label}</option>
                  ))}
                </select>
              ) : (
                <select className="cd-select" value={editing.scopeTarget} onChange={(e) => setF({ scopeTarget: e.target.value })}>
                  <option value="">모델 선택</option>
                  {data.prices.map((p) => (
                    <option key={p.modelFamily} value={p.modelFamily}>{p.displayName}</option>
                  ))}
                </select>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="cd-label">표시 이름(선택)</span>
              <input className="cd-input" value={editing.label} onChange={(e) => setF({ label: e.target.value })} placeholder={editing.scopeKind === "model" ? modelLabel(editing.scopeTarget, data.prices) : ""} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="cd-label">월 한도 (USD)</span>
              <input className="cd-input" inputMode="decimal" value={editing.monthlyLimitUsd} onChange={(e) => setF({ monthlyLimitUsd: e.target.value.replace(/[^0-9.]/g, "") })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="cd-label">경고 임계 (%, 콤마 구분)</span>
              <input className="cd-input" value={editing.warnPcts} onChange={(e) => setF({ warnPcts: e.target.value })} placeholder="50,80,100" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="cd-label">초과 시 정책</span>
              <select className="cd-select" value={editing.action} onChange={(e) => setF({ action: e.target.value as BudgetAction })}>
                {(Object.keys(ACTION_LABEL) as BudgetAction[]).map((k) => (
                  <option key={k} value={k}>{ACTION_LABEL[k]}</option>
                ))}
              </select>
              <span className="text-[11px] cd-text-faint">차단 정책은 한도 100% 도달 시 호출을 막습니다(기능은 기존 폴백으로 동작). 기본은 경고만.</span>
            </label>
            <div className="col-span-2 flex flex-col gap-1.5">
              <span className="cd-label">수신자 (비우면 시스템 관리자 템플릿 배정자)</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {editing.recipients.map((id) => (
                  <span key={id} className="cd-chip cd-chip-sm inline-flex items-center gap-1">
                    {names[id] ?? id}
                    <button type="button" onClick={() => setF({ recipients: editing.recipients.filter((x) => x !== id) })} title="제거"><X className="w-3 h-3" /></button>
                  </span>
                ))}
                <button type="button" className="cd-btn rounded-lg border cd-border-c px-2 py-1 text-xs inline-flex items-center gap-1" onClick={() => setPickerOpen(true)}>
                  <UserPlus className="w-3.5 h-3.5" /> 추가
                </button>
              </div>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer col-span-2">
              <input type="checkbox" checked={editing.enabled} onChange={(e) => setF({ enabled: e.target.checked })} /> 활성
            </label>
            {err && <div className="col-span-2 text-xs cd-error-text">{err}</div>}
          </div>
        )}
      </CdModal>

      <OrgPickerModal
        open={pickerOpen}
        title="알림 수신자 추가"
        hint="계정이 있는 직원만 추가할 수 있습니다."
        onClose={() => setPickerOpen(false)}
        onSelect={(emp) => {
          if (!emp.userId) return setErr(`${emp.name} 은(는) 계정이 없어 수신자로 지정할 수 없습니다.`);
          const uid = emp.userId;
          setNames((n) => ({ ...n, [uid]: emp.name }));
          setEditing((e) => (e && !e.recipients.includes(uid) ? { ...e, recipients: [...e.recipients, uid] } : e));
          setPickerOpen(false);
        }}
      />

    </div>
  );
}
