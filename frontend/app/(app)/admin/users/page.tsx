"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { RefreshCw, Users as UsersIcon } from "lucide-react";
import { hasAnyPerm, permsOf } from "@/lib/auth/perms";
import { ACCOUNT_ADMIN_KEYS } from "@/config/menu-permissions";
import { AccessDenied } from "@/components/auth/AccessDenied";
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
  const { theme } = useCdashTheme();
  const { data: session, status: sessionStatus } = useSession();
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
  // 미들웨어가 /admin 을 1차 차단하지만, 권한 요약이 없는 구 토큰·직접 진입에 대비해 화면에서도 같은 키로 판정한다.
  if (!hasAnyPerm(permsOf(session?.user), ACCOUNT_ADMIN_KEYS)) {
    return <AccessDenied requiredKeys={ACCOUNT_ADMIN_KEYS} />;
  }

  // 시스템 관리자 = 유효한 tpl-system-admin 템플릿 보유 계정(role 이 아니다 — role 일원화 WP6).
  const systemAdminUserIds = new Set(
    (permissions?.assignments ?? [])
      .filter((a) => a.templateId === "tpl-system-admin" && !a.revokedAt)
      .map((a) => a.userId)
  );

  const updateAccount = async (
    user: UserRow,
    patch: Partial<Pick<UserRow, "status" | "name">>
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
        help="먼저 권한 템플릿을 구성한 뒤 개별 계정에 부서·직급 범위에 맞는 권한을 적용합니다."
        actions={
          <button type="button" onClick={reload} className="cd-btn cd-btn-ghost cd-btn-sm">
            <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} />
            새로고침
          </button>
        }
      />

      <div className="grid xl:grid-cols-[360px_minmax(0,1fr)] gap-5 items-stretch xl:h-[calc(100vh-200px)] min-h-0">
        <OrganizationTree
          snapshot={organization}
          fillHeight
          selectedDeptId={selectedDept?.deptId}
          selectedEmployeeId={selectedAccount?.employeeId ?? null}
          selectedUserId={selectedAccount?.userId ?? null}
          adminUsers={users.filter((u) => systemAdminUserIds.has(u.userId))}
          onSelectDept={(dept) => setSelectedDept(dept)}
          onSelectAccount={(account) => setSelectedAccount(account)}
        />
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
  );
}
