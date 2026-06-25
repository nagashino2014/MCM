"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { createPortal } from "react-dom";
import {
  Building2,
  BriefcaseBusiness,
  ChevronDown,
  ClipboardCheck,
  Crown,
  KeyRound,
  MoreVertical,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  TrendingUp,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import type {
  DepartmentRow,
  PermissionsSnapshot,
  PermissionTemplateRow,
  SelectedAccount,
  UserRow,
} from "./types";

interface PermissionManagementPanelProps {
  users: UserRow[];
  permissions: PermissionsSnapshot | null;
  selectedDept: DepartmentRow | null;
  selectedAccount: SelectedAccount | null;
  currentUserId?: string;
  onReload: () => void;
  onUpdateAccount: (
    user: UserRow,
    patch: Partial<Pick<UserRow, "role" | "status" | "name">>
  ) => void;
  onDeleteAccount: (user: UserRow) => void;
  toast: (message: string, type?: "success" | "error") => void;
}

type ScopeKind = "self" | "self_dept" | "specific_dept" | "all";

const SCOPE_LABEL: Record<ScopeKind, string> = {
  self: "본인",
  self_dept: "소속 부서",
  specific_dept: "선택 부서",
  all: "전사",
};

const ROLE_LABEL: Record<UserRow["role"], string> = {
  admin: "관리자",
  editor: "편집자",
  viewer: "조회자",
};

/** 세부 권한 펼침 시 표시할 scope 라벨(participant 포함). */
function scopeLabel(kind: string): string {
  if (kind === "participant") return "참여 용역";
  return SCOPE_LABEL[kind as ScopeKind] ?? kind;
}

type TemplateVisual = { icon: typeof ShieldCheck; color: string };

/** 시스템 템플릿별 아이콘·강조색(파스텔 배경은 색 + 알파). 미매핑은 기본값. */
const TEMPLATE_VISUALS: Record<string, TemplateVisual> = {
  "tpl-exec": { icon: Crown, color: "#5D87FF" },
  "tpl-staff-basic": { icon: UserRound, color: "#13DEB9" },
  "tpl-hr": { icon: Building2, color: "#7C5CFC" },
  "tpl-dept-lead": { icon: BriefcaseBusiness, color: "#FA896B" },
  "tpl-data-review": { icon: ClipboardCheck, color: "#539BFF" },
  "tpl-admin-rbac": { icon: ShieldCheck, color: "#FA5252" },
  "tpl-sales": { icon: TrendingUp, color: "#FFAE1F" },
};
const DEFAULT_VISUAL: TemplateVisual = { icon: ShieldCheck, color: "#5D87FF" };

/** hex 색에 알파를 붙여 파스텔 배경을 만든다. */
function tint(color: string): string {
  return color.startsWith("#") ? color + "22" : color;
}

export default function PermissionManagementPanel({
  users,
  permissions,
  selectedDept,
  selectedAccount,
  currentUserId,
  onReload,
  onUpdateAccount,
  onDeleteAccount,
  toast,
}: PermissionManagementPanelProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PermissionTemplateRow | null>(null);

  const permissionLabel = (key: string) =>
    permissions?.permissions.find((item) => item.permissionKey === key)?.description ?? key;

  const openCreate = () => {
    setEditingTemplate(null);
    setCreateOpen(true);
  };
  const openEdit = (template: PermissionTemplateRow) => {
    setEditingTemplate(template);
    setCreateOpen(true);
  };

  return (
    <div className="flex flex-col gap-5">
      <TemplateListCard
        permissions={permissions}
        permissionLabel={permissionLabel}
        onCreate={openCreate}
        onEdit={openEdit}
      />

      {selectedAccount ? (
        <AccountDetailPanel
          users={users}
          permissions={permissions}
          selectedAccount={selectedAccount}
          selectedDept={selectedDept}
          currentUserId={currentUserId}
          onReload={onReload}
          onUpdateAccount={onUpdateAccount}
          onDeleteAccount={onDeleteAccount}
          toast={toast}
        />
      ) : (
        <GlobalAssignmentsCard permissions={permissions} />
      )}

      {createOpen && (
        <CreateTemplateModal
          permissions={permissions}
          selectedDept={selectedDept}
          editing={editingTemplate}
          permissionLabel={permissionLabel}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            onReload();
          }}
          toast={toast}
        />
      )}
    </div>
  );
}

/* ── 권한 템플릿 목록 ─────────────────────────────────────────────── */

