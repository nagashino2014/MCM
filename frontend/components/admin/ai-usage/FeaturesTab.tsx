"use client";

// 기능별 현황 탭 — 기능 × (적용 모델 셀렉트 · 호출 · 성공률 · 토큰 · 호출당 입력비/출력비 · 합계 · 스파크라인) + 드릴다운 드로어.
// 모델 변경(§3.6): 단가표의 selectable 모델만, 비전 기능은 supports_vision 만. 저장 전 what-if(기간 평균 토큰 × 새 단가)를 확인받는다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, RotateCcw, Search } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdDrawer, CdModal } from "@/components/cdash/CdModal";
import { modelCaps, type EffortLevel, type ThinkingMode, type ThinkingSetting } from "@/lib/ai/model-caps";
import {
  GROUP_ORDER,
  STATUS_LABEL,
  STATUS_TONE,
  fmtInt,
  fmtKstFull,
  fmtKstShort,
  fmtPct,
  fmtUsd,
  fmtUsdSmall,
  modelLabel,
  type FeatureStat,
  type ModelPriceRow,
  type SummaryResponse,
  type UsageLogRow,
} from "./types";

interface Props {
  data: SummaryResponse;
  canManage: boolean;
  onChanged: () => void;
}

/** 기간 평균 토큰 × 단가 → 호출당 추정 비용(캐시 쓰기는 무시, 캐시 읽기는 포함). */
function estimateAvgCost(f: FeatureStat, p: ModelPriceRow | undefined): number | null {
  if (!p) return null;
  return (f.avgInputTokens * p.inputPerMtok + f.avgCacheReadTokens * p.cacheReadPerMtok + f.avgOutputTokens * p.outputPerMtok) / 1_000_000;
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values, 0);
  return (
    <div className="flex items-end gap-[2px] h-6" title={values.map((v) => fmtUsdSmall(v)).join(" · ")}>
      {values.map((v, i) => (
        <div
          key={i}
          className="w-[5px] rounded-sm"
          style={{ height: max > 0 ? `${Math.max(8, (v / max) * 100)}%` : "8%", background: v > 0 ? "var(--cd-primary)" : "var(--cd-border)", opacity: v > 0 ? 0.85 : 1 }}
        />
      ))}
    </div>
  );
}

