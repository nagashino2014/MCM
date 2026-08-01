"use client";

// 데이터 지표(/approval/metrics, admin) — SW-P2 지표 엔진의 시험대.
// 좌: 지표 목록(시드+사용자 정의) / 우: 실행 결과 표 + 진단 메타(대상·제외 사유 — 근거 없는 숫자 금지 §3-3).
// 정의 편집은 v1 에서 JSON 직접 편집(관리자용) — 노코드 마법사는 SW-P3 에서 이 화면을 대체·확장한다.
// 설계: docs/semantic-analytics-wizard-blueprint.md §4-3.

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Play, Plus, Save, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { formatMetricValue, parseMetricDefinition, type MetricItem, type MetricResult } from "@/lib/analytics/metric-types";
import "@/components/cdash/cdash.css";

const KIND_LABEL: Record<string, string> = { aggregate: "집계", composite: "복합(수식)" };
const VIS_LABEL: Record<string, string> = { admin: "관리자", all: "전체", owner: "작성자" };
const EXCLUDE_LABEL: Record<string, string> = {
  noGroupKey: "참조 미입력",
  manualRef: "직접 입력(마스터 미연결)",
  emptyValue: "값 비어 있음",
  emptyDoc: "문서 값 없음",
  formWithoutRefField: "양식에 참조 필드 없음",
};