function TemplateListCard({
  permissions,
  permissionLabel,
  onCreate,
  onEdit,
}: {
  permissions: PermissionsSnapshot | null;
  permissionLabel: (key: string) => string;
  onCreate: () => void;
  onEdit: (template: PermissionTemplateRow) => void;
}) {
  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState<"all" | "system" | "custom">("all");

  const templates = permissions?.templates ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((template) => {
      if (filterKind === "system" && !template.isSystem) return false;
      if (filterKind === "custom" && template.isSystem) return false;
      if (q && !template.templateName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [templates, search, filterKind]);

  return (
    <section className="cd-card p-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-start gap-3">
          <span className="cd-title-icon mt-0.5">
            <ShieldCheck className="w-4 h-4" />
          </span>
          <div>
            <h2 className="text-xl font-extrabold cd-text">권한 템플릿 목록</h2>
            <p className="text-sm cd-text-muted mt-1">계정 유형별 권한 템플릿을 관리하고 빠르게 적용할 수 있습니다.</p>
          </div>
        </div>
        <button type="button" onClick={onCreate} className="cd-btn cd-btn-primary cd-btn-sm shrink-0">
          <Plus className="w-4 h-4" /> 템플릿 생성
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 cd-text-faint absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className="cd-input pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="템플릿명으로 검색"
          />
        </div>
        <select className="cd-select w-auto" value={filterKind} onChange={(e) => setFilterKind(e.target.value as typeof filterKind)}>
          <option value="all">전체 템플릿</option>
          <option value="system">시스템</option>
          <option value="custom">사용자 정의</option>
        </select>
        <span className="text-xs cd-text-muted ml-auto">
          총 <b className="cd-text">{filtered.length}</b>개 템플릿
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-sm cd-text-faint py-10 text-center">표시할 템플릿이 없습니다.</div>
      ) : (
        <div className="grid xl:grid-cols-3 gap-4 items-stretch">
          {filtered.map((template) => (
            <TemplateCard key={template.templateId} template={template} permissionLabel={permissionLabel} onEdit={onEdit} />
          ))}
        </div>
      )}
    </section>
  );
}

