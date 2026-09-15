"use client";

// 일정 메뉴(G6-C) '선택' 대상 지정 모달 — 홈 CalendarRefPickerModal 의 확장판.
// 홈(최대 10명·개인만)과 달리 인원 무제한 + 부서 일괄 + 전사 일괄을 지원한다.
// 저장 값은 조건({employeeIds, deptIds, all}) — 조회 시점에 인원으로 확장돼 인사이동이 자동 반영된다.

import { useEffect, useState } from "react";
import { Building2, X } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdButton } from "@/components/cdash/CdButton";
import { CdAvatar } from "@/components/cdash/CdAvatar";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { DepartmentRow, OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";
import type { CalendarRefs } from "@/lib/calendar/types";

/** 조직도 스냅샷은 세션 중 1회만 받는다(OrgPickerModal 과 같은 관례). */
let snapshotCache: OrganizationSnapshot | null = null;

interface PickedPerson {
  employeeId: string;
  name: string;
  positionName: string | null;
  deptName: string | null;
}

export function CalendarRefsModal({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: CalendarRefs;
  onClose: () => void;
  onSave: (refs: CalendarRefs) => void;
}) {
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(snapshotCache);
  const [all, setAll] = useState(false);
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [people, setPeople] = useState<PickedPerson[]>([]);

  useEffect(() => {
    if (!open || snapshotCache) return;
    let cancelled = false;
    fetch("/api/calendar/org", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && !cancelled) {
          snapshotCache = d as OrganizationSnapshot;
          setSnapshot(snapshotCache);
        }
      })
      .catch(() => {
        /* 무시 — 로딩 안내 유지 */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 열 때마다 저장된 조건을 스냅샷으로 복원한다.
  useEffect(() => {
    if (!open || !snapshot) return;
    const deptName = (deptId: string | null) => snapshot.departments.find((d) => d.deptId === deptId)?.deptName ?? null;
    setAll(initial.all);
    setDeptIds(initial.deptIds.filter((id) => snapshot.departments.some((d) => d.deptId === id)));
    setPeople(
      initial.employeeIds
        .map((id) => snapshot.employees.find((e) => e.employeeId === id))
        .filter((e): e is OrganizationEmployeeRow => !!e)
        .map((e) => ({ employeeId: e.employeeId, name: e.name, positionName: e.positionName, deptName: deptName(e.deptId) }))
    );
  }, [open, snapshot, initial]);

  const addPerson = (emp: OrganizationEmployeeRow) => {
    setPeople((prev) => {
      if (prev.some((p) => p.employeeId === emp.employeeId)) return prev;
      const deptName = snapshot?.departments.find((d) => d.deptId === emp.deptId)?.deptName ?? null;
      return [...prev, { employeeId: emp.employeeId, name: emp.name, positionName: emp.positionName, deptName }];
    });
  };
  const addDept = (dept: DepartmentRow) => {
    setDeptIds((prev) => (prev.includes(dept.deptId) ? prev : [...prev, dept.deptId]));
  };

  const deptLabel = (id: string) => snapshot?.departments.find((d) => d.deptId === id)?.deptName ?? id;
  const selectedCount = people.length + deptIds.length;

  return (
    <CdModal open={open} onClose={onClose} title="선택 대상 지정" size="lg">
      <div className="flex flex-col gap-3">
        {/* 전사 일괄 */}
        <label className="flex items-center gap-2 text-[13px] font-bold cd-text cursor-pointer">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          전사 전체(재직자 전원)
          <span className="text-[11px] font-medium cd-text-faint">— 켜면 아래 개별 선택과 무관하게 전 직원이 표시됩니다.</span>
        </label>

        <div className={`flex flex-col lg:flex-row gap-3 min-h-0 ${all ? "opacity-40 pointer-events-none" : ""}`}>
          {/* 좌 — 조직도 트리(부서 클릭 = 부서 일괄, 인원 클릭 = 개인) */}
          <div className="flex-1 min-w-0 max-h-[48vh] overflow-y-auto rounded-xl border cd-line-c p-1">
            {snapshot ? (
              <OrganizationTree snapshot={snapshot} embedded hideHeader onSelectEmployee={addPerson} onSelectDept={addDept} />
            ) : (
              <p className="text-[12px] cd-text-faint py-6 text-center">조직도를 불러오는 중입니다.</p>
            )}
          </div>

          {/* 우 — 선택된 부서 칩 + 인원 카드 */}
          <div className="lg:w-[280px] shrink-0 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-extrabold cd-text">선택한 대상</span>
              <span className="text-[11px] font-extrabold rounded-md px-[7px] py-0.5" style={{ background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }}>
                {selectedCount}
              </span>
            </div>

            <div className="flex-1 min-h-[120px] max-h-[48vh] overflow-y-auto flex flex-col gap-1.5">
              {deptIds.map((id) => (
                <div key={id} className="flex items-center gap-2.5 rounded-xl border cd-line-c px-2.5 py-2">
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }}>
                    <Building2 className="w-3.5 h-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 leading-[1.35]">
                    <span className="block text-[13px] font-bold cd-text truncate">{deptLabel(id)}</span>
                    <span className="block text-[11px] cd-text-faint">부서 일괄(현재 소속원 자동 반영)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setDeptIds((prev) => prev.filter((x) => x !== id))}
                    className="shrink-0 p-1 rounded-md cd-text-faint hover:cd-error-text"
                    aria-label={`${deptLabel(id)} 제외`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {people.map((p) => (
                <div key={p.employeeId} className="flex items-center gap-2.5 rounded-xl border cd-line-c px-2.5 py-2">
                  <CdAvatar name={p.name} size="sm" />
                  <span className="min-w-0 flex-1 leading-[1.35]">
                    <span className="block text-[13px] font-bold cd-text truncate">
                      {p.name}
                      {p.positionName && <span className="ml-1 text-[11px] font-medium cd-text-faint">{p.positionName}</span>}
                    </span>
                    <span className="block text-[11px] cd-text-faint truncate">{p.deptName ?? "-"}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setPeople((prev) => prev.filter((x) => x.employeeId !== p.employeeId))}
                    className="shrink-0 p-1 rounded-md cd-text-faint hover:cd-error-text"
                    aria-label={`${p.name} 제외`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {deptIds.length === 0 && people.length === 0 && (
                <p className="text-[12px] cd-text-faint py-6 text-center leading-relaxed">
                  왼쪽 조직도에서 부서나 인원을 클릭하면
                  <br />
                  여기에 추가됩니다.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1 border-t cd-hairline-c">
          <p className="text-[11px] cd-text-faint flex-1">
            선택한 대상의 휴가·출장·교육 일정이 캘린더의 &lsquo;선택&rsquo; 태그로 표시됩니다. 인원 수 제한이 없습니다.
          </p>
          <CdButton size="sm" onClick={onClose}>
            취소
          </CdButton>
          <CdButton
            size="sm"
            variant="primary"
            onClick={() => onSave({ all, deptIds, employeeIds: people.map((p) => p.employeeId) })}
          >
            저장
          </CdButton>
        </div>
      </div>
    </CdModal>
  );
}
