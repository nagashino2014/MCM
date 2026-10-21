"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { RefreshCw, Users as UsersIcon } from "lucide-react";
import { hasAnyPerm, hasPerm, permsOf } from "@/lib/auth/perms";
import { ACCOUNT_ADMIN_KEYS } from "@/config/menu-permissions";
import { AccessDenied } from "@/components/auth/AccessDenied";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import PermissionManagementPanel from "@/components/admin/users/PermissionManagementPanel";
import { AccountPurgeModal } from "@/components/admin/users/AccountPurgeModal";
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
  // 권한이 없어 403 을 받은 영역 — 화면 전체를 실패시키지 않고 그 영역만 숨기거나 안내한다(F-27).
  const [denied, setDenied] = useState({ permissions: false, users: false });
  const [purgeTarget, setPurgeTarget] = useState<UserRow | null>(null);
  const toast = useToast();

  const reload = useCallback(async () => {
    setLoading(true);
    // 세 API 의 권한 키가 다르다(조직도 org.view 등 · 템플릿 rbac.* · 계정 account.manage) — 각각 따로 불러
    // 키 하나만 가진 담당자도 볼 수 있는 부분은 보게 한다(F-27, 2026-10-21). 403 은 '권한 없음'으로 표시, 그 외 오류만 알린다.
    const load = async <T,>(url: string): Promise<T | "denied"> => {
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 403) return "denied";
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "조회 실패");
      return (await res.json()) as T;
    };
    const [orgResult, permissionResult, userResult] = await Promise.allSettled([
      load<OrganizationSnapshot>("/api/admin/organization"),
      load<PermissionsSnapshot>("/api/admin/permissions"),
      load<{ items: UserRow[] }>("/api/admin/users"),
    ]);
    const failures: string[] = [];
    if (orgResult.status === "fulfilled") {
      if (orgResult.value !== "denied") setOrganization(orgResult.value);
      else failures.push("조직도: 권한이 없습니다.");
    } else failures.push("조직도: " + (orgResult.reason as Error).message);
    if (permissionResult.status === "fulfilled") {
      const value = permissionResult.value;
      setPermissions(value === "denied" ? null : value);
      setDenied((prev) => ({ ...prev, permissions: value === "denied" }));
    } else failures.push("권한 템플릿: " + (permissionResult.reason as Error).message);
    if (userResult.status === "fulfilled") {
      const value = userResult.value;
      setUsers(value === "denied" ? [] : value.items ?? []);
      setDenied((prev) => ({ ...prev, users: value === "denied" }));
    } else failures.push("계정 목록: " + (userResult.reason as Error).message);
    if (failures.length) toast.show("조회 실패 — " + failures.join(" / "), "error");
    setLoading(false);
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

  // 화면 버튼 노출 — 실제 판정은 각 API. 템플릿 저장은 rbac.template.manage, 부여·회수는 rbac.assignment.manage.
  const sessionPerms = permsOf(session?.user);
  const canManageTemplates = hasPerm(sessionPerms, "rbac.template.manage");
  const canAssign = hasPerm(sessionPerms, "rbac.assignment.manage");

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

  // 계정 영구 삭제는 확인 모달(미리보기·로그인 ID 재입력)을 거친다 — AccountPurgeModal.
  // 직원 프로필(조직 인원)에 연결된 계정 — 나머지는 조직도 "미연결 계정" 그룹에 보여 비활성·삭제할 수 있게 한다.
  const linkedUserIds = new Set((organization?.employees ?? []).map((e) => e.userId).filter((v): v is string => !!v));
  const deleteAccount = (user: UserRow) => setPurgeTarget(user);
  const onPurged = (user: UserRow, employeeDeleted: boolean) => {
    setPurgeTarget(null);
    toast.show(employeeDeleted ? "계정과 직원 프로필을 삭제했습니다." : "계정을 삭제했습니다.");
    if (selectedAccount?.userId === user.userId) setSelectedAccount(null);
    void reload();
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
          unlinkedUsers={users.filter((u) => !systemAdminUserIds.has(u.userId) && !linkedUserIds.has(u.userId))}
          onSelectDept={(dept) => setSelectedDept(dept)}
          onSelectAccount={(account) => setSelectedAccount(account)}
        />
        <AccountPurgeModal user={purgeTarget} onClose={() => setPurgeTarget(null)} onPurged={onPurged} />
        <PermissionManagementPanel
          users={users}
          permissions={permissions}
          permissionsDenied={denied.permissions}
          usersDenied={denied.users}
          canManageTemplates={canManageTemplates}
          canAssign={canAssign}
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
