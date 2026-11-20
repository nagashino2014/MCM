"use client";

// 조직도 인원 선택 모달(공용, G3) — 결재선/참조·열람(기안 작성)과 양식 user_select 필드가 공유한다.
// 스냅샷(/api/org/snapshot, 전 직원)은 모듈 캐시로 세션 중 1회만 로드한다(모달을 여러 곳에서 열어도 재요청 없음).

import { useEffect, useState, type ReactNode } from "react";
import { CdModal } from "@/components/cdash/CdModal";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";

let snapshotCache: OrganizationSnapshot | null = null;

export function OrgPickerModal({
  open,
  title,
  hint,
  onClose,
  onSelect,
  checkedEmployeeIds,
  footer,
  size = "md",
}: {
  open: boolean;
  title: string;
  /** 하단 안내문(선택) — 복수 선택 안내 등 */
  hint?: string;
  onClose: () => void;
  /** 인원 클릭 시 호출 — 닫기 여부는 호출측이 결정(복수 선택은 유지) */
  onSelect: (emp: OrganizationEmployeeRow) => void;
  /** 지정하면 인원 노드에 체크박스가 붙는 다중 선택 모드(체크 상태는 호출측 state) */
  checkedEmployeeIds?: Iterable<string>;
  /** 모달 하단 버튼 영역(저장·닫기 등) */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(snapshotCache);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    if (snapshotCache) {
      // 한 화면에 이 모달이 여러 개 떠 있다(결재선·참조용 하나, 양식의 사용자 선택·동행자 필드마다 하나).
      // 다른 모달이 먼저 받아 캐시에 넣었으면 이 모달의 state 에도 옮긴다 — 요청만 건너뛰면 "불러오는 중"에서 멈춘다.
      setSnapshot(snapshotCache);
      return;
    }
    let cancelled = false;
    setFailed(false);
    fetch("/api/org/snapshot", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        // 캐시는 이 모달이 닫혔어도 채운다(받은 응답을 버리면 다음에 다시 받아야 한다).
        snapshotCache = d as OrganizationSnapshot;
        if (!cancelled) setSnapshot(snapshotCache);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, attempt]);

  return (
    <CdModal open={open} onClose={onClose} title={title} size={size} footer={footer}>
      <div className="flex flex-col gap-2">
        {snapshot ? (
          <OrganizationTree
            snapshot={snapshot}
            embedded
            hideHeader
            onSelectEmployee={onSelect}
            employeeCheckbox={checkedEmployeeIds !== undefined}
            checkedEmployeeIds={checkedEmployeeIds}
          />
        ) : failed ? (
          <div className="py-6 flex flex-col items-center gap-2">
            <p className="text-[12px] cd-error-text">조직도를 불러오지 못했습니다.</p>
            <button
              type="button"
              className="cd-btn border cd-border-c px-2.5 py-1.5 text-[12px]"
              onClick={() => setAttempt((n) => n + 1)}
            >
              다시 시도
            </button>
          </div>
        ) : (
          <p className="text-[12px] cd-text-faint py-6 text-center">조직도를 불러오는 중입니다.</p>
        )}
        {hint && <p className="text-[11px] cd-text-faint">{hint}</p>}
      </div>
    </CdModal>
  );
}
