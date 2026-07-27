"use client";

// 결재 사전검토 정책(AX-P3, admin) — 양식별 규칙(금액 상한·연차 잔여·초과근무·필수 필드) 편집.
// 기본 severity=warn(경고), 항목별 block(차단) 승격 가능(§8-3). 설계: §9-4.

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Plus, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";

interface FormRow {
  formId: string;
  name: string;
}
interface FieldRow {
  key: string;
  label: string;
  type: string;
}
interface Policy {
  fieldKey: string | null;
  kind: string;
  config: Record<string, unknown>;
  severity: string;
}

const KIND_OPTIONS = [
  ["amount_limit", "금액 상한"],
  ["leave_balance", "연차 잔여 초과"],
  ["required_field", "필수 필드"],
  ["overtime_limit", "초과근무 한도(P4 연동)"],
  ["self_approval", "본인 결재 경고"],
] as const;

const NEEDS_FIELD = new Set(["amount_limit", "required_field"]);

export function ApprovalPolicyBoard() {
  const { theme } = useCdashTheme();
  const [forms, setForms] = useState<FormRow[]>([]);
  const [formId, setFormId] = useState("");
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/approval/forms", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = (d?.forms ?? []) as FormRow[];
        setForms(list);
        if (list.length && !formId) setFormId(list[0].formId);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadForm = useCallback(async (fid: string) => {
    setMsg(null);
    try {
      const [fRes, pRes] = await Promise.all([
        fetch(`/api/approval/forms/${encodeURIComponent(fid)}`, { cache: "no-store" }),
        fetch(`/api/approval/form-policies?formId=${encodeURIComponent(fid)}`, { cache: "no-store" }),
      ]);
      const fData = await fRes.json();
      const pData = await pRes.json();
      setFields(fRes.ok ? (fData.form?.fields ?? []).map((f: FieldRow) => ({ key: f.key, label: f.label, type: f.type })) : []);
      setPolicies(pRes.ok ? (pData.policies ?? []) : []);
    } catch {
      setFields([]);
      setPolicies([]);
    }
  }, []);

  useEffect(() => {
    if (formId) loadForm(formId);
  }, [formId, loadForm]);

  const addPolicy = () => setPolicies((prev) => [...prev, { fieldKey: null, kind: "amount_limit", config: {}, severity: "warn" }]);
  const update = (i: number, patch: Partial<Policy>) => setPolicies((prev) => prev.map((p, pi) => (pi === i ? { ...p, ...patch } : p)));
  const remove = (i: number) => setPolicies((prev) => prev.filter((_, pi) => pi !== i));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/approval/form-policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId, policies }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      setPolicies(data.policies ?? policies);
      setMsg("저장되었습니다.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const numFields = fields.filter((f) => f.type === "currency" || f.type === "number");

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<ShieldCheck className="w-5 h-5" />}
        eyebrow="Approval · Precheck"
        title="사전검토 정책"
        subtitle="양식별로 상신 전 검사 규칙을 설정합니다. 기본은 경고이며, 항목별로 차단으로 승격할 수 있습니다."
        actions={
          <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50" disabled={saving || !formId} onClick={save}>
            {saving ? "저장 중..." : "저장"}
          </button>
        }
      />

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[11px] cd-text-faint flex items-center gap-1.5">
            양식
            <select className="cd-select" value={formId} onChange={(e) => setFormId(e.target.value)} style={{ minWidth: 200 }}>
              {forms.map((f) => (
                <option key={f.formId} value={f.formId}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="ml-auto cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-xs flex items-center gap-1.5" onClick={addPolicy}>
            <Plus className="w-3.5 h-3.5" /> 규칙 추가
          </button>
        </div>

        {policies.length === 0 ? (
          <p className="text-sm cd-text-faint">설정된 규칙이 없습니다. '규칙 추가'로 시작하세요.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {policies.map((p, i) => (
              <div key={i} className="rounded-xl border cd-border-c p-3 flex flex-wrap items-center gap-2">
                <select className="cd-select" style={{ width: 180 }} value={p.kind} onChange={(e) => update(i, { kind: e.target.value, fieldKey: NEEDS_FIELD.has(e.target.value) ? p.fieldKey : null })}>
                  {KIND_OPTIONS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>

                {NEEDS_FIELD.has(p.kind) && (
                  <select className="cd-select" style={{ width: 160 }} value={p.fieldKey ?? ""} onChange={(e) => update(i, { fieldKey: e.target.value || null })}>
                    <option value="">필드 선택</option>
                    {(p.kind === "amount_limit" ? numFields : fields).map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                )}

                {p.kind === "amount_limit" && (
                  <label className="text-[11px] cd-text-faint flex items-center gap-1">
                    상한
                    <input
                      type="number"
                      className="cd-input"
                      style={{ width: 130 }}
                      value={Number(p.config.max ?? 0) || ""}
                      onChange={(e) => update(i, { config: { ...p.config, max: Number(e.target.value) || 0 } })}
                    />
                  </label>
                )}
                {p.kind === "required_field" && (
                  <input
                    className="cd-input flex-1"
                    style={{ minWidth: 160 }}
                    placeholder="안내 문구(선택)"
                    value={String(p.config.message ?? "")}
                    onChange={(e) => update(i, { config: { ...p.config, message: e.target.value } })}
                  />
                )}

                <label className="text-[11px] cd-text-faint flex items-center gap-1 ml-auto">
                  수준
                  <select className="cd-select" style={{ width: 90 }} value={p.severity} onChange={(e) => update(i, { severity: e.target.value })}>
                    <option value="warn">경고</option>
                    <option value="block">차단</option>
                  </select>
                </label>
                <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => remove(i)} title="삭제">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        {msg && <p className="text-[12px] cd-text-faint">{msg}</p>}
        <p className="text-[10.5px] cd-text-faint">
          연차 잔여·본인 결재 규칙은 정책이 없어도 기본 경고로 동작합니다. 여기서 등록하면 수준(경고/차단)을 지정할 수 있습니다. 초과근무 한도는 근태 연동(AX-P4) 후 값이 평가됩니다.
        </p>
      </div>
    </div>
  );
}
