"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import {
  Building2,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Crown,
  Folder,
  FolderOpen,
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
import type {
  DepartmentRow,
  PermissionRow,
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

type ScopeKind = "participant" | "self" | "self_dept" | "specific_dept" | "all";

const SCOPE_LABEL: Record<ScopeKind, string> = {
  participant: "참여 용역",
  self: "본인",
  self_dept: "소속 부서",
  specific_dept: "선택 부서",
  all: "전사",
};

/** 적용 범위 태그 표시 순서. */
const SCOPE_ORDER: ScopeKind[] = ["participant", "self", "self_dept", "specific_dept", "all"];

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

/** 세부 권한(트리 자식) 노드 아이콘 — 첨부 권한.svg. 색상은 카테고리별. */
function PermIcon({ className, color }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 96 96" className={className} fill="currentColor" style={{ color }} aria-hidden="true">
      <g transform="translate(-818 -227)">
        <path d="M868 257 864 257C861.8 257 860 255.2 860 253L860 245C860 242.8 861.8 241 864 241L868 241C870.2 241 872 242.8 872 245L872 253C872 255.2 870.2 257 868 257Z" />
        <path d="M898 277 874 277 874 273 898 273 898 277ZM898 289 874 289 874 285 898 285 898 289ZM898 301 874 301 874 297 898 297 898 301ZM866 301 834 301 834 293C834 291.8 834.6 290.6 835.6 289.8 837.8 288.2 840.6 286.8 843.4 286 845.6 285.4 847.8 285 850 285 852.4 285 854.6 285.4 856.6 286 859.4 286.8 862.2 288 864.4 289.8 865.4 290.6 866 291.8 866 293L866 301ZM850 267C854.4 267 858 270.6 858 275 858 279.4 854.4 283 850 283 845.6 283 842 279.4 842 275 842 270.6 845.6 267 850 267ZM902 253 876 253C876 257.4 872.4 261 868 261L864 261C859.6 261 856 257.4 856 253L830 253C827.8 253 826 254.8 826 257L826 305C826 307.2 827.8 309 830 309L902 309C904.2 309 906 307.2 906 305L906 257C906 254.8 904.2 253 902 253Z" />
      </g>
    </svg>
  );
}

/** 세부 권한 태그 — 흰색 카드 위에서 구분되도록 회색(cd-surface-bg) 배경 + 테두리. */
function TagPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full cd-surface-bg border cd-border-c px-2.5 py-0.5 text-[11px] font-semibold cd-text-muted whitespace-nowrap shrink-0">
      {children}
    </span>
  );
}

/** 권한 module → 카테고리 라벨·정렬순서·노드 색상(생성 모달 트리뷰 분류). 색상은 카테고리별로 다양하게. */
const MODULE_META: Record<string, { label: string; order: number; color: string }> = {
  contract: { label: "계약", order: 1, color: "#5D87FF" },
  billing: { label: "수주·수금·발행", order: 2, color: "#13DEB9" },
  facility: { label: "사업장", order: 3, color: "#FA896B" },
  data: { label: "데이터 수집·검수", order: 4, color: "#539BFF" },
  work_plan: { label: "업무추진계획", order: 5, color: "#FFAE1F" },
  staffing: { label: "인사·수행인력", order: 6, color: "#7C5CFC" },
  bonus: { label: "성과급", order: 7, color: "#FCC419" },
  certificate: { label: "증명서", order: 8, color: "#2DD4BF" },
  org: { label: "조직·직급", order: 9, color: "#FF7AA2" },
  account: { label: "계정", order: 10, color: "#49BEFF" },
  rbac: { label: "권한 관리", order: 11, color: "#FA5252" },
  audit: { label: "감사 로그", order: 12, color: "#94A3B8" },
  trash: { label: "휴지통", order: 13, color: "#845EF7" },
  finance: { label: "재무", order: 14, color: "#12B886" },
};
const DEFAULT_MODULE_COLOR = "#5D87FF";

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
  const permissionLabel = (key: string) =>
    permissions?.permissions.find((item) => item.permissionKey === key)?.description ?? key;

  return (
    <div className="grid xl:grid-cols-[2fr_1fr] gap-5 h-full min-h-0">
      <TemplateListCard
        permissions={permissions}
        permissionLabel={permissionLabel}
        selectedDept={selectedDept}
        onReload={onReload}
        toast={toast}
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
        <GlobalAssignmentsCard />
      )}
    </div>
  );
}

/* ── 권한 템플릿 목록 ─────────────────────────────────────────────── */