export function FeaturesTab({ data, canManage, onChanged }: Props) {
  const overrides = data.settings.featureModelOverrides;
  const prices = data.prices;
  const [pending, setPending] = useState<{ f: FeatureStat; model: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drill, setDrill] = useState<FeatureStat | null>(null);
  const [hideIdle, setHideIdle] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, FeatureStat[]>();
    for (const f of data.features) {
      if (hideIdle && f.calls === 0) continue;
      const arr = map.get(f.group) ?? [];
      arr.push(f);
      map.set(f.group, arr);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, rows: map.get(g)! }));
  }, [data.features, hideIdle]);

  const selectable = (f: FeatureStat) => prices.filter((p) => p.selectable && !p.deprecatedAt && (!f.vision || p.supportsVision));

  const currentModel = (f: FeatureStat) => overrides[f.featureKey] ?? f.topModel ?? f.defaultModel;

  /** 킬 스위치·thinking/effort 저장(P4) — settings PUT 공통. */
  const putSetting = async (body: Record<string, unknown>) => {
    setErr(null);
    try {
      const res = await fetch("/api/admin/ai-usage/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "저장하지 못했습니다.");
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const commit = async () => {
    if (!pending) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/ai-usage/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ featureModel: { feature: pending.f.featureKey, model: pending.model } }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "저장하지 못했습니다.");
      setPending(null);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const whatIf = pending
    ? (() => {
        const f = pending.f;
        const curPrice = prices.find((p) => p.modelFamily === currentModel(f));
        const newPrice = pending.model ? prices.find((p) => p.modelFamily === pending.model) : prices.find((p) => p.modelFamily === f.defaultModel);
        const cur = f.avgCost ?? estimateAvgCost(f, curPrice);
        const next = estimateAvgCost(f, newPrice);
        return { cur, next, calls: f.calls, curTotal: cur != null ? cur * f.calls : null, nextTotal: next != null ? next * f.calls : null };
      })()
    : null;

  return (
    <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="cd-card-title">기능별 현황</h3>
        <span className="text-[11px] cd-text-faint">
          {data.range.from} ~ {data.range.to} · 호출당 입력비/출력비는 현재 단가로 재계산 · 스파크라인은 최근 7일 · 사용 체크 해제 = 킬 스위치(호출 안 함, 기능은 폴백)
        </span>
        {err && !pending && <span className="text-xs cd-error-text">{err}</span>}
        <label className="ml-auto inline-flex items-center gap-1.5 text-xs cd-text-muted cursor-pointer">
          <input type="checkbox" checked={hideIdle} onChange={(e) => setHideIdle(e.target.checked)} />
          호출 없는 기능 숨김
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="cd-text-faint text-xs border-b cd-border-c">
              <th className="py-2 px-2 text-left min-w-[200px]">기능</th>
              <th className="py-2 px-2 text-left min-w-[190px]">적용 모델 · thinking / effort</th>
              <th className="py-2 px-2 text-right">호출</th>
              <th className="py-2 px-2 text-right">성공률</th>
              <th className="py-2 px-2 text-right">평균 입력/출력 tok</th>
              <th className="py-2 px-2 text-right" title="평균 출력 토큰 / 요청 max_tokens — 낮으면 상한을 줄이고, 잘림이 있으면 늘린다">출력/상한</th>
              <th className="py-2 px-2 text-right">호출당 입력비</th>
              <th className="py-2 px-2 text-right">호출당 출력비</th>
              <th className="py-2 px-2 text-right">호출당 합계</th>
              <th className="py-2 px-2 text-right">기간 합계</th>
              <th className="py-2 px-2 text-right">최대 단건</th>
              <th className="py-2 px-2 text-left">7일</th>
              <th className="py-2 px-2 text-left">마지막</th>
              <th className="py-2 px-2 text-right w-24"></th>
            </tr>
          </thead>
          <tbody>
            {grouped.length === 0 ? (
              <tr>
                <td colSpan={14} className="py-10 text-center cd-text-faint">표시할 기능이 없습니다.</td>
              </tr>
            ) : (
              grouped.map(({ group, rows }) => (
                <GroupRows
                  key={group}
                  group={group}
                  rows={rows}
                  prices={prices}
                  overrides={overrides}
                  enabledMap={data.settings.featureEnabled}
                  thinkingMap={data.settings.featureThinking}
                  canManage={canManage}
                  selectable={selectable}
                  currentModel={currentModel}
                  onPick={(f, model) => setPending({ f, model })}
                  onDrill={setDrill}
                  onToggleEnabled={(f, enabled) => putSetting({ featureEnabled: { feature: f.featureKey, enabled } })}
                  onThinking={(f, t) => putSetting({ featureThinking: { feature: f.featureKey, thinking: t.thinking ?? null, effort: t.effort ?? null } })}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <CdModal open={!!pending} onClose={() => (saving ? undefined : setPending(null))} title="적용 모델 변경" size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <CdButton variant="ghost" size="sm" onClick={() => setPending(null)} disabled={saving}>취소</CdButton>
            <CdButton variant="primary" size="sm" onClick={commit} disabled={saving} icon={saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}>
              변경 저장
            </CdButton>
          </div>
        }
      >
        {pending && whatIf && (
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <div className="font-semibold">{pending.f.label}</div>
              <div className="text-xs cd-text-faint">{pending.f.featureKey}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border cd-border-c p-3">
                <div className="text-[11px] cd-text-muted">현재</div>
                <div className="font-semibold">{modelLabel(currentModel(pending.f), prices)}</div>
                <div className="text-xs cd-text-faint mt-1">호출당 {fmtUsdSmall(whatIf.cur)}</div>
              </div>
              <div className="rounded-xl border cd-border-c p-3 cd-tint-primary">
                <div className="text-[11px] cd-text-muted">변경 후 {pending.model ? "" : "(기본값)"}</div>
                <div className="font-semibold">{modelLabel(pending.model ?? pending.f.defaultModel, prices)}</div>
                <div className="text-xs cd-text-faint mt-1">호출당 {fmtUsdSmall(whatIf.next)} (추정)</div>
              </div>
            </div>
            <div className="text-xs cd-text-muted">
              기간 {data.range.from}~{data.range.to} 의 {fmtInt(whatIf.calls)}회 기준: {fmtUsd(whatIf.curTotal, 3)} → {fmtUsd(whatIf.nextTotal, 3)}
              {whatIf.curTotal != null && whatIf.nextTotal != null && (
                <span className={whatIf.nextTotal > whatIf.curTotal ? " cd-error-text" : " cd-success-text"}>
                  {" "}({whatIf.nextTotal > whatIf.curTotal ? "+" : ""}{fmtUsd(whatIf.nextTotal - whatIf.curTotal, 3)})
                </span>
              )}
            </div>
            <p className="text-[11px] cd-text-faint">
              추정은 기간 평균 토큰 × 새 단가입니다(모델이 바뀌면 출력 토큰·thinking 도 달라져 실제와 차이가 날 수 있습니다). 변경은 즉시 반영되며 이력에 남습니다.
            </p>
            {err && <div className="text-xs cd-error-text">{err}</div>}
          </div>
        )}
      </CdModal>

      <LogsDrawer feature={drill} range={data.range} prices={prices} onClose={() => setDrill(null)} />
    </div>
  );
}

const EFFORT_OPTIONS: { v: EffortLevel; label: string }[] = [
  { v: "low", label: "effort low" },
  { v: "medium", label: "effort medium" },
  { v: "high", label: "effort high" },
  { v: "xhigh", label: "effort xhigh" },
  { v: "max", label: "effort max" },
];

function GroupRows({
  group, rows, prices, overrides, enabledMap, thinkingMap, canManage, selectable, currentModel, onPick, onDrill, onToggleEnabled, onThinking,
}: {
  group: string;
  rows: FeatureStat[];
  prices: ModelPriceRow[];
  overrides: Record<string, string>;
  enabledMap: Record<string, boolean>;
  thinkingMap: Record<string, ThinkingSetting>;
  canManage: boolean;
  selectable: (f: FeatureStat) => ModelPriceRow[];
  currentModel: (f: FeatureStat) => string;
  onPick: (f: FeatureStat, model: string | null) => void;
  onDrill: (f: FeatureStat) => void;
  onToggleEnabled: (f: FeatureStat, enabled: boolean) => void;
  onThinking: (f: FeatureStat, t: ThinkingSetting) => void;
}) {
  const groupCost = rows.reduce((s, r) => s + r.cost, 0);
  const groupCalls = rows.reduce((s, r) => s + r.calls, 0);
  return (
    <>
      <tr className="cd-surface-bg">
        <td colSpan={14} className="py-1.5 px-2 text-xs font-semibold cd-text-muted">
          {group}
          <span className="ml-2 font-normal cd-text-faint">{fmtInt(groupCalls)}회 · {fmtUsd(groupCost, 3)}</span>
        </td>
      </tr>
      {rows.map((f) => {
        const overridden = !!overrides[f.featureKey];
        const cur = currentModel(f);
        const ok = f.calls ? (f.okCalls / f.calls) * 100 : null;
        const avgIn = f.calls && f.costIn != null ? f.costIn / f.calls : null;
        const avgOut = f.calls && f.costOut != null ? f.costOut / f.calls : null;
        const enabled = enabledMap[f.featureKey] !== false;
        const caps = modelCaps(cur);
        const ts = thinkingMap[f.featureKey] ?? {};
        const outRatio = f.avgMaxTokens && f.avgMaxTokens > 0 ? (f.avgOutputTokens / f.avgMaxTokens) * 100 : null;
        return (
          <tr key={f.featureKey} className={`border-b cd-border-c cd-row-hover ${enabled ? "" : "opacity-60"}`}>
            <td className="py-2 px-2">
              <div className="flex items-center gap-1.5">
                {canManage && f.registered && (
                  <input
                    type="checkbox"
                    checked={enabled}
                    title={enabled ? "사용 중 — 해제하면 이 기능의 Claude 호출을 막습니다" : "사용 중지(킬 스위치)"}
                    onChange={(e) => onToggleEnabled(f, e.target.checked)}
                  />
                )}
                <span className="font-medium">{f.label}</span>
                {!enabled && <span className="cd-pill cd-pill-error text-[10px]">중지</span>}
                {f.critical && <span className="cd-pill cd-pill-info text-[10px]">필수</span>}
                {f.vision && <span className="cd-pill cd-pill-outline text-[10px]">비전</span>}
                {!f.registered && <span className="cd-pill cd-pill-warn text-[10px]">미등록 키</span>}
                {f.downgradedCalls > 0 && <span className="cd-pill cd-pill-warn text-[10px]" title="예산 자동 강등으로 다른 모델이 쓰인 호출">강등 {f.downgradedCalls}</span>}
              </div>
              <div className="text-[10px] cd-text-faint font-mono">{f.featureKey}</div>
            </td>
            <td className="py-2 px-2">
              {canManage && f.registered ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <select
                      className="cd-select"
                      style={{ width: 150 }}
                      value={cur}
                      onChange={(e) => onPick(f, e.target.value)}
                      title={overridden ? "관리 화면 오버라이드 적용 중" : "기본값(코드·env)"}
                    >
                      {!selectable(f).some((p) => p.modelFamily === cur) && <option value={cur}>{modelLabel(cur, prices)}</option>}
                      {selectable(f).map((p) => (
                        <option key={p.modelFamily} value={p.modelFamily}>
                          {p.displayName} (${p.inputPerMtok}/${p.outputPerMtok})
                        </option>
                      ))}
                    </select>
                    {overridden && (
                      <button type="button" className="cd-btn rounded-lg border cd-border-c p-1.5" title="기본값으로" onClick={() => onPick(f, null)}>
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {(caps.adaptiveThinking || caps.effort) && (
                    <div className="flex items-center gap-1">
                      {caps.adaptiveThinking && (
                        <select
                          className="cd-select text-[11px]"
                          style={{ width: 88, padding: "3px 6px" }}
                          value={ts.thinking ?? ""}
                          title={`thinking — 미설정이면 모델 기본(${caps.thinkingDefaultOn ? "켜짐" : "꺼짐"}). 구조 추출류는 off 로 출력 토큰 절감`}
                          onChange={(e) => onThinking(f, { thinking: (e.target.value || null) as ThinkingMode | null, effort: ts.effort ?? null })}
                        >
                          <option value="">thinking 기본</option>
                          <option value="adaptive">thinking on</option>
                          {caps.thinkingDisable && <option value="off">thinking off</option>}
                        </select>
                      )}
                      {caps.effort && (
                        <select
                          className="cd-select text-[11px]"
                          style={{ width: 104, padding: "3px 6px" }}
                          value={ts.effort ?? ""}
                          title="effort — 미설정이면 high. 낮출수록 thinking·출력이 줄어 비용 절감"
                          onChange={(e) => onThinking(f, { thinking: ts.thinking ?? null, effort: (e.target.value || null) as EffortLevel | null })}
                        >
                          <option value="">effort 기본</option>
                          {EFFORT_OPTIONS.filter((o) => caps.effortLevels.includes(o.v)).map((o) => (
                            <option key={o.v} value={o.v}>{o.label}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-xs">
                  {modelLabel(cur, prices)}
                  {overridden && <span className="ml-1 cd-pill cd-pill-info text-[10px]">오버라이드</span>}
                  {(ts.thinking || ts.effort) && <span className="ml-1 cd-text-faint">{[ts.thinking && `thinking ${ts.thinking}`, ts.effort && `effort ${ts.effort}`].filter(Boolean).join(" · ")}</span>}
                </span>
              )}
            </td>
            <td className="py-2 px-2 text-right tabular-nums">{fmtInt(f.calls)}</td>
            <td className={`py-2 px-2 text-right tabular-nums ${ok != null && ok < 80 ? "cd-error-text" : ""}`}>
              {fmtPct(ok)}
              {f.truncatedCalls > 0 && <div className="text-[10px] cd-warn-text">잘림 {f.truncatedCalls}</div>}
            </td>
            <td className="py-2 px-2 text-right tabular-nums text-xs">{fmtInt(f.avgInputTokens)} / {fmtInt(f.avgOutputTokens)}</td>
            <td className={`py-2 px-2 text-right tabular-nums text-xs ${outRatio != null && outRatio > 90 ? "cd-warn-text" : ""}`} title={f.avgMaxTokens ? `평균 max_tokens ${fmtInt(f.avgMaxTokens)}` : ""}>
              {outRatio != null ? fmtPct(outRatio) : "-"}
            </td>
            <td className="py-2 px-2 text-right tabular-nums">{fmtUsdSmall(avgIn)}</td>
            <td className="py-2 px-2 text-right tabular-nums">{fmtUsdSmall(avgOut)}</td>
            <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmtUsdSmall(f.avgCost)}</td>
            <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(f.cost, 3)}</td>
            <td className="py-2 px-2 text-right tabular-nums text-xs">{fmtUsdSmall(f.maxCost)}</td>
            <td className="py-2 px-2"><Spark values={f.spark} /></td>
            <td className="py-2 px-2 text-xs cd-text-faint tabular-nums">{fmtKstShort(f.lastCalledAt)}</td>
            <td className="py-2 px-2 text-right">
              <button type="button" className="cd-btn rounded-lg border cd-border-c px-2 py-1 text-xs inline-flex items-center gap-1" onClick={() => onDrill(f)} disabled={f.calls === 0}>
                <Search className="w-3 h-3" /> 이력
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function LogsDrawer({ feature, range, prices, onClose }: { feature: FeatureStat | null; range: { from: string; to: string }; prices: ModelPriceRow[]; onClose: () => void }) {
  const [rows, setRows] = useState<UsageLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const PAGE = 50;

  const query = useCallback(
    (extra: Record<string, string> = {}) => {
      const p = new URLSearchParams({ from: range.from, to: range.to, ...(feature ? { feature: feature.featureKey } : {}), ...extra });
      return `/api/admin/ai-usage/logs?${p.toString()}`;
    },
    [feature, range]
  );

  useEffect(() => {
    setPage(1);
  }, [feature]);

  useEffect(() => {
    if (!feature) return;
    let cancelled = false;
    setLoading(true);
    fetch(query({ page: String(page), pageSize: String(PAGE) }), { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setRows(j.rows ?? []);
        setTotal(Number(j.total ?? 0));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [feature, page, query]);

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <CdDrawer open={!!feature} onClose={onClose} title={feature ? `${feature.label} — 호출 이력` : ""} widthClass="max-w-4xl"
      footer={
        <div className="flex items-center justify-between text-xs">
          <span className="cd-text-faint">{fmtInt(total)}건 · {range.from} ~ {range.to}</span>
          <div className="flex items-center gap-2">
            <button type="button" className="cd-chip cd-chip-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
            <span className="cd-text-faint tabular-nums">{page} / {pages}</span>
            <button type="button" className="cd-chip cd-chip-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>다음</button>
            <a className="cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 inline-flex items-center gap-1" href={query({ format: "csv" })}>
              <Download className="w-3.5 h-3.5" /> CSV
            </a>
          </div>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="cd-text-faint border-b cd-border-c">
              <th className="py-1.5 px-2 text-left">일시(KST)</th>
              <th className="py-1.5 px-2 text-left">모델</th>
              <th className="py-1.5 px-2 text-left">상태</th>
              <th className="py-1.5 px-2 text-right">입력/캐시/출력 tok</th>
              <th className="py-1.5 px-2 text-right">비용</th>
              <th className="py-1.5 px-2 text-right">소요</th>
              <th className="py-1.5 px-2 text-left">사용자</th>
              <th className="py-1.5 px-2 text-left">대상</th>
              <th className="py-1.5 px-2 text-left">request-id</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="py-8 text-center cd-text-faint"><Loader2 className="w-4 h-4 animate-spin inline-block mr-2 align-[-2px]" />불러오는 중…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="py-8 text-center cd-text-faint">호출 이력이 없습니다.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.logId} className="border-b cd-border-c">
                  <td className="py-1.5 px-2 font-mono cd-text-faint">{fmtKstFull(r.calledAt)}</td>
                  <td className="py-1.5 px-2">{modelLabel(r.modelFamily, prices)}</td>
                  <td className="py-1.5 px-2"><span className={`cd-pill ${STATUS_TONE[r.status] ?? "cd-pill-idle"} text-[10px]`}>{STATUS_LABEL[r.status] ?? r.status}</span>{r.stopReason && r.stopReason !== "end_turn" && <span className="ml-1 cd-text-faint">{r.stopReason}</span>}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtInt(r.inputTokens)} / {fmtInt(r.cacheReadInputTokens)} / {fmtInt(r.outputTokens)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtUsdSmall(r.costUsd)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums cd-text-faint">{r.latencyMs != null ? `${(r.latencyMs / 1000).toFixed(1)}s` : "-"}</td>
                  <td className="py-1.5 px-2">{r.userName ?? r.userId ?? <span className="cd-text-faint">-</span>}</td>
                  <td className="py-1.5 px-2 cd-text-faint">{r.subjectType ? `${r.subjectType}:${r.subjectId ?? ""}` : "-"}</td>
                  <td className="py-1.5 px-2 font-mono cd-text-faint">{r.requestId ? r.requestId.slice(0, 18) + "…" : "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </CdDrawer>
  );
}
