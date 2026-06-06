"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { KeyRound, Plus, RefreshCw, ShieldAlert, Trash2, Users as UsersIcon } from "lucide-react";
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
import { cn } from "@/lib/utils";

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
  const { data: session, status: sessionStatus } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const [organization, setOrganization] = useState<OrganizationSnapshot | null>(null);
  const [permissions, setPermissions] = useState<PermissionsSnapshot | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedDept, setSelectedDept] = useState<DepartmentRow | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<OrganizationEmployeeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountDraft, setAccountDraft] = useState({
    name: "",
    email: "",
    password: "",
    role: "editor" as UserRow["role"],
  });
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
    return <div className="p-8 text-stone-400 text-sm">세션 확인 중…</div>;
  }
  if (role !== "admin") {
    return <AccessDenied />;
  }

  const createAccount = async () => {
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(accountDraft),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "계정 생성 실패");
      setAccountDraft({ name: "", email: "", password: "", role: "editor" });
      toast.show("계정이 생성되었습니다.");
      void reload();
    } catch (err) {
      toast.show("실패: " + (err as Error).message, "error");
    }
  };

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
    <div className="flex flex-col gap-6 p-2">
      <section className="glass-panel p-8 rounded-3xl relative overflow-hidden reveal">
        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-black text-stone-800 mb-2 flex items-center gap-3">
              <UsersIcon className="w-7 h-7 text-primary" fill="currentColor" />
              시스템 · 계정·권한 관리
            </h1>
            <p className="text-stone-600 text-base max-w-3xl">
              먼저 권한 템플릿을 구성한 뒤 개별 계정에 부서·직급 범위에 맞는 권한을 적용합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={reload}
            className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700 flex items-center gap-1"
          >
            <RefreshCw className={"w-3 h-3 " + (loading ? "animate-spin" : "")} />
            새로고침
          </button>
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
      </section>

      <div className="grid xl:grid-cols-[360px_minmax(0,1fr)] gap-6 items-start">
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
            draft={accountDraft}
            setDraft={setAccountDraft}
            onCreate={createAccount}
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
  draft,
  setDraft,
  onCreate,
  onUpdate,
  onDelete,
}: {
  users: UserRow[];
  currentUserId?: string;
  draft: { name: string; email: string; password: string; role: UserRow["role"] };
  setDraft: (draft: { name: string; email: string; password: string; role: UserRow["role"] }) => void;
  onCreate: () => void;
  onUpdate: (user: UserRow, patch: Partial<Pick<UserRow, "role" | "status" | "name">>) => void;
  onDelete: (user: UserRow) => void;
}) {
  return (
    <section className="glass-panel rounded-3xl p-6 reveal delay-1">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">Accounts</p>
          <h2 className="text-xl font-black text-stone-800">계정 생성·상태 관리</h2>
        </div>
        <KeyRound className="w-5 h-5 text-primary" fill="currentColor" />
      </div>
      <div className="grid lg:grid-cols-[0.9fr_1.4fr] gap-4">
        <div className="rounded-2xl bg-white/55 border border-white/70 p-4">
          <h3 className="font-black text-stone-800 mb-3 flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" /> 계정 생성
          </h3>
          <div className="space-y-2">
            <input className="input-field" placeholder="성명" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input className="input-field" placeholder="이메일" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            <input className="input-field" type="password" placeholder="초기 비밀번호(8자 이상)" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
            <select className="ui-select" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as UserRow["role"] })}>
              <option value="admin">관리자</option>
              <option value="editor">편집자</option>
              <option value="viewer">조회자</option>
            </select>
            <button type="button" onClick={onCreate} disabled={!draft.name || !draft.email || draft.password.length < 8} className="rounded-xl px-4 py-2 text-xs font-bold text-white bg-primary disabled:opacity-40">
              계정 생성
            </button>
          </div>
        </div>
        <div className="rounded-2xl bg-white/55 border border-white/70 p-4 overflow-hidden">
          <h3 className="font-black text-stone-800 mb-3">계정 목록 ({users.length})</h3>
          <div className="flex flex-col gap-2 max-h-80 overflow-auto pr-1">
            {users.map((user) => {
              const isSelf = currentUserId === user.userId;
              return (
                <div key={user.userId} className="grid md:grid-cols-[1fr_1.2fr_140px_90px_auto] gap-2 items-center rounded-xl bg-white/60 border border-white/70 p-3">
                  <div className="text-sm font-black text-stone-800 truncate">
                    {user.name}
                    {isSelf && <span className="ml-2 text-[10px] text-primary">YOU</span>}
                  </div>
                  <div className="text-xs text-stone-500 truncate">{user.email}</div>
                  <select className="ui-select text-xs" value={user.role} disabled={isSelf} onChange={(e) => onUpdate(user, { role: e.target.value as UserRow["role"] })}>
                    {Object.entries(ROLE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button type="button" disabled={isSelf} onClick={() => onUpdate(user, { status: user.status === "active" ? "disabled" : "active" })} className={cn("rounded-full px-2 py-1 text-[10px] font-bold", user.status === "active" ? "bg-primary/10 text-primary" : "bg-stone-200 text-stone-500", isSelf && "opacity-40")}>
                    {user.status === "active" ? "활성" : "비활성"}
                  </button>
                  <button type="button" disabled={isSelf} onClick={() => onDelete(user)} className={cn("p-2 rounded-lg text-stone-400 hover:text-red-600", isSelf && "opacity-40 hover:text-stone-400")}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function AccessDenied() {
  return (
    <div className="p-8 flex items-center justify-center">
      <div className="glass-card rounded-3xl p-10 text-center max-w-md">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-stone-800 mb-1">접근 권한이 없습니다</h2>
        <p className="text-sm text-stone-500">관리자만 접근할 수 있는 페이지입니다.</p>
      </div>
    </div>
  );
}
