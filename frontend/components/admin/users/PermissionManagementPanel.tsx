"use client";

import { useMemo, useState } from "react";
import type React from "react";
import { KeyRound, Plus, Save, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DepartmentRow,
  PermissionsSnapshot,
  PermissionTemplateRow,
  UserRow,
} from "./types";

interface PermissionManagementPanelProps {
  users: UserRow[];
  permissions: PermissionsSnapshot | null;
  selectedDept: DepartmentRow | null;
  onReload: () => void;
  toast: (message: string, type?: "success" | "error") => void;
}

type ScopeKind = "self" | "self_dept" | "specific_dept" | "all";

const SCOPE_LABEL: Record<ScopeKind, string> = {
  self: "본인",
  self_dept: "소속 부서",
  specific_dept: "선택 부서",
  all: "전사",
};

export default function PermissionManagementPanel({
  users,
  permissions,
  selectedDept,
  onReload,
  toast,
}: PermissionManagementPanelProps) {
  const [templateName, setTemplateName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPermission, setSelectedPermission] = useState("");
  const [scopeKind, setScopeKind] = useState<ScopeKind>("self_dept");
  const [draftGrants, setDraftGrants] = useState<
    Array<{ permissionKey: string; scopeKind: ScopeKind; effect: "allow" | "deny" }>
  >([]);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignTemplateId, setAssignTemplateId] = useState("");
  const [saving, setSaving] = useState(false);

  const activeAssignments = useMemo(
    () => permissions?.assignments.filter((item) => !item.revokedAt) ?? [],
    [permissions]
  );

  const addGrant = () => {
    if (!selectedPermission) return;
    setDraftGrants((prev) => {
      if (prev.some((grant) => grant.permissionKey === selectedPermission && grant.scopeKind === scopeKind)) {
        return prev;
      }
      return [...prev, { permissionKey: selectedPermission, scopeKind, effect: "allow" }];
    });
  };

  const saveTemplate = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/permissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateName,
          description,
          grants: draftGrants.map((grant) => ({
            ...grant,
            scopeDeptId: grant.scopeKind === "specific_dept" ? selectedDept?.deptId ?? null : null,
          })),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "저장 실패");
      setTemplateName("");
      setDescription("");
      setDraftGrants([]);
      toast("권한 템플릿이 저장되었습니다.");
      onReload();
    } catch (err) {
      toast("실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const assignTemplate = async () => {
    if (!assignUserId || !assignTemplateId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/permissions/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: assignUserId,
          templateId: assignTemplateId,
          scopeOverrideKind: selectedDept ? "specific_dept" : null,
          scopeOverrideDeptId: selectedDept?.deptId ?? null,
          reason: selectedDept ? `${selectedDept.deptName} 기준 권한 부여` : "관리자 수동 부여",
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "권한 부여 실패");
      toast("계정에 권한 템플릿을 적용했습니다.");
      onReload();
    } catch (err) {
      toast("실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (assignmentId: string) => {
    setSaving(true);
    try {
      const res = await fetch(
        "/api/admin/permissions/assignments?assignmentId=" + encodeURIComponent(assignmentId),
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "취소 실패");
      toast("권한 적용을 취소했습니다.");
      onReload();
    } catch (err) {
      toast("실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const permissionLabel = (key: string) =>
    permissions?.permissions.find((item) => item.permissionKey === key)?.description ?? key;

  return (
    <div className="flex flex-col gap-5">
      <section className="glass-panel rounded-3xl p-6 reveal delay-1">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">Permission templates</p>
            <h2 className="text-2xl font-black text-stone-800">계정·권한 관리</h2>
            <p className="text-sm text-stone-500 mt-1">
              권한 템플릿을 만든 뒤 개별 계정에 부서 범위와 함께 적용합니다.
            </p>
          </div>
          <ShieldCheck className="w-7 h-7 text-primary" fill="currentColor" />
        </div>

        <div className="grid xl:grid-cols-[1.1fr_0.9fr] gap-4">
          <div className="rounded-2xl bg-white/55 border border-white/70 p-4">
            <h3 className="font-black text-stone-800 mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" /> 권한 템플릿 생성
            </h3>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="템플릿명">
                <input className="input-field" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="예: 통합환경 본부장" />
              </Field>
              <Field label="설명">
                <input className="input-field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="권한 목적" />
              </Field>
              <Field label="권한">
                <select className="ui-select" value={selectedPermission} onChange={(e) => setSelectedPermission(e.target.value)}>
                  <option value="">권한 선택</option>
                  {permissions?.permissions.map((permission) => (
                    <option key={permission.permissionKey} value={permission.permissionKey}>
                      {permission.description}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="범위">
                <div className="flex gap-2">
                  <select className="ui-select" value={scopeKind} onChange={(e) => setScopeKind(e.target.value as ScopeKind)}>
                    {Object.entries(SCOPE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="glass-button rounded-xl px-3 text-xs font-bold" onClick={addGrant}>
                    추가
                  </button>
                </div>
              </Field>
            </div>
            <div className="flex flex-wrap gap-2 mt-3 min-h-10">
              {draftGrants.map((grant) => (
                <button
                  type="button"
                  key={grant.permissionKey + grant.scopeKind}
                  onClick={() => setDraftGrants((prev) => prev.filter((item) => item !== grant))}
                  className="rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-bold flex items-center gap-1"
                >
                  {permissionLabel(grant.permissionKey)} · {SCOPE_LABEL[grant.scopeKind]}
                  <X className="w-3 h-3" />
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={saving || !templateName || draftGrants.length === 0}
              onClick={saveTemplate}
              className="mt-4 rounded-xl px-4 py-2 text-xs font-bold text-white bg-primary hover:bg-primary/90 disabled:opacity-40 flex items-center gap-2"
            >
              <Save className="w-4 h-4" /> 템플릿 저장
            </button>
          </div>

          <div className="rounded-2xl bg-white/55 border border-white/70 p-4">
            <h3 className="font-black text-stone-800 mb-3 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" /> 계정에 권한 부여
            </h3>
            <div className="space-y-3">
              <Field label="계정">
                <select className="ui-select" value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}>
                  <option value="">계정 선택</option>
                  {users.map((user) => (
                    <option key={user.userId} value={user.userId}>
                      {user.name} · {user.email}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="권한 템플릿">
                <select className="ui-select" value={assignTemplateId} onChange={(e) => setAssignTemplateId(e.target.value)}>
                  <option value="">템플릿 선택</option>
                  {permissions?.templates.filter((template) => template.isActive).map((template) => (
                    <option key={template.templateId} value={template.templateId}>
                      {template.templateName}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="rounded-xl bg-stone-50 border border-stone-100 p-3 text-xs text-stone-500">
                {selectedDept ? `현재 선택 부서(${selectedDept.deptName}) 범위로 적용됩니다.` : "부서를 선택하지 않으면 템플릿 기본 범위로 적용됩니다."}
              </div>
              <button
                type="button"
                disabled={saving || !assignUserId || !assignTemplateId}
                onClick={assignTemplate}
                className="rounded-xl px-4 py-2 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 disabled:opacity-40"
              >
                권한 적용
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="glass-panel rounded-3xl p-6 reveal delay-2">
        <h3 className="font-black text-stone-800 mb-3">권한 템플릿 목록</h3>
        <div className="grid xl:grid-cols-3 gap-3">
          {permissions?.templates.map((template) => (
            <TemplateCard key={template.templateId} template={template} permissionLabel={permissionLabel} />
          ))}
        </div>
      </section>

      <section className="glass-panel rounded-3xl p-6 reveal delay-3">
        <h3 className="font-black text-stone-800 mb-3">계정별 권한 적용 현황</h3>
        <div className="flex flex-col gap-2">
          {activeAssignments.map((assignment) => (
            <div key={assignment.assignmentId} className="grid md:grid-cols-[1.2fr_1fr_1fr_auto] gap-3 items-center rounded-xl bg-white/50 border border-white/70 p-3">
              <div>
                <div className="text-sm font-black text-stone-800">{assignment.userName}</div>
                <div className="text-xs text-stone-500">{assignment.userEmail}</div>
              </div>
              <div className="text-sm font-bold text-primary">{assignment.templateName}</div>
              <div className="text-xs text-stone-500">
                {assignment.scopeOverrideKind ? SCOPE_LABEL[assignment.scopeOverrideKind] : "템플릿 기본"} · {assignment.effectiveFrom}
              </div>
              <button type="button" onClick={() => revoke(assignment.assignmentId)} className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-red-600">
                취소
              </button>
            </div>
          ))}
          {activeAssignments.length === 0 && <div className="text-sm text-stone-400 py-8 text-center">적용된 권한 템플릿이 없습니다.</div>}
        </div>
      </section>
    </div>
  );
}

function TemplateCard({
  template,
  permissionLabel,
}: {
  template: PermissionTemplateRow;
  permissionLabel: (key: string) => string;
}) {
  return (
    <div className={cn("rounded-2xl border p-4 bg-white/55", template.isActive ? "border-white/70" : "border-stone-200 opacity-60")}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4 className="font-black text-stone-800">{template.templateName}</h4>
        {template.isSystem && <span className="rounded-full bg-stone-900 text-white text-[10px] px-2 py-0.5 font-bold">SYSTEM</span>}
      </div>
      <p className="text-xs text-stone-500 min-h-8">{template.description || "설명 없음"}</p>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {template.grants.map((grant) => (
          <span key={grant.grantId} className="rounded-full bg-primary/10 text-primary px-2 py-1 text-[10px] font-bold">
            {permissionLabel(grant.permissionKey)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase text-stone-500">{label}</span>
      {children}
    </label>
  );
}
