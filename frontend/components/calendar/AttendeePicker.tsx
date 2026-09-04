"use client";

// 일정 참석자 선택기(회의·면접·미팅 공용) — 조직도 트리에서 인원을 고르면 우측에 "성명 직함" 태그가 쌓인다.
// 트리 체크박스 토글 = onSelectEmployee(제어 컴포넌트). 조직도는 /api/calendar/org(세션만) — 모듈 캐시 1회.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";
import type { CalendarPerson } from "@/lib/calendar/types";

let snapshotCache: OrganizationSnapshot | null = null;

export function useOrgSnapshot(enabled: boolean): OrganizationSnapshot | null {
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(snapshotCache);
  useEffect(() => {
    if (!enabled || snapshotCache) return;
    let cancelled = false;
    fetch("/api/calendar/org", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && !cancelled) {
          snapshotCache = d as OrganizationSnapshot;
          setSnapshot(snapshotCache);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return snapshot;
}

export function toPerson(emp: OrganizationEmployeeRow, snapshot: OrganizationSnapshot | null): CalendarPerson {
  return {
    employeeId: emp.employeeId,
    name: emp.name,
    positionName: emp.positionName,
    deptName: snapshot?.departments.find((d) => d.deptId === emp.deptId)?.deptName ?? null,
  };
}

/** "성명 직함" 태그 한 개 — 읽기 전용이면 X 없음. */
export function AttendeeTag({ person, onRemove }: { person: CalendarPerson; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-bold cd-text"
      style={{ borderColor: "var(--cd-primary)", background: "var(--cd-primary-soft)" }}
      title={person.deptName ?? undefined}
    >
      {person.name}
      {person.positionName && <span className="font-medium cd-text-muted">{person.positionName}</span>}
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 p-0.5 rounded-full cd-text-faint hover:cd-error-text" aria-label={`${person.name} 제외`}>
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

export function AttendeePicker({
  value,
  onChange,
  readOnly = false,
  height = "36vh",
}: {
  value: CalendarPerson[];
  onChange: (next: CalendarPerson[]) => void;
  readOnly?: boolean;
  /** 트리 영역 최대 높이 */
  height?: string;
}) {
  const snapshot = useOrgSnapshot(!readOnly);

  const toggle = (emp: OrganizationEmployeeRow) => {
    if (value.some((p) => p.employeeId === emp.employeeId)) onChange(value.filter((p) => p.employeeId !== emp.employeeId));
    else onChange([...value, toPerson(emp, snapshot)]);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* 선택된 참석자 태그 */}
      <div className="flex flex-wrap gap-1.5 min-h-[34px] rounded-xl border cd-line-c p-2">
        {value.length === 0 ? (
          <span className="text-[12px] cd-text-faint self-center px-1">{readOnly ? "참석자 없음" : "아래 조직도에서 참석자를 고르세요."}</span>
        ) : (
          value.map((p) => <AttendeeTag key={p.employeeId} person={p} onRemove={readOnly ? undefined : () => onChange(value.filter((x) => x.employeeId !== p.employeeId))} />)
        )}
      </div>
      {!readOnly && (
        <div className="overflow-y-auto rounded-xl border cd-line-c p-1" style={{ maxHeight: height }}>
          {snapshot ? (
            <OrganizationTree
              snapshot={snapshot}
              embedded
              hideHeader
              employeeCheckbox
              checkedEmployeeIds={value.map((p) => p.employeeId)}
              onSelectEmployee={toggle}
            />
          ) : (
            <p className="text-[12px] cd-text-faint py-6 text-center">조직도를 불러오는 중입니다.</p>
          )}
        </div>
      )}
    </div>
  );
}