function TemplateCard({
  template,
  permissionLabel,
  onEdit,
}: {
  template: PermissionTemplateRow;
  permissionLabel: (key: string) => string;
  onEdit: (template: PermissionTemplateRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visual = TEMPLATE_VISUALS[template.templateId] ?? DEFAULT_VISUAL;
  const Icon = visual.icon;
  const total = template.grants.length;
  const shown = template.grants.slice(0, 3);
  const extra = total - shown.length;

  return (
    <div className={cn("rounded-2xl border cd-border-c p-5 cd-surface-bg flex flex-col min-h-[208px]", !template.isActive && "opacity-60")}>
      <div className="flex items-start gap-3">
        <span
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: tint(visual.color), color: visual.color }}
        >
          <Icon className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <h4 className="font-bold cd-text truncate">{template.templateName}</h4>
          {template.isSystem && <span className="cd-pill cd-pill-idle shrink-0">SYSTEM</span>}
        </div>
        <button
          type="button"
          onClick={() => onEdit(template)}
          className="p-1 rounded-lg cd-text-faint hover:text-[color:var(--cd-text)] shrink-0"
          title="템플릿 수정"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs cd-text-muted mt-2 line-clamp-2 min-h-[2.5rem]">{template.description || "설명 없음"}</p>

      <div className="flex flex-nowrap items-center gap-1.5 mt-3 overflow-hidden min-h-[1.75rem]">
        {shown.map((grant) => (
          <span key={grant.grantId} className="cd-pill cd-pill-info whitespace-nowrap shrink-0">
            {permissionLabel(grant.permissionKey)}
          </span>
        ))}
        {extra > 0 && <span className="cd-pill cd-pill-idle shrink-0">+{extra}</span>}
      </div>

      {expanded && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {template.grants.map((grant) => (
            <span key={grant.grantId} className="cd-pill cd-pill-info">
              {permissionLabel(grant.permissionKey)} · {scopeLabel(grant.scopeKind)}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto pt-3 flex items-center justify-between border-t cd-border-c">
        <span className="text-xs cd-text-faint">권한 {total}개</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-semibold cd-text-primary flex items-center gap-1"
        >
          세부 권한 보기
          <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
      </div>
    </div>
  );
}

/* ── 권한 템플릿 생성/수정 모달 ───────────────────────────────────── */

function CreateTemplateModal({
  permissions,
  selectedDept,
  editing,
  permissionLabel,
  onClose,
  onSaved,
  toast,
}: {
  permissions: PermissionsSnapshot | null;
  selectedDept: DepartmentRow | null;
  editing: PermissionTemplateRow | null;
  permissionLabel: (key: string) => string;
  onClose: () => void;
  onSaved: () => void;
  toast: (message: string, type?: "success" | "error") => void;
}) {
  const { theme } = useCdashTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [templateName, setTemplateName] = useState(editing?.templateName ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [selectedPermission, setSelectedPermission] = useState("");
  const [scopeKind, setScopeKind] = useState<ScopeKind>("self_dept");
  const [draftGrants, setDraftGrants] = useState<Array<{ permissionKey: string; scopeKind: ScopeKind; effect: "allow" | "deny" }>>(
    () => (editing?.grants ?? []).map((g) => ({ permissionKey: g.permissionKey, scopeKind: (g.scopeKind as ScopeKind) ?? "self", effect: g.effect }))
  );
  const [saving, setSaving] = useState(false);

  const addGrant = () => {
    if (!selectedPermission) return;
    setDraftGrants((prev) => {
      if (prev.some((grant) => grant.permissionKey === selectedPermission && grant.scopeKind === scopeKind)) return prev;
      return [...prev, { permissionKey: selectedPermission, scopeKind, effect: "allow" }];
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/permissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateId: editing?.templateId,
          templateName,
          description,
          isActive,
          grants: draftGrants.map((grant) => ({
            ...grant,
            scopeDeptId: grant.scopeKind === "specific_dept" ? selectedDept?.deptId ?? null : null,
          })),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "저장 실패");
      toast(editing ? "권한 템플릿이 수정되었습니다." : "권한 템플릿이 저장되었습니다.");
      onSaved();
    } catch (err) {
      toast("실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="cdash-vars cd-fields-white fixed inset-0 z-[9999]" data-theme={theme}>
      <button type="button" aria-label="닫기" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="cd-modal absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(40rem,calc(100vw-2rem))] max-h-[calc(100vh-4rem)] overflow-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-extrabold cd-text flex items-center gap-2">
            <Plus className="w-4 h-4 text-[color:var(--cd-primary)]" /> {editing ? "권한 템플릿 수정" : "권한 템플릿 생성"}
          </h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg cd-text-faint hover:text-[color:var(--cd-text)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <Field label="템플릿명">
            <input className="cd-input" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="예: 통합환경 본부장" />
          </Field>
          <Field label="설명">
            <input className="cd-input" value={description ?? ""} onChange={(e) => setDescription(e.target.value)} placeholder="권한 목적" />
          </Field>
          <Field label="권한">
            <select className="cd-select" value={selectedPermission} onChange={(e) => setSelectedPermission(e.target.value)}>
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
              <select className="cd-select" value={scopeKind} onChange={(e) => setScopeKind(e.target.value as ScopeKind)}>
                {Object.entries(SCOPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={addGrant}>
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
              className="cd-pill cd-pill-info"
            >
              {permissionLabel(grant.permissionKey)} · {scopeLabel(grant.scopeKind)}
              <X className="w-3 h-3" />
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between mt-4">
          {editing ? (
            <label className="flex items-center gap-2 text-sm cd-text-muted">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              활성 상태
            </label>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost">
              취소
            </button>
            <button type="button" disabled={saving || !templateName || draftGrants.length === 0} onClick={save} className="cd-btn cd-btn-primary">
              <Save className="w-4 h-4" /> {editing ? "변경 저장" : "템플릿 저장"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── 계정 상세 패널(조직도 계정 클릭) ─────────────────────────────── */

function AccountDetailPanel({
  users,
  permissions,
  selectedAccount,
  selectedDept,
  currentUserId,
  onReload,
  onUpdateAccount,
  onDeleteAccount,
  toast,
}: {
  users: UserRow[];
  permissions: PermissionsSnapshot | null;
  selectedAccount: SelectedAccount;
  selectedDept: DepartmentRow | null;
  currentUserId?: string;
  onReload: () => void;
  onUpdateAccount: (user: UserRow, patch: Partial<Pick<UserRow, "role" | "status" | "name">>) => void;
  onDeleteAccount: (user: UserRow) => void;
  toast: (message: string, type?: "success" | "error") => void;
}) {
  const [assignSelected, setAssignSelected] = useState<Set<string>>(() => new Set());
  const [assignScope, setAssignScope] = useState<ScopeKind | "default">("default");
  const [saving, setSaving] = useState(false);

  // 계정 변경 시 부여 선택 초기화
  useEffect(() => {
    setAssignSelected(new Set());
    setAssignScope("default");
  }, [selectedAccount.userId]);

  const user = useMemo(
    () => users.find((u) => u.userId === selectedAccount.userId) ?? null,
    [users, selectedAccount.userId]
  );

  const accountAssignments = useMemo(
    () =>
      (permissions?.assignments ?? []).filter(
        (a) => !a.revokedAt && a.userId === selectedAccount.userId
      ),
    [permissions, selectedAccount.userId]
  );
  const assignedTemplateIds = useMemo(
    () => new Set(accountAssignments.map((a) => a.templateId)),
    [accountAssignments]
  );

  const isSelf = currentUserId === selectedAccount.userId;
  const activeTemplates = (permissions?.templates ?? []).filter((t) => t.isActive);

  if (!selectedAccount.userId) {
    return (
      <section className="cd-card p-6">
        <SectionHeader title={selectedAccount.name} subtitle="계정 미발급 인원" />
        <div className="rounded-2xl cd-surface-bg border cd-border-c p-6 text-sm cd-text-muted text-center">
          이 인원은 <b className="cd-text">계정 미발급</b> 상태입니다.
          <br />
          <b className="cd-text">사용자 등록·삭제</b> 화면의 조직도에서 계정을 발급한 뒤 권한을 부여할 수 있습니다.
        </div>
      </section>
    );
  }

  const toggleAssign = (templateId: string) => {
    setAssignSelected((prev) => {
      const next = new Set(prev);
      if (next.has(templateId)) next.delete(templateId);
      else next.add(templateId);
      return next;
    });
  };

  const applyAssignments = async () => {
    const ids = [...assignSelected].filter((id) => !assignedTemplateIds.has(id));
    if (ids.length === 0) return;
    setSaving(true);
    try {
      for (const templateId of ids) {
        const res = await fetch("/api/admin/permissions/assignments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId: selectedAccount.userId,
            templateId,
            scopeOverrideKind: assignScope === "default" ? null : assignScope,
            scopeOverrideDeptId: assignScope === "specific_dept" ? selectedDept?.deptId ?? null : null,
            reason: "관리자 권한 부여",
          }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "권한 부여 실패");
      }
      setAssignSelected(new Set());
      toast(`권한 템플릿 ${ids.length}건을 적용했습니다.`);
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
      const res = await fetch("/api/admin/permissions/assignments?assignmentId=" + encodeURIComponent(assignmentId), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "취소 실패");
      toast("권한 적용을 취소했습니다.");
      onReload();
    } catch (err) {
      toast("실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="cd-card p-6 flex flex-col gap-5">
      {/* 계정 헤더 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="cd-title-icon mt-0.5">
            <KeyRound className="w-4 h-4" />
          </span>
          <div>
            <h2 className="text-xl font-extrabold cd-text">
              {selectedAccount.name}
              {isSelf && <span className="ml-2 text-[10px] cd-text-primary align-middle">YOU</span>}
            </h2>
            <p className="text-sm cd-text-muted mt-0.5">{selectedAccount.loginId ?? selectedAccount.email ?? "—"}</p>
          </div>
        </div>
        {user && (
          <div className="flex items-center gap-2">
            <select
              className="cd-select text-xs w-auto"
              value={user.role}
              disabled={isSelf}
              onChange={(e) => onUpdateAccount(user, { role: e.target.value as UserRow["role"] })}
            >
              {Object.entries(ROLE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={isSelf}
              onClick={() => onUpdateAccount(user, { status: user.status === "active" ? "disabled" : "active" })}
              className={cn("cd-pill justify-center", user.status === "active" ? "cd-pill-info" : "cd-pill-idle", isSelf && "opacity-50")}
            >
              {user.status === "active" ? "활성" : "비활성"}
            </button>
            <button
              type="button"
              disabled={isSelf}
              onClick={() => onDeleteAccount(user)}
              className={cn("p-2 rounded-lg cd-text-faint transition-colors hover:text-[color:var(--cd-error)]", isSelf && "opacity-40")}
              title="계정 삭제"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* 부여된 권한 템플릿 현황 */}
      <div className="rounded-2xl cd-surface-bg border cd-border-c p-4">
        <h3 className="font-bold cd-text mb-3">부여된 권한 템플릿 ({accountAssignments.length})</h3>
        {accountAssignments.length === 0 ? (
          <div className="text-sm cd-text-faint py-6 text-center">부여된 권한 템플릿이 없습니다.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {accountAssignments.map((assignment) => (
              <div key={assignment.assignmentId} className="grid grid-cols-[1.2fr_1fr_auto] gap-3 items-center rounded-xl cd-card-bg border cd-border-c p-3">
                <div className="text-sm font-bold cd-text-primary truncate">{assignment.templateName}</div>
                <div className="text-xs cd-text-muted truncate">
                  {assignment.scopeOverrideKind ? scopeLabel(assignment.scopeOverrideKind) : "템플릿 기본"} · {assignment.effectiveFrom}
                </div>
                <button type="button" disabled={saving} onClick={() => revoke(assignment.assignmentId)} className="cd-btn cd-btn-danger cd-btn-sm">
                  취소
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 권한 부여(복수 선택) */}
      <div className="rounded-2xl cd-surface-bg border cd-border-c p-4">
        <h3 className="font-bold cd-text mb-1 flex items-center gap-2">
          <Plus className="w-4 h-4 text-[color:var(--cd-primary)]" /> 권한 부여
        </h3>
        <p className="text-xs cd-text-muted mb-3">여러 템플릿을 함께 선택해 적용할 수 있습니다. 이미 부여된 템플릿은 자동 제외됩니다.</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {activeTemplates.map((template) => {
            const already = assignedTemplateIds.has(template.templateId);
            const picked = assignSelected.has(template.templateId);
            return (
              <button
                type="button"
                key={template.templateId}
                disabled={already}
                onClick={() => toggleAssign(template.templateId)}
                className={cn(
                  "cd-pill",
                  already ? "cd-pill-idle opacity-60 cursor-not-allowed" : picked ? "cd-fill-primary" : "cd-pill-info"
                )}
              >
                {template.templateName}
                {already && " ✓"}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="cd-label !mb-0">범위</span>
            <select className="cd-select w-auto" value={assignScope} onChange={(e) => setAssignScope(e.target.value as ScopeKind | "default")}>
              <option value="default">템플릿 기본</option>
              {Object.entries(SCOPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {assignScope === "specific_dept" && (
            <span className="text-xs cd-text-muted pb-2">
              {selectedDept ? `${selectedDept.deptName} 기준` : "좌측에서 부서를 선택하세요"}
            </span>
          )}
          <button
            type="button"
            disabled={saving || assignSelected.size === 0}
            onClick={applyAssignments}
            className="cd-btn cd-btn-primary ml-auto"
          >
            권한 적용 ({assignSelected.size})
          </button>
        </div>
      </div>
    </section>
  );
}

/* ── 미선택 시: 전체 권한 적용 현황 ──────────────────────────────── */

function GlobalAssignmentsCard({ permissions }: { permissions: PermissionsSnapshot | null }) {
  const activeAssignments = useMemo(
    () => permissions?.assignments.filter((item) => !item.revokedAt) ?? [],
    [permissions]
  );
  return (
    <section className="cd-card p-6">
      <h3 className="font-extrabold cd-text mb-1">계정별 권한 적용 현황</h3>
      <p className="text-sm cd-text-muted mb-4">조직도에서 계정을 선택하면 해당 계정의 권한 현황과 부여 메뉴가 표시됩니다.</p>
      <div className="flex flex-col gap-2">
        {activeAssignments.map((assignment) => (
          <div key={assignment.assignmentId} className="grid md:grid-cols-[1.2fr_1fr_1fr] gap-3 items-center rounded-xl cd-surface-bg border cd-border-c p-3">
            <div>
              <div className="text-sm font-bold cd-text">{assignment.userName}</div>
              <div className="text-xs cd-text-muted">{assignment.userEmail}</div>
            </div>
            <div className="text-sm font-bold cd-text-primary">{assignment.templateName}</div>
            <div className="text-xs cd-text-muted">
              {assignment.scopeOverrideKind ? scopeLabel(assignment.scopeOverrideKind) : "템플릿 기본"} · {assignment.effectiveFrom}
            </div>
          </div>
        ))}
        {activeAssignments.length === 0 && <div className="text-sm cd-text-faint py-8 text-center">적용된 권한 템플릿이 없습니다.</div>}
      </div>
    </section>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <span className="cd-title-icon mt-0.5">
        <KeyRound className="w-4 h-4" />
      </span>
      <div>
        <h2 className="text-xl font-extrabold cd-text">{title}</h2>
        <p className="text-sm cd-text-muted mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="cd-label !mb-0">{label}</span>
      {children}
    </label>
  );
}
