"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { RefreshCw, ShieldAlert, Users as UsersIcon } from "lucide-react";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import PermissionManagementPanel from "@/components/admin/users/PermissionManagementPanel";
import type {
  DepartmentRow,
  OrganizationSnapshot,
  PermissionsSnapshot,
  SelectedAccount,
  UserRow,
} from "@/components/admin/users/types";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdThemeToggle } from "@/components/cdash/CdThemeToggle";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import "@/components/cdash/cdash.css";

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
  const [selectedAccount, setSelectedAccount] = useState<SelectedAccount | null>(null);
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
    if (!confirm("'" + (user.loginId ?? user.email) + "' 계정을 삭제할까요?")) return;
    try {
      const res = await fetch("/api/admin/users/" + user.userId, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "계정 삭제 실패");
      toast.show("계정이 삭제되었습니다.");
      if (selectedAccount?.userId === user.userId) setSelectedAccount(null);
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
          selectedEmployeeId={selectedAccount?.employeeId ?? null}
          selectedUserId={selectedAccount?.userId ?? null}
          adminUsers={users.filter((u) => u.role === "admin")}
          onSelectDept={(dept) => setSelectedDept(dept)}
          onSelectAccount={(account) => setSelectedAccount(account)}
        />
        <div className="flex flex-col gap-5">
          <PermissionManagementPanel
            users={users}
            permissions={permissions}
            selectedDept={selectedDept}
            selectedAccount={selectedAccount}
            currentUserId={(session?.user as { id?: string } | undefined)?.id}
            onReload={reload}
            onUpdateAccount={updateAccount}
            onDeleteAccount={deleteAccount}
            toast={(message, type) => toast.show(message, type)}
          />
        </div>
      </div>
    </div>
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
