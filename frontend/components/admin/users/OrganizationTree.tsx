"use client";

import { useMemo, useState } from "react";
import { Building2, ChevronDown, ChevronRight, Network, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DepartmentRow, OrganizationEmployeeRow, OrganizationSnapshot } from "./types";

interface OrganizationTreeProps {
  snapshot: OrganizationSnapshot | null;
  selectedDeptId?: string | null;
  selectedEmployeeId?: string | null;
  onSelectDept?: (dept: DepartmentRow) => void;
  onSelectEmployee?: (employee: OrganizationEmployeeRow) => void;
  title?: string;
}

export default function OrganizationTree({
  snapshot,
  selectedDeptId,
  selectedEmployeeId,
  onSelectDept,
  onSelectEmployee,
  title = "조직도",
}: OrganizationTreeProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(["exec"]));
  const departments = snapshot?.departments ?? [];
  const employees = snapshot?.employees ?? [];

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
      if (!employee.deptId || employee.status !== "active") continue;
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
  }, [employees]);

  const toggle = (deptId: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  };

  const renderDept = (dept: DepartmentRow, depth: number) => {
    const childDepartments = childrenByParent.get(dept.deptId) ?? [];
    const childEmployees = employeesByDept.get(dept.deptId) ?? [];
    const hasChildren = childDepartments.length > 0 || childEmployees.length > 0;
    const isOpen = open.has(dept.deptId) || depth === 0;
    const accent = dept.accentColor || "#16A34A";

    return (
      <div key={dept.deptId} className="relative">
        {depth > 0 && <div className="absolute left-3 top-0 bottom-0 border-l border-stone-200" />}
        <button
          type="button"
          onClick={() => {
            onSelectDept?.(dept);
            if (hasChildren) toggle(dept.deptId);
          }}
          className={cn(
            "w-full flex items-center gap-2 rounded-xl px-2 py-2 text-left transition",
            selectedDeptId === dept.deptId
              ? "bg-primary/10 text-primary"
              : "hover:bg-white/70 text-stone-700"
          )}
          style={{ marginLeft: depth * 14 }}
        >
          <span className="w-4 h-4 flex items-center justify-center text-stone-400">
            {hasChildren ? (
              isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-stone-300" />
            )}
          </span>
          <Network className="w-4 h-4" fill="currentColor" style={{ color: accent }} />
          <span className="text-sm font-medium truncate">{dept.deptName}</span>
          <span className="ml-auto text-[10px] font-bold text-stone-400">{childEmployees.length}</span>
        </button>

        {isOpen && (
          <div className="ml-5">
            {childDepartments.map((child) => renderDept(child, depth + 1))}
            {childEmployees.map((employee) => (
              <button
                type="button"
                key={employee.employeeId}
                onClick={() => onSelectEmployee?.(employee)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-xl px-2 py-1.5 text-left transition",
                  selectedEmployeeId === employee.employeeId
                    ? "bg-stone-900 text-white"
                    : "hover:bg-white/70 text-stone-600"
                )}
                style={{ marginLeft: (depth + 1) * 14 }}
              >
                <span className="w-4 h-4 border-l border-b border-stone-200 rounded-bl-md" />
                <UserRound className="w-4 h-4" fill="currentColor" style={{ color: accent }} />
                <span className="text-xs font-normal truncate">{employee.name}</span>
                <span className="text-[10px] text-stone-400 truncate">{employee.positionName}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="glass-panel rounded-3xl p-5 reveal bg-white/70">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">Organization</p>
          <h2 className="text-lg font-black text-stone-800">{title}</h2>
        </div>
        <Building2 className="w-5 h-5 text-primary" fill="currentColor" />
      </div>
      <div className="max-h-[calc(100vh-260px)] min-h-[520px] overflow-auto pr-1">
        {!snapshot ? (
          <div className="text-sm text-stone-400 py-10 text-center">조직도 로딩 중…</div>
        ) : (
          <div className="space-y-1">{roots.map((dept) => renderDept(dept, 0))}</div>
        )}
      </div>
    </section>
  );
}
