"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Network, ShieldHalf, UserRound, UserRoundX, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DepartmentRow,
  OrganizationEmployeeRow,
  OrganizationSnapshot,
  SelectedAccount,
  UserRow,
} from "./types";

interface OrganizationTreeProps {
  snapshot: OrganizationSnapshot | null;
  selectedDeptId?: string | null;
  selectedEmployeeId?: string | null;
  /** 마스터(관리자) 노드 하이라이트용 — 선택된 계정의 userId */
  selectedUserId?: string | null;
  /** 조직도 맨 아래 Master 그룹에 노출할 관리자(role==='admin') 계정 */
  adminUsers?: UserRow[];
  onSelectDept?: (dept: DepartmentRow) => void;
  onSelectEmployee?: (employee: OrganizationEmployeeRow) => void;
  /** 인원/관리자 클릭 시 계정 선택(권한 패널 연동) */
  onSelectAccount?: (account: SelectedAccount) => void;
  title?: string;
  /** 모달 등에 끼울 때 자체 높이 제한·스크롤을 제거 */
  embedded?: boolean;
  /** 부모(고정 높이 행)의 높이를 가득 채우고 내부만 스크롤 */
  fillHeight?: boolean;
  /** 재직자 ↔ 퇴사자 트리 전환 토글 노출(사용자 등록·삭제 화면 전용) */
  allowResignedView?: boolean;
}

const MASTER_KEY = "__master__";

