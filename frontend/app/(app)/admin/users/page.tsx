"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { KeyRound, RefreshCw, ShieldAlert, Trash2, Users as UsersIcon } from "lucide-react";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import PermissionManagementPanel from "@/components/admin/users/PermissionManagementPanel";
import type {
  DepartmentRow,
  OrganizationEmployeeRow,
  OrganizationSnapshot,
  PermissionsSnapshot,
  UserRow,
} from "@/components/admin/users/types";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdThemeToggle } from "@/components/cdash/CdThemeToggle";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { cn } from "@/lib/utils";
import "@/components/cdash/cdash.css";

const ROLE_LABEL: Record<UserRow["role"], string> = {
  admin: "관리자",
  editor: "편집자",
  viewer: "조회자",
};

export default function AdminUsersPage() {
  return (
    <ToastProvider>
      <Inner />
    </ToastProvider>
  );
}

function Inner() {
  const { theme, toggleTheme } = useCdashTheme();
  const { data: session, status: sessionStatus } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const [organization, setOrganization] = useState<OrganizationSnapshot | null>(null);
  const [permissions, setPermissions] = useState<PermissionsSnapshot | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedDept, setSelectedDept] = useState<DepartmentRow | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<OrganizationEmployeeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [orgRes, permissionRes, userRes] = await Promise.all([
        fetch("/api/admin/organization", { cache: "no-store" }),
        fetch("/api/admin/permissions", { cache: "no-store" }),
        fetch("/api/admin/users", { cache: "no-store" }),
      ]);
      for (const res of [orgRes, permissionRes, userRes]) {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "조회 실패");
      }
      setOrganization((await orgRes.json()) as OrganizationSnapshot);
      setPermissions((await permissionRes.json()) as PermissionsSnapshot);
      setUsers(((await userRes.json()) as { items: UserRow[] }).items ?? []);
    } catch (err) {
      toast.show("조회 실패: " + (err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (sessionStatus === "authenticated") void reload();
  }, [reload, sessionStatus]);

  if (sessionStatus === "loading") {
    return <div className="p-8 cd-text-faint text-sm">세션 확인 중…</div>;
  }
  if (role !== "admin") {
    return <AccessDenied theme={theme} />;
  }

  const updateAccount = async (
    user: UserRow,
    patch: Partial<Pick<UserRow, "role" | "status" | "name">>
  ) => {
    try {
      const res = await fetch("/api/admin/users/" + user.userId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "계정 수정 실패");
      toast.show("계정 정보가 갱신되었습니다.");
      void reload();
    } catch (err) {
      toast.show("실패: " + (err as Error).message, "error");
    }
  };

  const deleteAccount = async (user: UserRow) => {
    if (!confirm("'" + user.email + "' 계정을 삭제할까요?")) return;
    try {
      const res = await fetch("/api/admin/users/" + user.userId, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "계정 삭제 실패");
      toast.show("계정이 삭제되었습니다.");
      void reload();
    } catch (err) {
      toast.show("실패: " + (err as Error).message, "error");
    }
  };

  return (
    <div
      className="cdash cd-fields-white flex flex-col gap-5 p-4 md:p-5 rounded-3xl min-h-full"
      data-theme={theme}
    >
      <CdPageHeader
        icon={<UsersIcon className="w-5 h-5" />}
        eyebrow="시스템"
        title="계정·권한 관리"
        subtitle="먼저 권한 템플릿을 구성한 뒤 개별 계정에 부서·직급 범위에 맞는 권한을 적용합니다."
        actions={
          <>
            <button type="button" onClick={reload} className="cd-btn cd-btn-ghost cd-btn-sm">
              <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} />
              새로고침
            </button>
            <CdThemeToggle theme={theme} onToggle={toggleTheme} />
          </>
        }
      />

      <div className="grid xl:grid-cols-[360px_minmax(0,1fr)] gap-5 items-start">
        <OrganizationTree
          snapshot={organization}
          selectedDeptId={selectedDept?.deptId}
          selectedEmployeeId={selectedEmployee?.employeeId}
          onSelectDept={(dept) => setSelectedDept(dept)}
          onSelectEmployee={(employee) => setSelectedEmployee(employee)}
        />
        <div className="flex flex-col gap-5">
          <AccountCard
            users={users}
            currentUserId={(session?.user as { id?: string } | undefined)?.id}
            onUpdate={updateAccount}
            onDelete={deleteAccount}
          />
          <PermissionManagementPanel
            users={users}
            permissions={permissions}
            selectedDept={selectedDept}
            onReload={reload}
            toast={(message, type) => toast.show(message, type)}
          />
        </div>
      </div>
    </div>
  );
}

function AccountCard({
  users,
  currentUserId,
  onUpdate,
  onDelete,
}: {
  users: UserRow[];
  currentUserId?: string;
  onUpdate: (user: UserRow, patch: Partial<Pick<UserRow, "role" | "status" | "name">>) => void;
  onDelete: (user: UserRow) => void;
}) {
  return (
    <section className="cd-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] cd-text-primary">Accounts</p>
          <h2 className="text-lg font-extrabold cd-text">계정 상태 관리</h2>
          <p className="text-xs cd-text-muted mt-1">
            계정 발급은 <b className="cd-text">사용자 등록·삭제</b> 화면의 조직도에서 인원별로 진행합니다. 여기서는 발급된 계정의 권한·상태만 관리합니다.
          </p>
        </div>
        <span className="cd-title-icon"><KeyRound className="w-4 h-4" /></span>
      </div>
      <div className="rounded-2xl cd-surface-bg border cd-border-c p-4 overflow-hidden">
        <h3 className="font-bold cd-text mb-3">계정 목록 ({users.length})</h3>
        <div className="flex flex-col gap-2 max-h-96 overflow-auto pr-1">
          {users.map((user) => {
            const isSelf = currentUserId === user.userId;
            return (
              <div key={user.userId} className="grid md:grid-cols-[1fr_1.2fr_140px_90px_auto] gap-2 items-center rounded-xl cd-card-bg border cd-border-c p-3">
                <div className="text-sm font-bold cd-text truncate">
                  {user.name}
                  {isSelf && <span className="ml-2 text-[10px] cd-text-primary">YOU</span>}
                </div>
                <div className="text-xs cd-text-muted truncate">{user.loginId ?? user.email}</div>
                <select className="cd-select text-xs" value={user.role} disabled={isSelf} onChange={(e) => onUpdate(user, { role: e.target.value as UserRow["role"] })}>
                  {Object.entries(ROLE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={isSelf} onClick={() => onUpdate(user, { status: user.status === "active" ? "disabled" : "active" })} className={cn("cd-pill justify-center", user.status === "active" ? "cd-pill-info" : "cd-pill-idle", isSelf && "opacity-50")}>
                  {user.status === "active" ? "활성" : "비활성"}
                </button>
                <button type="button" disabled={isSelf} onClick={() => onDelete(user)} className={cn("p-2 rounded-lg cd-text-faint transition-colors hover:text-[color:var(--cd-error)]", isSelf && "opacity-40")}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function AccessDenied({ theme }: { theme: "light" | "dark" }) {
  return (
    <div className="cdash flex items-center justify-center min-h-full p-8" data-theme={theme}>
      <div className="cd-card p-10 text-center max-w-md">
        <ShieldAlert className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--cd-error)" }} />
        <h2 className="text-lg font-bold cd-text mb-1">접근 권한이 없습니다</h2>
        <p className="text-sm cd-text-muted">관리자만 접근할 수 있는 페이지입니다.</p>
      </div>
    </div>
  );
}
