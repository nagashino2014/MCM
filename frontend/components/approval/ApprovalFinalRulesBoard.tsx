"use client";

// 전결 규정(DA-3, 결재 운영) — 양식별로 [전결] 버튼을 쓸 수 있는 사람(지정 인원·기안 부서장)을 관리한다(D-3).
// 전결 = 승인 단계 결재자가 이후 결재자를 생략하고 최종 승인. 부재 설정은 전결을 일으키지 않는다(D-2).
// 설계: docs/e-approval-delegation-blueprint.md §3·§6-5.

import { useEffect, useState } from "react";
import { Gavel, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton } from "@/components/cdash/CdButton";
import { CdSelect } from "@/components/cdash/CdField";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";
import "@/components/cdash/cdash.css";

interface FinalRule {
  ruleId: string;
  formId: string;
  formName: string | null;
  userId: string | null;
  userName: string | null;
  deptHead: boolean;
}

interface FormRow {
  formId: string;
  name: string;
}

export function ApprovalFinalRulesBoard() {
  const { theme } = useCdashTheme();
  const [rules, setRules] = useState<FinalRule[]>([]);
  const [forms, setForms] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formId, setFormId] = useState("*");
  const [target, setTarget] = useState<"user" | "deptHead">("user");
  const [person, setPerson] = useState<{ userId: string; name: string } | null>(null);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/approval/final-rules", { cache: "no-store" }).then((r) => r.json().then((d) => ({ ok: r.ok, d }))),
      fetch("/api/approval/forms", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([rulesRes, formsRes]) => {
        if (!rulesRes.ok) throw new Error(rulesRes.d?.error ?? "불러오지 못했습니다.");
        setRules(rulesRes.d.rules ?? []);
        setForms(((formsRes?.forms ?? []) as FormRow[]).map((f) => ({ formId: f.formId, name: f.name })));
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const formError = target === "user" && !person ? "전결할 수 있는 사람을 선택하세요." : null;

  const add = async () => {
    if (formError) return;
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/approval/final-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId, userId: target === "user" ? person?.userId ?? null : null, deptHead: target === "deptHead" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "추가하지 못했습니다.");
      setRules(data.rules ?? []);
      setMsg("전결 규정을 추가했습니다.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: FinalRule) => {
    if (!confirm(`'${r.formName ?? "전 양식"} · ${r.deptHead ? "기안 부서장" : r.userName ?? r.userId}' 전결 규정을 삭제할까요?`)) return;
    setMsg(null);
    setError(null);
    try {
      const res = await fetch(`/api/approval/final-rules?ruleId=${encodeURIComponent(r.ruleId)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "삭제하지 못했습니다.");
      setRules(data.rules ?? []);
      setMsg("전결 규정을 삭제했습니다.");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl overflow-y-auto" data-theme={theme}>
      <CdPageHeader
        icon={<Gavel className="w-5 h-5" />}
        eyebrow="Approval · Final rules"
        title="전결 규정"
        help="전결은 승인 단계의 결재자가 뒤에 남은 결재자를 생략하고 최종 승인하는 것입니다. 여기에 등록된 사람만 결재 화면에서 [전결] 버튼을 볼 수 있습니다. 규정이 하나도 없으면 아무도 전결할 수 없습니다. 대결로 받은 결재와 합의 단계에서는 전결할 수 없고, 결재자 부재는 전결을 일으키지 않습니다."
      />

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        <h2 className="text-[14px] font-semibold cd-text">규정 추가</h2>
        <div className="max-w-md">
          <CdSelect label="양식" value={formId} onChange={(e) => setFormId(e.target.value)}>
            <option value="*">전 양식</option>
            {forms.map((f) => (
              <option key={f.formId} value={f.formId}>
                {f.name}
              </option>
            ))}
          </CdSelect>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[12px] font-semibold cd-text mb-1">전결할 수 있는 사람</legend>
          <label className="flex items-center gap-2 text-[12.5px] cd-text">
            <input type="radio" name="final-target" checked={target === "user"} onChange={() => setTarget("user")} />
            지정 인원
            {target === "user" && (
              <>
                <span className="cd-text">{person ? person.name : <span className="cd-text-faint">미지정</span>}</span>
                <CdButton size="sm" onClick={() => setPicker(true)}>
                  {person ? "변경" : "조직도에서 선택"}
                </CdButton>
              </>
            )}
          </label>
          <label className="flex items-center gap-2 text-[12.5px] cd-text">
            <input type="radio" name="final-target" checked={target === "deptHead"} onChange={() => setTarget("deptHead")} />
            기안 부서장 — 문서를 기안한 부서의 부서장
          </label>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <CdButton variant="primary" disabled={!!formError || saving} onClick={add}>
            {saving ? "추가 중..." : "규정 추가"}
          </CdButton>
          {formError && target === "user" && <span className="text-[12px] cd-text-faint">{formError}</span>}
        </div>
        {msg && <p className="text-[12px] cd-text">{msg}</p>}
        {error && (
          <p className="text-[12px]" style={{ color: "var(--cd-error)" }}>
            {error}
          </p>
        )}
      </div>

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold cd-text">등록된 전결 규정</h2>
        {loading ? (
          <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
        ) : rules.length === 0 ? (
          <p className="text-[12.5px] cd-text-faint">등록된 규정이 없습니다 — 지금은 아무도 전결할 수 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="cd-table-head">
                <tr className="text-left cd-text-faint text-[11px]">
                  <th className="py-1.5 pr-3 font-semibold">양식</th>
                  <th className="py-1.5 pr-3 font-semibold">전결할 수 있는 사람</th>
                  <th className="py-1.5 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.ruleId} className="border-t cd-border-c">
                    <td className="py-2 pr-3 cd-text">{r.formName ?? "전 양식"}</td>
                    <td className="py-2 pr-3 cd-text">{r.deptHead ? "기안 부서장" : r.userName ?? r.userId}</td>
                    <td className="py-2 text-right">
                      <CdButton size="sm" variant="ghost" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => remove(r)}>
                        삭제
                      </CdButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <OrgPickerModal
        open={picker}
        title="전결 권한자 선택 — 조직도에서 선택"
        hint="인원을 클릭하면 전결할 수 있는 사람으로 지정됩니다."
        onClose={() => setPicker(false)}
        onSelect={(emp) => {
          if (!emp.userId) {
            alert(`${emp.name} 님은 아직 계정이 연결되지 않아 지정할 수 없습니다.`);
            return;
          }
          setPerson({ userId: emp.userId, name: emp.name });
          setPicker(false);
        }}
      />
    </div>
  );
}
