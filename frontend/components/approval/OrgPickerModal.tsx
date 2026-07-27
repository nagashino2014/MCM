"use client";

// 조직도 인원 선택 모달(공용, G3) — 결재선/참조·열람(기안 작성)과 양식 user_select 필드가 공유한다.
// 스냅샷(/api/sales/org)은 모듈 캐시로 세션 중 1회만 로드한다(모달을 여러 곳에서 열어도 재요청 없음).

import { useEffect, useState } from "react";
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
}: {
  open: boolean;
  title: string;
  /** 하단 안내문(선택) — 복수 선택 안내 등 */
  hint?: string;
  onClose: () => void;
  /** 인원 클릭 시 호출 — 닫기 여부는 호출측이 결정(복수 선택은 유지) */
  onSelect: (emp: OrganizationEmployeeRow) => void;
}) {
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(snapshotCache);

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
        // 무시 — 로딩 안내 유지
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <CdModal open={open} onClose={onClose} title={title} size="md">
      <div className="flex flex-col gap-2">
        {snapshot ? (
          <OrganizationTree snapshot={snapshot} embedded hideHeader onSelectEmployee={onSelect} />
        ) : (
          <p className="text-[12px] cd-text-faint py-6 text-center">조직도를 불러오는 중입니다.</p>
        )}
        {hint && <p className="text-[10px] cd-text-faint">{hint}</p>}
      </div>
    </CdModal>
  );
}
