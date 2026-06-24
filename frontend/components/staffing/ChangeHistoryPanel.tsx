"use client";

import { useEffect, useMemo, useState } from "react";
import { History, Plus, Trash2 } from "lucide-react";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import type { OrganizationSnapshot } from "@/components/admin/users/types";

const CHANGE_KINDS = [
  { value: "join", label: "합류" },
  { value: "leave", label: "이탈" },
  { value: "role_change", label: "역할 변경" },
  { value: "replace", label: "교체" },
];
const kindLabel = (v: string) => CHANGE_KINDS.find((k) => k.value === v)?.label ?? v;
const ROLE_OPTIONS = ["관리자", "정", "부", "실무", "품질검토"];

interface ChangeRow {
  changeId: string;
  employeeName: string;
  changeKind: string;
  effectiveOn: string;
  roleLabelBefore: string | null;
  roleLabelAfter: string | null;
  replacedEmployeeName: string | null;
  reason: string | null;
}

export default function ChangeHistoryPanel({ contractId }: { contractId: string }) {
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [adding, setAdding] = useState(false);

  const [employeeId, setEmployeeId] = useState("");
  const [changeKind, setChangeKind] = useState("join");
  const [effectiveOn, setEffectiveOn] = useState("");
  const [roleAfter, setRoleAfter] = useState("실무");
  const [roleBefore, setRoleBefore] = useState("");
  const [replacedEmployeeId, setReplacedEmployeeId] = useState("");
  const [reason, setReason] = useState("");

  const reload = () => {
    fetch(`/api/contracts/${contractId}/participation-changes`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setChanges(d.changes ?? []))
      .catch(() => setChanges([]));
  };
  useEffect(reload, [contractId]);
  useEffect(() => {
    fetch("/api/organization", { cache: "no-store" })
      .then((r) => r.json())
      .then(setSnapshot)
      .catch(() => setSnapshot(null));
  }, []);

  const employees = useMemo(
    () => (snapshot?.employees ?? []).filter((e) => e.status === "active").sort((a, b) => a.name.localeCompare(b.name)),
    [snapshot]
  );

  const add = async () => {
    if (!employeeId || !effectiveOn) return;
    await fetch(`/api/contracts/${contractId}/participation-changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId,
        changeKind,
        effectiveOn,
        roleLabelBefore: changeKind === "role_change" ? roleBefore || null : null,
        roleLabelAfter: changeKind === "leave" ? null : roleAfter || null,
        replacedEmployeeId: changeKind === "replace" ? replacedEmployeeId || null : null,
        reason: reason || null,
      }),
    });
    setEmployeeId("");
    setEffectiveOn("");
    setReason("");
    setAdding(false);
    reload();
  };
  const remove = async (changeId: string) => {
    await fetch(`/api/staffing/participation-changes/${changeId}`, { method: "DELETE" });
    reload();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold cd-text flex items-center gap-2">
          <History className="w-4 h-4 cd-text-primary" /> 인력 변동 이력
          <span className="text-[11px] font-normal cd-text-faint">{changes.length}건</span>
        </h3>
        <button type="button" onClick={() => setAdding((v) => !v)} className="cd-btn cd-btn-ghost rounded-lg px-3 py-1.5 text-xs cd-text-muted inline-flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> 변동 등록
        </button>
      </div>

      {adding && (
        <div className="rounded-2xl border cd-border-c p-3 mb-3 grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <select className="cd-select text-sm" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">대상 인원</option>
              {employees.map((e) => (
                <option key={e.employeeId} value={e.employeeId}>{e.name}{e.positionName ? ` ${e.positionName}` : ""}</option>
              ))}
            </select>
            <select className="cd-select text-sm" value={changeKind} onChange={(e) => setChangeKind(e.target.value)}>
              {CHANGE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-xs cd-text-faint">발효일 <AutoDateInput className="cd-input text-sm flex-1" value={effectiveOn} onChange={setEffectiveOn} /></label>
            {changeKind !== "leave" && (
              <select className="cd-select text-sm" value={roleAfter} onChange={(e) => setRoleAfter(e.target.value)}>
                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{changeKind === "role_change" ? `변경 후: ${r}` : r}</option>)}
              </select>
            )}
          </div>
          {changeKind === "role_change" && (
            <select className="cd-select text-sm" value={roleBefore} onChange={(e) => setRoleBefore(e.target.value)}>
              <option value="">변경 전 역할</option>
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          {changeKind === "replace" && (
            <select className="cd-select text-sm" value={replacedEmployeeId} onChange={(e) => setReplacedEmployeeId(e.target.value)}>
              <option value="">교체 대상(기존 인원)</option>
              {employees.map((e) => <option key={e.employeeId} value={e.employeeId}>{e.name}{e.positionName ? ` ${e.positionName}` : ""}</option>)}
            </select>
          )}
          <input className="cd-input text-sm" placeholder="사유 (예: 담당업무 재조정, 퇴사)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end">
            <button type="button" onClick={add} className="rounded-lg px-3 py-1.5 text-xs text-white cd-fill-primary">등록</button>
          </div>
        </div>
      )}

      <div className="grid gap-2">
        {changes.length === 0 ? (
          <p className="text-sm cd-text-faint p-6 text-center">기록된 변동이 없습니다.</p>
        ) : (
          changes.map((c) => (
            <div key={c.changeId} className="rounded-xl border cd-border-c p-3 flex items-start gap-2">
              <span className="text-[11px] cd-text-faint font-mono shrink-0 mt-0.5 w-20">{c.effectiveOn}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] px-2 py-0.5 rounded-md cd-soft-primary font-semibold">{kindLabel(c.changeKind)}</span>
                  <span className="text-sm cd-text font-medium">{c.employeeName}</span>
                  {c.changeKind === "role_change" && (
                    <span className="text-xs cd-text-faint">{c.roleLabelBefore ?? "-"} → {c.roleLabelAfter ?? "-"}</span>
                  )}
                  {c.changeKind === "replace" && c.replacedEmployeeName && (
                    <span className="text-xs cd-text-faint">(기존: {c.replacedEmployeeName})</span>
                  )}
                  {(c.changeKind === "join") && c.roleLabelAfter && <span className="text-xs cd-text-faint">{c.roleLabelAfter}</span>}
                </div>
                {c.reason && <p className="text-xs cd-text-muted mt-1">{c.reason}</p>}
              </div>
              <button type="button" onClick={() => remove(c.changeId)} className="shrink-0 p-1 cd-text-faint hover:cd-error-text" title="삭제">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