export default function OrganizationTree({
  snapshot,
  selectedDeptId,
  selectedEmployeeId,
  selectedUserId,
  adminUsers = [],
  onSelectDept,
  onSelectEmployee,
  onSelectAccount,
  title = "조직도",
  embedded = false,
  fillHeight = false,
  allowResignedView = false,
}: OrganizationTreeProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(["exec"]));
  const [viewMode, setViewMode] = useState<"active" | "resigned">("active");
  const departments = snapshot?.departments ?? [];
  const employees = snapshot?.employees ?? [];
  const resignedView = allowResignedView && viewMode === "resigned";

  const roots = useMemo(
    () =>
      departments
        .filter((dept) => !dept.parentDeptId)
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [departments]
  );

  const childrenByParent = useMemo(() => {
    const map = new Map<string, DepartmentRow[]>();
    for (const dept of departments) {
      if (!dept.parentDeptId) continue;
      const list = map.get(dept.parentDeptId) ?? [];
      list.push(dept);
      map.set(dept.parentDeptId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.displayOrder - b.displayOrder);
    }
    return map;
  }, [departments]);

  const employeesByDept = useMemo(() => {
    const map = new Map<string, OrganizationEmployeeRow[]>();
    for (const employee of employees) {
      if (!employee.deptId) continue;
      const isActive = employee.status === "active";
      // 재직자 뷰=active 인원만, 퇴사자 뷰=inactive(퇴사) 인원만.
      if (resignedView ? isActive : !isActive) continue;
      const list = map.get(employee.deptId) ?? [];
      list.push(employee);
      map.set(employee.deptId, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          (b.positionRankOrder ?? -1) - (a.positionRankOrder ?? -1) ||
          a.name.localeCompare(b.name)
      );
    }
    return map;
  }, [employees, resignedView]);

  // 퇴사자 뷰: 퇴사자가 있는 부서 + 그 조상만 노출(빈 부서 가지치기).
  const visibleDeptIds = useMemo(() => {
    if (!resignedView) return null;
    const byId = new Map(departments.map((d) => [d.deptId, d]));
    const ids = new Set<string>();
    for (const [deptId, list] of employeesByDept) {
      if (!list.length) continue;
      let cur: string | null = deptId;
      while (cur && !ids.has(cur)) {
        ids.add(cur);
        cur = byId.get(cur)?.parentDeptId ?? null;
      }
    }
    return ids;
  }, [resignedView, departments, employeesByDept]);

  const toggle = (deptId: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  };

  const renderDept = (dept: DepartmentRow, depth: number) => {
    // 퇴사자 뷰: 퇴사자가 없는 부서(하위 포함)는 숨김.
    if (resignedView && visibleDeptIds && !visibleDeptIds.has(dept.deptId)) return null;
    const childDepartments = childrenByParent.get(dept.deptId) ?? [];
    const childEmployees = employeesByDept.get(dept.deptId) ?? [];
    const hasChildren = childDepartments.length > 0 || childEmployees.length > 0;
    const isOpen = open.has(dept.deptId) || depth === 0 || resignedView;
    const accent = dept.accentColor || "#16A34A";

    return (
      <div key={dept.deptId} className="relative">
        {depth > 0 && (
          <div className="absolute left-3 top-0 bottom-0 w-px" style={{ background: "var(--cd-border)" }} />
        )}
        <button
          type="button"
          onClick={() => {
            onSelectDept?.(dept);
            if (hasChildren) toggle(dept.deptId);
          }}
          className={cn(
            "w-full flex items-center gap-2 rounded-xl px-2 py-2 text-left transition",
            selectedDeptId === dept.deptId
              ? "cd-soft-primary"
              : "cd-text-muted cd-row-hover hover:text-[color:var(--cd-text)]"
          )}
          style={{ marginLeft: depth * 14 }}
        >
          <span className="w-4 h-4 flex items-center justify-center cd-text-faint">
            {hasChildren ? (
              isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--cd-faint)" }} />
            )}
          </span>
          <Network className="w-4 h-4" fill="currentColor" style={{ color: accent }} />
          <span className="text-sm font-semibold truncate">{dept.deptName}</span>
          <span className="ml-auto mr-1 text-[10px] font-bold cd-text-faint">{childEmployees.length}</span>
        </button>

        {isOpen && (
          <div className="ml-5">
            {childDepartments.map((child) => renderDept(child, depth + 1))}
            {childEmployees.map((employee) => (
              <button
                type="button"
                key={employee.employeeId}
                onClick={() => {
                  onSelectEmployee?.(employee);
                  onSelectAccount?.({
                    kind: "employee",
                    userId: employee.userId,
                    name: employee.name,
                    employeeId: employee.employeeId,
                    deptId: employee.deptId,
                    loginId: employee.employeeNo,
                    email: employee.email,
                  });
                }}
                className={cn(
                  "w-full flex items-center gap-2 rounded-xl px-2 py-1.5 text-left transition",
                  selectedEmployeeId === employee.employeeId
                    ? "cd-fill-primary"
                    : "cd-text-muted cd-row-hover hover:text-[color:var(--cd-text)]"
                )}
                style={{ marginLeft: (depth + 1) * 14 }}
              >
                <span className="w-4 h-4 rounded-bl-md" style={{ borderLeft: "1px solid var(--cd-border)", borderBottom: "1px solid var(--cd-border)" }} />
                <UserRound className="w-4 h-4" fill="currentColor" style={{ color: accent }} />
                <span className="text-xs font-normal truncate">{employee.name}</span>
                <span
                  className={cn(
                    "text-[10px] truncate",
                    selectedEmployeeId === employee.employeeId ? "text-white/70" : "cd-text-faint"
                  )}
                >
                  {employee.positionName}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // 마스터(관리자) 계정 그룹: 부모 'Master' → 자식 관리자 계정. 아이콘 회색.
  const renderMaster = () => {
    const isOpen = open.has(MASTER_KEY);
    const gray = "var(--cd-faint)";
    return (
      <div key={MASTER_KEY} className="relative pt-1">
        <button
          type="button"
          onClick={() => toggle(MASTER_KEY)}
          className="w-full flex items-center gap-2 rounded-xl px-2 py-2 text-left transition cd-text-muted cd-row-hover hover:text-[color:var(--cd-text)]"
        >
          <span className="w-4 h-4 flex items-center justify-center cd-text-faint">
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
          <ShieldHalf className="w-4 h-4" fill="currentColor" style={{ color: gray }} />
          <span className="text-sm font-semibold truncate">Master</span>
          <span className="ml-auto mr-1 text-[10px] font-bold cd-text-faint">{adminUsers.length}</span>
        </button>
        {isOpen && (
          <div className="ml-5">
            {adminUsers.map((user) => (
              <button
                type="button"
                key={user.userId}
                onClick={() =>
                  onSelectAccount?.({
                    kind: "master",
                    userId: user.userId,
                    name: user.name || "관리자",
                    loginId: user.loginId,
                    email: user.email,
                  })
                }
                className={cn(
                  "w-full flex items-center gap-2 rounded-xl px-2 py-1.5 text-left transition",
                  selectedUserId === user.userId
                    ? "cd-fill-primary"
                    : "cd-text-muted cd-row-hover hover:text-[color:var(--cd-text)]"
                )}
                style={{ marginLeft: 14 }}
              >
                <span className="w-4 h-4 rounded-bl-md" style={{ borderLeft: "1px solid var(--cd-border)", borderBottom: "1px solid var(--cd-border)" }} />
                <UserRound className="w-4 h-4" fill="currentColor" style={{ color: gray }} />
                <span className="text-xs font-normal truncate">{user.name || "관리자"}</span>
                <span
                  className={cn(
                    "text-[10px] truncate",
                    selectedUserId === user.userId ? "text-white/70" : "cd-text-faint"
                  )}
                >
                  관리자
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className={cn("cd-card p-5", fillHeight && "h-full flex flex-col min-h-0")}>
      <div className="mb-4 shrink-0 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] cd-text-primary">Organization</p>
          <h2 className="text-lg font-extrabold cd-text">{resignedView ? "퇴사자" : title}</h2>
        </div>
        {allowResignedView && (
          <button
            type="button"
            onClick={() => setViewMode((m) => (m === "resigned" ? "active" : "resigned"))}
            className={cn("cd-btn cd-btn-sm", resignedView ? "cd-btn-primary" : "cd-btn-ghost")}
            title={resignedView ? "재직자 보기로 전환" : "퇴사자 보기로 전환"}
          >
            {resignedView ? <Users className="w-3.5 h-3.5" /> : <UserRoundX className="w-3.5 h-3.5" />}
            {resignedView ? "재직자" : "퇴사자"}
          </button>
        )}
      </div>
      <div
        className={
          fillHeight
            ? "flex-1 min-h-0 overflow-y-auto scrollbar-hide pr-1"
            : embedded
            ? "max-h-[380px] overflow-y-auto scrollbar-hide pr-1"
            : "max-h-[calc(100vh-260px)] min-h-[520px] overflow-auto scrollbar-hide pr-1"
        }
      >
        {!snapshot ? (
          <div className="text-sm cd-text-faint py-10 text-center">조직도 로딩 중…</div>
        ) : resignedView && visibleDeptIds && visibleDeptIds.size === 0 ? (
          <div className="text-sm cd-text-faint py-10 text-center">퇴사자가 없습니다.</div>
        ) : (
          <div className="space-y-1">
            {roots.map((dept) => renderDept(dept, 0))}
            {!resignedView && adminUsers.length > 0 && renderMaster()}
          </div>
        )}
      </div>
    </section>
  );
}