function TemplateListCard({
  permissions,
  permissionLabel,
  selectedDept,
  onReload,
  toast,
}: {
  permissions: PermissionsSnapshot | null;
  permissionLabel: (key: string) => string;
  selectedDept: DepartmentRow | null;
  onReload: () => void;
  toast: (message: string, type?: "success" | "error") => void;
}) {
  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState<"all" | "system" | "custom">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PermissionTemplateRow | null>(null);

  const openCreate = () => {
    setEditingTemplate(null);
    setCreateOpen(true);
  };
  const openEdit = (template: PermissionTemplateRow) => {
    setEditingTemplate(template);
    setCreateOpen(true);
  };

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
    <section className="cd-card p-6 h-full flex flex-col min-h-0 relative">
      <div className="flex items-start justify-between gap-4 mb-5 shrink-0">
        <div className="flex items-start gap-3">
          <span className="cd-title-icon mt-0.5">
            <ShieldCheck className="w-4 h-4" />
          </span>
          <div>
            <h2 className="text-xl font-extrabold cd-text">권한 템플릿 목록</h2>
            <p className="text-sm cd-text-muted mt-1">계정 유형별 권한 템플릿을 관리하고 빠르게 적용할 수 있습니다.</p>
          </div>
        </div>
        <button type="button" onClick={openCreate} className="cd-btn cd-btn-primary cd-btn-sm shrink-0">
          <Plus className="w-4 h-4" /> 템플릿 생성
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5 shrink-0">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 cd-text-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            className="cd-input"
            style={{ paddingLeft: "2.5rem" }}
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

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide pr-1">
        {filtered.length === 0 ? (
          <div className="text-sm cd-text-faint py-10 text-center">표시할 템플릿이 없습니다.</div>
        ) : (
          <div className="grid xl:grid-cols-2 gap-4 items-start">
            {filtered.map((template) => (
              <TemplateCard key={template.templateId} template={template} permissionLabel={permissionLabel} onEdit={openEdit} />
            ))}
          </div>
        )}
      </div>

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
    <div className={cn("rounded-2xl border cd-border-c p-5 cd-card-bg flex flex-col min-h-[208px]", !template.isActive && "opacity-60")}>
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
          <TagPill key={grant.grantId}>{permissionLabel(grant.permissionKey)}</TagPill>
        ))}
        {extra > 0 && <TagPill>+{extra}</TagPill>}
      </div>

      {expanded && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {template.grants.map((grant) => (
            <TagPill key={grant.grantId}>
              {permissionLabel(grant.permissionKey)} · {scopeLabel(grant.scopeKind)}
            </TagPill>
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
  const [templateName, setTemplateName] = useState(editing?.templateName ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [draftGrants, setDraftGrants] = useState<Array<{ permissionKey: string; scopeKind: ScopeKind; effect: "allow" | "deny" }>>(
    () => (editing?.grants ?? []).map((g) => ({ permissionKey: g.permissionKey, scopeKind: (g.scopeKind as ScopeKind) ?? "self", effect: g.effect }))
  );
  const [saving, setSaving] = useState(false);
  const [openCats, setOpenCats] = useState<Set<string>>(() => new Set(Object.keys(MODULE_META)));
  const [activePermKey, setActivePermKey] = useState<string | null>(null);

  const toggleCat = (module: string) =>
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });

  // 카테고리(module)별 권한 그룹.
  const categories = useMemo(() => {
    const groups = new Map<string, PermissionRow[]>();
    for (const p of permissions?.permissions ?? []) {
      const list = groups.get(p.module) ?? [];
      list.push(p);
      groups.set(p.module, list);
    }
    return [...groups.entries()]
      .map(([module, perms]) => ({
        module,
        label: MODULE_META[module]?.label ?? module,
        order: MODULE_META[module]?.order ?? 99,
        color: MODULE_META[module]?.color ?? DEFAULT_MODULE_COLOR,
        perms,
      }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }, [permissions]);

  const permByKey = useMemo(
    () => new Map((permissions?.permissions ?? []).map((p) => [p.permissionKey, p])),
    [permissions]
  );

  // 권한별 지원 범위 — 비어있으면 전사 고정.
  const supportedScopes = (p?: PermissionRow): ScopeKind[] => {
    const sup = ((p?.scopesSupported ?? []) as string[]).filter(Boolean) as ScopeKind[];
    return sup.length ? sup : ["all"];
  };
  const defaultScopeFor = (p: PermissionRow): ScopeKind => {
    const sup = supportedScopes(p);
    return sup.includes("self_dept") ? "self_dept" : sup[0];
  };
  const isSelected = (key: string) => draftGrants.some((g) => g.permissionKey === key);
  const removePerm = (key: string) => {
    setDraftGrants((prev) => prev.filter((g) => g.permissionKey !== key));
    setActivePermKey((cur) => (cur === key ? null : cur));
  };
  const togglePermission = (p: PermissionRow) => {
    if (draftGrants.some((g) => g.permissionKey === p.permissionKey)) {
      removePerm(p.permissionKey);
    } else {
      setDraftGrants((prev) => [...prev, { permissionKey: p.permissionKey, scopeKind: defaultScopeFor(p), effect: "allow" }]);
      setActivePermKey(p.permissionKey);
    }
  };
  const removeScope = (key: string, scope: ScopeKind) =>
    setDraftGrants((prev) => prev.filter((g) => !(g.permissionKey === key && g.scopeKind === scope)));
  const addScopeToActive = (scope: ScopeKind) => {
    if (!activePermKey) return;
    if (!supportedScopes(permByKey.get(activePermKey)).includes(scope)) return;
    setDraftGrants((prev) =>
      prev.some((g) => g.permissionKey === activePermKey && g.scopeKind === scope)
        ? prev
        : [...prev, { permissionKey: activePermKey, scopeKind: scope, effect: "allow" }]
    );
  };

  // permissionKey 별로 grant(scope) 묶기 — 우측 '선택된 권한' 태그.
  const selectedPerms = useMemo(() => {
    const order: string[] = [];
    const byKey = new Map<string, ScopeKind[]>();
    for (const g of draftGrants) {
      if (!byKey.has(g.permissionKey)) {
        byKey.set(g.permissionKey, []);
        order.push(g.permissionKey);
      }
      byKey.get(g.permissionKey)!.push(g.scopeKind);
    }
    return order.map((key) => ({ key, scopes: byKey.get(key)! }));
  }, [draftGrants]);

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

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="닫기" className="absolute inset-0 bg-black/40 rounded-3xl" onClick={onClose} />
      <div className="cd-modal relative w-[min(52rem,100%)] max-h-full overflow-y-auto scrollbar-hide p-6">
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
        </div>

        {/* 권한 선택: 좌측 카테고리 트리 + 우측 선택된 권한(권한별 적용 범위) */}
        <div className="mt-4">
          <span className="cd-label">권한 선택</span>
          <p className="text-xs cd-text-muted mb-3">좌측 트리에서 세부 권한을 클릭하면 우측에 추가됩니다. 적용 범위는 권한별 지원 범위 내에서만 설정할 수 있습니다.</p>
          <div className="grid md:grid-cols-2 gap-3">
            {/* 카테고리 트리 */}
            <div className="rounded-2xl cd-card-bg border cd-border-c p-3 max-h-[44vh] overflow-y-auto scrollbar-hide">
              {categories.map((cat) => {
                const open = openCats.has(cat.module);
                const selCount = cat.perms.filter((p) => isSelected(p.permissionKey)).length;
                return (
                  <div key={cat.module}>
                    <button
                      type="button"
                      onClick={() => toggleCat(cat.module)}
                      className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left cd-row-hover"
                    >
                      {open ? <ChevronDown className="w-3.5 h-3.5 cd-text-faint" /> : <ChevronRight className="w-3.5 h-3.5 cd-text-faint" />}
                      {open ? (
                        <FolderOpen className="w-4 h-4 shrink-0" style={{ color: cat.color }} />
                      ) : (
                        <Folder className="w-4 h-4 shrink-0" style={{ color: cat.color }} />
                      )}
                      <span className="text-sm font-bold cd-text truncate">{cat.label}</span>
                      <span className="ml-auto text-[10px] font-bold cd-text-faint shrink-0">
                        {selCount}/{cat.perms.length}
                      </span>
                    </button>
                    {open && (
                      <div className="ml-4 border-l cd-border-c pl-2 flex flex-col">
                        {cat.perms.map((p) => {
                          const sel = isSelected(p.permissionKey);
                          return (
                            <button
                              type="button"
                              key={p.permissionKey}
                              onClick={() => togglePermission(p)}
                              className={cn(
                                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition",
                                sel ? "cd-soft-primary font-semibold" : "cd-text-muted cd-row-hover"
                              )}
                            >
                              <PermIcon className="w-4 h-4 shrink-0" color={cat.color} />
                              <span className="flex-1 truncate">{p.description}</span>
                              {sel && <Check className="w-3.5 h-3.5 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {categories.length === 0 && <div className="text-sm cd-text-faint py-4 text-center">권한 목록을 불러오는 중…</div>}
            </div>

            {/* 선택된 권한 */}
            <div className="rounded-2xl cd-card-bg border cd-border-c p-3 max-h-[44vh] overflow-y-auto scrollbar-hide flex flex-col">
              <div className="flex items-center justify-between mb-2 px-1 shrink-0">
                <span className="text-sm font-bold cd-text">선택된 권한</span>
                <span className="text-[10px] font-bold cd-text-faint">{selectedPerms.length}개</span>
              </div>

              {/* 적용 범위 태그 — 활성 권한에 클릭으로 추가 */}
              <div className="flex flex-wrap gap-1.5 mb-2 pb-2 border-b cd-border-c shrink-0">
                {SCOPE_ORDER.map((s) => {
                  const activeP = activePermKey ? permByKey.get(activePermKey) : undefined;
                  const supported = activeP ? supportedScopes(activeP).includes(s) : false;
                  const already = !!activePermKey && draftGrants.some((g) => g.permissionKey === activePermKey && g.scopeKind === s);
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={!activePermKey || !supported || already}
                      onClick={() => addScopeToActive(s)}
                      className={cn(
                        "cd-pill text-[11px]",
                        !activePermKey || !supported
                          ? "cd-pill-idle opacity-40 cursor-not-allowed"
                          : already
                          ? "cd-fill-primary cursor-default"
                          : "cd-pill-info"
                      )}
                    >
                      {SCOPE_LABEL[s]}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] cd-text-faint mb-2 px-1 shrink-0">
                {activePermKey ? "위 범위 태그 클릭=추가 · 칩 우클릭=삭제" : "아래 권한을 클릭해 활성화한 뒤 범위를 추가하세요"}
              </p>

              <div className="flex-1 min-h-0">
                {selectedPerms.length === 0 ? (
                  <div className="text-xs cd-text-faint py-6 text-center">좌측 트리에서 권한을 선택하세요.</div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {selectedPerms.map(({ key, scopes }) => {
                      const p = permByKey.get(key);
                      const active = activePermKey === key;
                      return (
                        <div
                          key={key}
                          onClick={() => setActivePermKey(key)}
                          className={cn(
                            "rounded-xl border px-2.5 py-2 cursor-pointer cd-surface-bg transition",
                            active ? "border-[color:var(--cd-primary)] ring-1 ring-[color:var(--cd-primary)]" : "cd-border-c"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="flex-1 text-xs font-bold cd-text truncate">{p?.description ?? key}</span>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); removePerm(key); }}
                              className="p-0.5 rounded cd-text-faint hover:text-[color:var(--cd-error)] shrink-0"
                              title="권한 제거"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {scopes.map((s) => (
                              <span
                                key={s}
                                onContextMenu={(e) => { e.preventDefault(); if (scopes.length > 1) removeScope(key, s); }}
                                className="inline-flex items-center rounded-full cd-card-bg border cd-border-c px-2 py-0.5 text-[10px] font-bold cd-text-muted"
                                title={scopes.length > 1 ? "우클릭하여 삭제" : "지원 범위가 1개라 고정됩니다"}
                              >
                                {SCOPE_LABEL[s]}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
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
    </div>
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
      <section className="cd-card p-6 h-full flex flex-col min-h-0">
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
    <section className="cd-card p-5 flex flex-col gap-4 h-full min-h-0">
      {/* 계정 헤더 */}
      <div className="flex items-start justify-between gap-4 shrink-0">
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

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide flex flex-col gap-4">
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
      </div>
    </section>
  );
}

/* ── 미선택 시: 전체 권한 적용 현황 ──────────────────────────────── */

function GlobalAssignmentsCard() {
  return (
    <section className="cd-card p-5 h-full flex flex-col min-h-0">
      <h3 className="font-extrabold cd-text mb-1 shrink-0">계정별 권한 적용 현황</h3>
      <p className="text-sm cd-text-muted mb-4 shrink-0">조직도에서 계정을 선택하면 해당 계정의 권한 현황과 부여 메뉴가 표시됩니다.</p>
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center gap-2 px-4">
        <span className="cd-title-icon">
          <KeyRound className="w-4 h-4" />
        </span>
        <p className="text-sm cd-text-faint">왼쪽 조직도에서 인원 또는 관리자를 선택하세요.</p>
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
