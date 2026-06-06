"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { RefreshCw, ShieldAlert, UserRoundPlus } from "lucide-react";
import EmployeeRegistryPanel from "@/components/admin/users/EmployeeRegistryPanel";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type {
  DepartmentRow,
  OrganizationEmployeeRow,
  OrganizationSnapshot,
} from "@/components/admin/users/types";
import { ToastProvider, useToast } from "@/components/ui/Toast";

export default function UserRegistryPage() {
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
  const [selectedDept, setSelectedDept] = useState<DepartmentRow | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<OrganizationEmployeeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/organization", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "조직도 조회 실패");
      const snapshot = (await res.json()) as OrganizationSnapshot;
      setOrganization(snapshot);
      if (!selectedDept && snapshot.departments.length) setSelectedDept(snapshot.departments[0]);
    } catch (err) {
      toast.show("조회 실패: " + (err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [selectedDept, toast]);

  useEffect(() => {
    if (sessionStatus === "authenticated") void reload();
  }, [reload, sessionStatus]);

  if (sessionStatus === "loading") {
    return <div className="p-8 text-stone-400 text-sm">세션 확인 중…</div>;
  }
  if (role !== "admin") {
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

  return (
    <div className="flex flex-col gap-6 p-2">
      <section className="glass-panel p-8 rounded-3xl relative overflow-hidden reveal">
        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-black text-stone-800 mb-2 flex items-center gap-3">
              <UserRoundPlus className="w-7 h-7 text-primary" fill="currentColor" />
              시스템 · 사용자 등록·삭제
            </h1>
            <p className="text-stone-600 text-base max-w-3xl">
              조직도 기반으로 부서 위계와 직급 사용 범위를 관리하고, 직원의 기본 정보·학력·자격·증빙을 등록합니다.
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
          title="조직도 · 직원"
          selectedDeptId={selectedDept?.deptId}
          selectedEmployeeId={selectedEmployee?.employeeId}
          onSelectDept={(dept) => {
            setSelectedDept(dept);
            setSelectedEmployee(null);
          }}
          onSelectEmployee={(employee) => {
            setSelectedEmployee(employee);
            const dept = organization?.departments.find((item) => item.deptId === employee.deptId);
            if (dept) setSelectedDept(dept);
          }}
        />
        <EmployeeRegistryPanel
          snapshot={organization}
          selectedDept={selectedDept}
          selectedEmployee={selectedEmployee}
          onReload={reload}
          toast={(message, type) => toast.show(message, type)}
        />
      </div>
    </div>
  );
}
