"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { KeyRound, RefreshCw, ShieldAlert, UserRoundPlus } from "lucide-react";
import EmployeeRegistryPanel from "@/components/admin/users/EmployeeRegistryPanel";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type {
  DepartmentRow,
  OrganizationEmployeeRow,
  OrganizationSnapshot,
} from "@/components/admin/users/types";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdThemeToggle } from "@/components/cdash/CdThemeToggle";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import "@/components/cdash/cdash.css";

export default function UserRegistryPage() {
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
  const [selectedDept, setSelectedDept] = useState<DepartmentRow | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<OrganizationEmployeeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
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

  const provisionAccount = useCallback(
    async (employee: OrganizationEmployeeRow) => {
      setProvisioning(true);
      try {
        const res = await fetch(
          "/api/admin/employees/" + encodeURIComponent(employee.employeeId) + "/provision-account",
          { method: "POST" }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "계정 발급 실패");
        toast.show(
          `계정 발급 완료 · 사번/초기 비밀번호: ${data.loginId} (최초 로그인 시 변경 필요)`,
          "success"
        );
        // 선택된 인원 배지를 즉시 갱신하고, 트리/스냅샷도 재조회.
        setSelectedEmployee((prev) =>
          prev && prev.employeeId === employee.employeeId
            ? { ...prev, userId: data.userId, employeeNo: data.loginId }
            : prev
        );
        await reload();
      } catch (err) {
        toast.show("실패: " + (err as Error).message, "error");
      } finally {
        setProvisioning(false);
      }
    },
    [reload, toast]
  );

  const resetPassword = useCallback(
    async (employee: OrganizationEmployeeRow) => {
      if (!confirm(`'${employee.name}' 계정 비밀번호를 사번으로 초기화할까요? (최초 로그인 시 변경 요구)`)) return;
      try {
        const res = await fetch(
          "/api/admin/employees/" + encodeURIComponent(employee.employeeId) + "/reset-password",
          { method: "POST" }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "비밀번호 초기화 실패");
        toast.show(
          `비밀번호 초기화 완료 · 임시 비밀번호 = 사번(${data.loginId}), 최초 로그인 시 변경됩니다.`,
          "success"
        );
      } catch (err) {
        toast.show("실패: " + (err as Error).message, "error");
      }
    },
    [toast]
  );

  useEffect(() => {
    if (sessionStatus === "authenticated") void reload();
  }, [reload, sessionStatus]);

  if (sessionStatus === "loading") {
    return <div className="p-8 cd-text-faint text-sm">세션 확인 중…</div>;
  }
  if (role !== "admin") {
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

  return (
    <div
      className="cdash cd-fields-white flex flex-col gap-5 p-4 md:p-5 rounded-3xl min-h-full"
      data-theme={theme}
    >
      <CdPageHeader
        icon={<UserRoundPlus className="w-5 h-5" />}
        eyebrow="시스템"
        title="사용자 등록·삭제"
        subtitle="조직도 기반으로 부서 위계와 직급 사용 범위를 관리하고, 직원의 기본 정보·학력·자격·증빙을 등록합니다."
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
          title="조직도 · 직원"
          allowResignedView
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
        <div className="flex flex-col gap-5">
          {selectedEmployee && (
            <AccountProvisionBar
              employee={selectedEmployee}
              busy={provisioning}
              onProvision={provisionAccount}
              onResetPassword={resetPassword}
            />
          )}
          <EmployeeRegistryPanel
            snapshot={organization}
            selectedDept={selectedDept}
            selectedEmployee={selectedEmployee}
            onReload={reload}
            toast={(message, type) => toast.show(message, type)}
          />
        </div>
      </div>
    </div>
  );
}

function AccountProvisionBar({
  employee,
  busy,
  onProvision,
  onResetPassword,
}: {
  employee: OrganizationEmployeeRow;
  busy: boolean;
  onProvision: (employee: OrganizationEmployeeRow) => void;
  onResetPassword: (employee: OrganizationEmployeeRow) => void;
}) {
  const provisioned = Boolean(employee.userId);
  const ready = Boolean(employee.hiredAt && employee.gender && employee.hasBirthDate);
  const missing = [
    !employee.hiredAt && "입사일",
    !employee.gender && "성별",
    !employee.hasBirthDate && "생년월일",
  ].filter(Boolean) as string[];

  return (
    <section className="cd-card p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="cd-title-icon"><KeyRound className="w-4 h-4" /></span>
          <div>
            <h3 className="font-extrabold cd-text">{employee.name} · 계정</h3>
            {provisioned ? (
              <p className="text-xs cd-text-muted">
                사번 <b className="cd-text">{employee.employeeNo}</b> · 발급됨. 초기 비밀번호는 사번과 동일하며 최초 로그인 시 변경합니다.
              </p>
            ) : ready ? (
              <p className="text-xs cd-text-muted">
                계정 미발급. 발급하면 사번이 생성되고 초기 비밀번호는 사번과 동일하게 설정됩니다.
              </p>
            ) : (
              <p className="text-xs" style={{ color: "var(--cd-error)" }}>
                발급 전 필수정보 부족: {missing.join(", ")} — 아래 기본정보에서 입력 후 새로고침하세요.
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {provisioned ? (
            <>
              <button
                type="button"
                onClick={() => onResetPassword(employee)}
                className="cd-btn cd-btn-ghost cd-btn-sm"
              >
                <KeyRound className="w-3.5 h-3.5" /> 비밀번호 초기화
              </button>
              <span className="cd-pill cd-pill-info">발급됨</span>
            </>
          ) : (
            <button
              type="button"
              disabled={!ready || busy}
              onClick={() => onProvision(employee)}
              className="cd-btn cd-btn-primary cd-btn-sm"
            >
              {busy ? "발급 중..." : "계정 발급"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
