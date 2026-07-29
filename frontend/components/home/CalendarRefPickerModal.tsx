"use client";

// 홈 캘린더 '참조 지정' 모달(HC-A) — 좌: 조직도 트리, 우: 선택된 인원 카드 + 태그.
// 트리에서 인원(자식 노드)을 누를 때마다 우측에 태그가 생기고, 태그의 × 로 제거한다.
// 최대 10명. 저장은 home_layouts.calendar_refs(사용자 설정)로 서버에 남는다.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdButton } from "@/components/cdash/CdButton";
import { CdAvatar } from "@/components/cdash/CdAvatar";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";

export const MAX_CALENDAR_REFS = 10;

/** 조직도 스냅샷은 세션 중 1회만 받는다(OrgPickerModal 과 같은 관례). */
let snapshotCache: OrganizationSnapshot | null = null;

export interface CalendarRef {
  employeeId: string;
  name: string;
  positionName: string | null;
  deptName: string | null;
}

export function CalendarRefPickerModal({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: string[];
  onClose: () => void;
  onSave: (employeeIds: string[]) => void;
}) {
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(snapshotCache);
  const [picked, setPicked] = useState<CalendarRef[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open || snapshotCache) return;
    let cancelled = false;
    fetch("/api/sales/org", { cache: "no-store" })
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

  // 열 때마다 저장된 참조 인원을 스냅샷으로 복원한다.
  useEffect(() => {
    if (!open || !snapshot) return;
    const deptName = (deptId: string | null) =>
      snapshot.departments.find((d) => d.deptId === deptId)?.deptName ?? null;
    setPicked(
      initial
        .map((id) => snapshot.employees.find((e) => e.employeeId === id))
        .filter((e): e is OrganizationEmployeeRow => !!e)
        .map((e) => ({
          employeeId: e.employeeId,
          name: e.name,
          positionName: e.positionName,
          deptName: deptName(e.deptId),
        }))
    );
    setNotice(null);
  }, [open, snapshot, initial]);

  const add = (emp: OrganizationEmployeeRow) => {
    setNotice(null);
    setPicked((prev) => {
      if (prev.some((p) => p.employeeId === emp.employeeId)) return prev;
      if (prev.length >= MAX_CALENDAR_REFS) {
        setNotice(`최대 ${MAX_CALENDAR_REFS}명까지 선택할 수 있습니다.`);
        return prev;
      }
      const deptName = snapshot?.departments.find((d) => d.deptId === emp.deptId)?.deptName ?? null;
      return [...prev, { employeeId: emp.employeeId, name: emp.name, positionName: emp.positionName, deptName }];
    });
  };

  const remove = (employeeId: string) => {
    setNotice(null);
    setPicked((prev) => prev.filter((p) => p.employeeId !== employeeId));
  };

  return (
    <CdModal open={open} onClose={onClose} title="참조 지정" size="lg">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row gap-3 min-h-0">
          {/* 좌 — 조직도 트리 */}
          <div className="flex-1 min-w-0 max-h-[52vh] overflow-y-auto rounded-xl border cd-line-c p-1">
            {snapshot ? (
              <OrganizationTree snapshot={snapshot} embedded hideHeader onSelectEmployee={add} />
            ) : (
              <p className="text-[12px] cd-text-faint py-6 text-center">조직도를 불러오는 중입니다.</p>
            )}
          </div>

          {/* 우 — 선택 인원 */}
          <div className="lg:w-[280px] shrink-0 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-extrabold cd-text">선택한 인원</span>
              <span
                className="text-[11px] font-extrabold rounded-md px-[7px] py-0.5"
                style={{
                  background: "var(--cd-primary-soft)",
                  color: picked.length >= MAX_CALENDAR_REFS ? "var(--cd-warning)" : "var(--cd-primary)",
                }}
              >
                {picked.length} / {MAX_CALENDAR_REFS}
              </span>
            </div>

            <div className="flex-1 min-h-[120px] max-h-[52vh] overflow-y-auto flex flex-col gap-1.5">
              {picked.length === 0 ? (
                <p className="text-[12px] cd-text-faint py-6 text-center leading-relaxed">
                  왼쪽 조직도에서 인원을 클릭하면
                  <br />
                  여기에 추가됩니다.
                </p>
              ) : (
                picked.map((p) => (
                  <div key={p.employeeId} className="flex items-center gap-2.5 rounded-xl border cd-line-c px-2.5 py-2">
                    <CdAvatar name={p.name} size="sm" />
                    <span className="min-w-0 flex-1 leading-[1.35]">
                      <span className="block text-[13px] font-bold cd-text truncate">
                        {p.name}
                        {p.positionName && (
                          <span className="ml-1 text-[11px] font-medium cd-text-faint">{p.positionName}</span>
                        )}
                      </span>
                      <span className="block text-[11px] cd-text-faint truncate">{p.deptName ?? "-"}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(p.employeeId)}
                      className="shrink-0 p-1 rounded-md cd-text-faint hover:cd-error-text"
                      aria-label={`${p.name} 제외`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {notice && <p className="text-[12px] cd-error-text font-semibold">{notice}</p>}

        <div className="flex items-center gap-2 pt-1 border-t cd-hairline-c">
          <p className="text-[11px] cd-text-faint flex-1">
            선택한 인원의 휴가 일정이 캘린더의 &lsquo;선택&rsquo; 태그로 표시됩니다.
          </p>
          <CdButton size="sm" onClick={onClose}>
            취소
          </CdButton>
          <CdButton size="sm" variant="primary" onClick={() => onSave(picked.map((p) => p.employeeId))}>
            저장
          </CdButton>
        </div>
      </div>
    </CdModal>
  );
}
