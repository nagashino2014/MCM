"use client";

// 양식 연계(액션 배선) 편집기(P7) — 빌더 하단 섹션. "이 양식이 승인/상신되면 어떤 앱 기능이
// 실행되는가"를 관리자가 GUI 로 배선한다. 커넥터는 코드 화이트리스트(레지스트리)만 선택 가능하고,
// 슬롯↔필드 매핑을 드롭다운으로 연결한다. [드라이런]은 기존 문서 하나를 골라 실행 없이
// 슬롯 해석·실행 예고("연차 대장에 -1일 적재됩니다")를 보여줘 설정 실수를 배선 확정 전에 잡는다.
// 서버: /api/approval/form-actions (lib/approval/actions.ts P7 절).

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical, Plus, Save, Trash2, Workflow } from "lucide-react";
import { resolveFieldConcept, type ApprovalFieldDef } from "@/lib/approval/fields";

interface SlotDef {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
}
interface CatalogItem {
  kind: string;
  label: string;
  description: string;
  slots: SlotDef[];
  hasPreview: boolean;
}
interface ActionConfig {
  actionId: string | null;
  actionKind: string;
  triggerOn: "approved" | "submitted" | "rejected";
  fieldMap: Record<string, string>;
  active: boolean;
  sortOrder: number;
}
interface RecentDoc {
  docId: string;
  docNo: string | null;
  title: string;
  status: string;
  drafterName: string | null;
}
interface DryRunSlot {
  key: string;
  label: string;
  required: boolean;
  mappedTo: string | null;
  fieldLabel: string | null;
  value: string | null;
  ok: boolean;
}
interface DryRunResult {
  connectorLabel: string;
  slots: DryRunSlot[];
  preview: string | null;
  error: string | null;
}

const TRIGGER_LABEL: Record<string, string> = { approved: "승인 완료 시", submitted: "상신 시", rejected: "반려 시" };