export function ApprovalMetricsBoard() {
  const { theme } = useCdashTheme();
  const [metrics, setMetrics] = useState<MetricItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [result, setResult] = useState<MetricResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [editJson, setEditJson] = useState<string>("");
  const [editMeta, setEditMeta] = useState<{ metricKey: string; label: string; description: string; visibility: MetricItem["visibility"] } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/approval/metrics", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "지표 목록을 불러오지 못했습니다.");
      setMetrics(body.metrics ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const selected = metrics.find((m) => m.metricKey === selectedKey) ?? null;

  const select = (m: MetricItem) => {
    setSelectedKey(m.metricKey);
    setResult(null);
    setRunError(null);
    setEditJson(JSON.stringify(m.definition, null, 2));
    setEditMeta({ metricKey: m.metricKey, label: m.label, description: m.description ?? "", visibility: m.visibility });
  };

  const run = async (key: string) => {
    setRunning(true);
    setRunError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/approval/metrics?run=${encodeURIComponent(key)}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "실행 실패");
      setResult(body.result);
    } catch (err) {
      setRunError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const save = async () => {
    if (!editMeta) return;
    const def = parseMetricDefinition(editJson);
    if (!def) {
      alert("정의 JSON 이 올바르지 않습니다.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/approval/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metric: {
            metricKey: editMeta.metricKey.trim(),
            label: editMeta.label,
            description: editMeta.description || null,
            definition: def,
            visibility: editMeta.visibility,
            active: true,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "저장 실패");
      await load();
      setSelectedKey(editMeta.metricKey.trim());
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (key: string) => {
    if (!confirm(`지표 '${key}' 를 삭제할까요? (수식이 참조 중이면 해당 복합 지표가 실패합니다)`)) return;
    const res = await fetch("/api/approval/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleteKey: key }),
    });
    if (res.ok) {
      if (selectedKey === key) {
        setSelectedKey(null);
        setEditMeta(null);
        setResult(null);
      }
      await load();
    }
  };

  const addNew = () => {
    const key = prompt("새 지표 키(영문 소문자·숫자·_):", "new_metric");
    if (!key?.trim()) return;
    setSelectedKey(null);
    setResult(null);
    setRunError(null);
    setEditMeta({ metricKey: key.trim(), label: "새 지표", description: "", visibility: "admin" });
    setEditJson(
      JSON.stringify(
        { kind: "aggregate", source: { type: "approval_docs", forms: "auto", status: ["approved"] }, measure: { agg: "sum", concept: "cost.travel" }, groupBy: ["ref.contract"] },
        null,
        2
      )
    );
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="데이터 지표"
        meta={`${metrics.length}개 지표 · 실행 결과에는 항상 산출 근거(대상·제외 사유)가 따라붙습니다`}
        actions={
          <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5" onClick={addNew}>
            <Plus className="w-3.5 h-3.5" /> 새 지표
          </button>
        }
      />
      {error && <p className="text-sm cd-error-text">{error}</p>}
      {loading ? (
        <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] gap-4 overflow-y-auto xl:overflow-visible">
          {/* 좌: 지표 목록 */}
          <div className="flex flex-col gap-2 min-w-0 xl:overflow-y-auto">
            {metrics.map((m) => (
              <button
                key={m.metricKey}
                type="button"
                onClick={() => select(m)}
                className={`rounded-2xl border px-3.5 py-3 text-left ${selectedKey === m.metricKey ? "cd-glass-active" : "cd-border-c cd-row-hover"}`}
                style={{ background: selectedKey === m.metricKey ? undefined : "var(--cd-card-solid)" }}
              >
                <span className="flex items-center gap-2">
                  <BarChart3 className="w-3.5 h-3.5 cd-text-primary shrink-0" />
                  <span className="text-[13px] font-bold cd-text truncate">{m.label}</span>
                  <span className="ml-auto text-[10px] rounded-md border cd-border-c px-1.5 py-0.5 cd-text-faint shrink-0">
                    {KIND_LABEL[m.definition.kind]}
                  </span>
                </span>
                <span className="block text-[10.5px] cd-text-faint font-mono mt-0.5">{m.metricKey}</span>
                {m.description && <span className="block text-[10.5px] cd-text-faint mt-0.5 leading-relaxed">{m.description}</span>}
                <span className="block text-[10px] cd-text-faint mt-1">공개: {VIS_LABEL[m.visibility]} · v{m.version}</span>
              </button>
            ))}
            {metrics.length === 0 && <p className="text-[12px] cd-text-faint py-6 text-center">지표가 없습니다. 마이그레이션 117 시드를 확인하세요.</p>}
          </div>

          {/* 우: 실행·편집 */}
          <div className="flex flex-col gap-4 min-w-0 xl:overflow-y-auto">
            {!editMeta ? (
              <div className="cd-card p-6">
                <p className="text-[12.5px] cd-text-faint text-center py-8">왼쪽에서 지표를 선택하면 실행·편집할 수 있습니다.</p>
              </div>
            ) : (
              <>
                {/* 정의 편집(관리자 시험대 — 마법사는 SW-P3) */}
                <div className="cd-card p-5 gap-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input className="cd-input font-bold" style={{ width: 220 }} value={editMeta.label} onChange={(e) => setEditMeta({ ...editMeta, label: e.target.value })} />
                    <span className="text-[10.5px] cd-text-faint font-mono">{editMeta.metricKey}</span>
                    <select
                      className="cd-select"
                      style={{ width: 110 }}
                      value={editMeta.visibility}
                      onChange={(e) => setEditMeta({ ...editMeta, visibility: e.target.value as MetricItem["visibility"] })}
                    >
                      <option value="admin">관리자만</option>
                      <option value="all">전체 공개</option>
                      <option value="owner">작성자만</option>
                    </select>
                    <span className="ml-auto flex items-center gap-1.5">
                      <button
                        type="button"
                        className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        disabled={running}
                        onClick={() => {
                          save().then(() => run(editMeta.metricKey.trim()));
                        }}
                      >
                        <Play className="w-3.5 h-3.5 inline mr-1" />
                        {running ? "실행 중..." : "저장 후 실행"}
                      </button>
                      <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-xs disabled:opacity-50" disabled={saving} onClick={save}>
                        <Save className="w-3.5 h-3.5 inline mr-1" /> 저장
                      </button>
                      {selected && (
                        <button type="button" className="cd-text-faint hover:cd-error-text" title="삭제" onClick={() => remove(selected.metricKey)}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </span>
                  </div>
                  <input
                    className="cd-input text-[12px]"
                    placeholder="설명(선택)"
                    value={editMeta.description}
                    onChange={(e) => setEditMeta({ ...editMeta, description: e.target.value })}
                  />
                  <textarea
                    className="cd-input font-mono text-[11.5px] min-h-[150px] leading-relaxed"
                    spellCheck={false}
                    value={editJson}
                    onChange={(e) => setEditJson(e.target.value)}
                  />
                  <p className="text-[10.5px] cd-text-faint leading-relaxed">
                    정의는 선언 JSON 입니다 — 지표는 필드가 아닌 <b>데이터 의미 태그</b>(예: cost.travel)를 참조하므로 양식이 바뀌어도 태그만
                    붙이면 그대로 동작합니다. 소스: approval_docs(태그 집계) · system.contracts/participants/attendance/leave. 복합(composite)은
                    지표 키·사칙연산·괄호 토큰만 허용됩니다.
                  </p>
                </div>

                {/* 실행 결과 */}
                {runError && <p className="text-sm cd-error-text">{runError}</p>}
                {result && (
                  <div className="cd-card p-5 gap-3">
                    <h3 className="font-bold cd-text text-[13.5px]">{result.label} — 실행 결과</h3>
                    {/* 진단 메타 — 근거 없는 숫자 금지(§3-3) */}
                    <div className="rounded-xl border border-dashed cd-border-c px-3 py-2 text-[11px] cd-text-faint leading-relaxed">
                      소스: {result.diagnostics.sources.join(", ")}
                      {result.diagnostics.totalDocs != null && <> · 대상 문서 {result.diagnostics.totalDocs}건</>}
                      {" · "}사용 {result.diagnostics.usedRows}행
                      {Object.entries(result.diagnostics.excluded).length > 0 && (
                        <>
                          {" · 제외: "}
                          {Object.entries(result.diagnostics.excluded)
                            .map(([k, v]) => `${EXCLUDE_LABEL[k] ?? EXCLUDE_LABEL[k.split(".").pop() ?? ""] ?? k} ${v}건`)
                            .join(", ")}
                        </>
                      )}
                      {result.diagnostics.notes.map((n, i) => (
                        <span key={i} className="block">{n}</span>
                      ))}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-left cd-text-faint text-[11px]">
                            <th className="py-1.5 pr-2 font-semibold">구분</th>
                            {result.hasTime && <th className="py-1.5 pr-2 font-semibold">기간</th>}
                            <th className="py-1.5 font-semibold text-right">값</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((r, i) => (
                            <tr key={i} className="border-t cd-border-c">
                              <td className="py-1.5 pr-2 cd-text">{r.groupLabel}</td>
                              {result.hasTime && <td className="py-1.5 pr-2 cd-text-faint">{r.time ?? "-"}</td>}
                              <td className="py-1.5 text-right font-bold cd-text">{formatMetricValue(r.value, result.format)}</td>
                            </tr>
                          ))}
                          {result.rows.length === 0 && (
                            <tr>
                              <td colSpan={result.hasTime ? 3 : 2} className="py-6 text-center text-[12px] cd-text-faint">
                                결과가 없습니다 — 진단 메타의 제외 사유를 확인하세요.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