export function FormActionsEditor({ formId, fields }: { formId: string; fields: ApprovalFieldDef[] }) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [actions, setActions] = useState<ActionConfig[]>([]);
  const [recentDocs, setRecentDocs] = useState<RecentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addKind, setAddKind] = useState("");
  const [dryDocId, setDryDocId] = useState("");
  const [dryBusy, setDryBusy] = useState<number | null>(null);
  const [dryResults, setDryResults] = useState<Record<number, DryRunResult>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/approval/form-actions?formId=${encodeURIComponent(formId)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "연계 설정 조회 실패");
      setCatalog(Array.isArray(data.catalog) ? data.catalog : []);
      setActions(Array.isArray(data.actions) ? data.actions : []);
      setRecentDocs(Array.isArray(data.recentDocs) ? data.recentDocs : []);
      setDryDocId((prev) => prev || (data.recentDocs?.[0]?.docId ?? ""));
      setDirty(false);
      setDryResults({});
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [formId]);

  useEffect(() => {
    void load();
  }, [load]);

  const connectorOf = (kind: string) => catalog.find((c) => c.kind === kind);

  // 슬롯 매핑 드롭다운 옵션 — 현재 편집 중인 필드 + 시맨틱 바인딩(양식 개조에도 연계 유지)
  const semanticConcepts = useMemo(() => {
    const set = new Set<string>();
    for (const f of fields) {
      const concept = resolveFieldConcept(f);
      if (concept) set.add(concept);
    }
    return [...set].sort();
  }, [fields]);

  const patchAction = (idx: number, patch: Partial<ActionConfig>) => {
    setActions((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
    setDirty(true);
    setDryResults((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  const addAction = () => {
    const connector = connectorOf(addKind);
    if (!connector) return;
    setActions((prev) => [
      ...prev,
      { actionId: null, actionKind: connector.kind, triggerOn: "approved", fieldMap: {}, active: true, sortOrder: prev.length },
    ]);
    setAddKind("");
    setDirty(true);
  };

  const removeAction = (idx: number) => {
    const target = actions[idx];
    if (
      target.actionId &&
      !confirm("이 연계를 삭제하면 해당 액션의 실행 이력도 함께 삭제됩니다. 계속할까요?\n(끄기만 하려면 삭제 대신 '사용' 체크를 해제하세요.)")
    )
      return;
    setActions((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/approval/form-actions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId, actions }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      setActions(Array.isArray(data.actions) ? data.actions : []);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSaving(false);
  };

  const dryRun = async (idx: number) => {
    const action = actions[idx];
    if (!dryDocId) return;
    setDryBusy(idx);
    setError(null);
    try {
      const res = await fetch("/api/approval/form-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId, actionKind: action.actionKind, fieldMap: action.fieldMap, docId: dryDocId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "드라이런 실패");
      setDryResults((prev) => ({ ...prev, [idx]: data.result as DryRunResult }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setDryBusy(null);
  };

  return (
    <div className="rounded-2xl border cd-border-c p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[13px] font-bold cd-text flex items-center gap-1.5">
          <Workflow className="w-4 h-4" /> 연계 — 승인/상신 시 자동 처리
          {actions.length > 0 && <span className="cd-chip">{actions.length}</span>}
        </p>
        <span className="text-[11px] cd-text-faint">
          이 양식의 문서가 결재를 통과하면 선택한 앱 기능이 자동 실행됩니다. 실행 결과·실패는 문서별 액션 로그에 남고 재실행할 수 있습니다.
        </span>
        <button type="button" className="cd-btn cd-btn-primary cd-btn-sm ml-auto" disabled={saving || !dirty} onClick={() => void save()}>
          <Save className="w-3.5 h-3.5" /> 연계 저장
        </button>
      </div>

      {error && <p className="text-[12px]" style={{ color: "var(--cd-error,#FA896B)" }}>{error}</p>}

      {loading ? (
        <p className="text-[12px] cd-text-faint">불러오는 중…</p>
      ) : (
        <>
          {actions.map((action, idx) => {
            const connector = connectorOf(action.actionKind);
            const dry = dryResults[idx];
            return (
              <div key={action.actionId ?? `new-${idx}`} className="rounded-xl border cd-border-c p-3 flex flex-col gap-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12.5px] font-bold cd-text">{connector?.label ?? action.actionKind}</span>
                  <span className="text-[11px] cd-text-faint flex-1 min-w-[160px]">{connector?.description}</span>
                  <select
                    className="cd-select"
                    style={{ width: 130 }}
                    value={action.triggerOn}
                    onChange={(e) => patchAction(idx, { triggerOn: e.target.value as ActionConfig["triggerOn"] })}
                  >
                    {Object.entries(TRIGGER_LABEL).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-[11.5px] cd-text cursor-pointer">
                    <input type="checkbox" checked={action.active} onChange={(e) => patchAction(idx, { active: e.target.checked })} /> 사용
                  </label>
                  <button
                    type="button"
                    className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
                    title="연계 삭제"
                    onClick={() => removeAction(idx)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 슬롯 ↔ 필드 매핑 */}
                {connector && connector.slots.length > 0 && (
                  <div className="grid md:grid-cols-2 gap-x-4 gap-y-1.5">
                    {connector.slots.map((slot) => (
                      <label key={slot.key} className="flex items-center gap-2 text-[11.5px] cd-text-muted min-w-0" title={slot.hint}>
                        <span className="w-[120px] shrink-0 truncate">
                          {slot.label}
                          {slot.required && <span style={{ color: "var(--cd-error,#FA896B)" }}> *</span>}
                        </span>
                        <select
                          className="cd-select flex-1 min-w-0"
                          value={action.fieldMap[slot.key] ?? ""}
                          onChange={(e) => patchAction(idx, { fieldMap: { ...action.fieldMap, [slot.key]: e.target.value } })}
                        >
                          <option value="">매핑 안 함</option>
                          <optgroup label="양식 필드">
                            {fields
                              .filter((f) => f.type !== "static")
                              .map((f) => (
                                <option key={f.key} value={f.key}>
                                  {f.label} ({f.key})
                                </option>
                              ))}
                          </optgroup>
                          {semanticConcepts.length > 0 && (
                            <optgroup label="시맨틱 바인딩(필드 key 가 바뀌어도 유지)">
                              {semanticConcepts.map((concept) => (
                                <option key={concept} value={`semantic:${concept}`}>
                                  semantic: {concept}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </label>
                    ))}
                  </div>
                )}

                {/* 드라이런 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="cd-btn cd-btn-soft cd-btn-sm"
                    disabled={dryBusy === idx || !dryDocId}
                    onClick={() => void dryRun(idx)}
                    title="실제 실행 없이, 선택한 기존 문서 기준으로 슬롯 해석·실행 결과를 미리 봅니다"
                  >
                    <FlaskConical className="w-3.5 h-3.5" /> {dryBusy === idx ? "확인 중…" : "드라이런"}
                  </button>
                  <select className="cd-select flex-1 min-w-[200px]" value={dryDocId} onChange={(e) => setDryDocId(e.target.value)}>
                    {recentDocs.length === 0 && <option value="">이 양식의 문서가 아직 없습니다</option>}
                    {recentDocs.map((d) => (
                      <option key={d.docId} value={d.docId}>
                        {d.docNo ?? "미채번"} · {d.title} ({d.drafterName ?? "-"})
                      </option>
                    ))}
                  </select>
                </div>
                {dry && (
                  <div className="rounded-lg cd-surface-bg border cd-border-c px-3 py-2 flex flex-col gap-1.5">
                    <div className="flex flex-col gap-0.5">
                      {dry.slots.map((s) => (
                        <p key={s.key} className="text-[11px] cd-text-muted">
                          <span className={s.ok ? "" : "font-bold"} style={s.ok ? undefined : { color: "var(--cd-error,#FA896B)" }}>
                            {s.label}
                          </span>
                          {" ← "}
                          {s.mappedTo ? `${s.fieldLabel ?? "(해석 실패)"} = ${s.value ?? "(값 없음)"}` : "(매핑 안 함)"}
                        </p>
                      ))}
                    </div>
                    {dry.error ? (
                      <p className="text-[12px] font-bold" style={{ color: "var(--cd-error,#FA896B)" }}>{dry.error}</p>
                    ) : dry.preview ? (
                      <p className="text-[12px] cd-text">▶ {dry.preview}</p>
                    ) : (
                      <p className="text-[12px] cd-text-faint">필수 슬롯이 모두 해석됩니다 — 실행 가능한 설정입니다.</p>
                    )}
                    {dirty && <p className="text-[10.5px] cd-text-faint">※ 드라이런은 화면의 현재 매핑 기준입니다 — 실제 적용은 [연계 저장] 후.</p>}
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex items-center gap-2">
            <select className="cd-select flex-1 min-w-0" value={addKind} onChange={(e) => setAddKind(e.target.value)}>
              <option value="">추가할 연계(커넥터) 선택…</option>
              {catalog.map((c) => (
                <option key={c.kind} value={c.kind}>
                  {c.label} — {c.description}
                </option>
              ))}
            </select>
            <button type="button" className="cd-btn cd-btn-soft cd-btn-sm shrink-0" disabled={!addKind} onClick={addAction}>
              <Plus className="w-3.5 h-3.5" /> 연계 추가
            </button>
          </div>
        </>
      )}
    </div>
  );
}
