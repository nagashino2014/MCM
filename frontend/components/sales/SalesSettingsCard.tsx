"use client";

// 영업 제설정 카드 — Salesboard 메인 하단. 영업 관련 설정을 한곳에 모은다(2026-10-19 사용자 요청).
//   - 영업 담당자 설정: 조직도에서 영업 담당자를 지정(sales.staff.manage = 대표이사·관리자).
//     지정된 인원에게만 영업/마케팅 메뉴가 열린다(tpl-sales-staff 자동 부여·회수, 298).
//   - 공공입찰 수집 소스·API & 스크래핑 소스: 기존 설정 화면으로 이동.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Globe, Radar, SlidersHorizontal, UserCog, X } from "lucide-react";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";
import { CdHelp } from "@/components/cdash/CdHelp";

export function SalesSettingsCard({
  theme,
  canManageStaff,
  onStaffChanged,
}: {
  theme: string;
  canManageStaff: boolean;
  onStaffChanged?: () => void;
}) {
  const [staffOpen, setStaffOpen] = useState(false);
  const [staffCount, setStaffCount] = useState<number | null>(null);

  const loadCount = () =>
    fetch("/api/sales/assignees", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStaffCount(d && Array.isArray(d.manualIds) ? d.manualIds.length : null))
      .catch(() => setStaffCount(null));

  useEffect(() => {
    loadCount();
  }, []);

  return (
    <section className="cd-card-bg rounded-2xl border cd-border-c p-4 w-full mt-3">
      <div className="flex items-center gap-2 mb-3">
        <SlidersHorizontal className="w-4 h-4 cd-text-muted" />
        <h2 className="cd-text text-sm font-extrabold">영업 제설정</h2>
        <CdHelp label="영업 제설정 도움말">
          영업 담당자로 지정된 인원과 대표이사·관리자에게만 영업/마케팅 메뉴가 열립니다. 지정·해제는 대상자가 다시
          로그인하면 메뉴에 반영됩니다. 수집 소스는 공공입찰·인텔 화면의 소스 관리로 이동합니다.
        </CdHelp>
      </div>
      <div className="flex flex-wrap gap-2">
        {canManageStaff && (
          <button className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => setStaffOpen(true)}>
            <UserCog className="w-4 h-4" /> 영업 담당자 설정
            {staffCount != null && <span className="cd-text-muted text-xs">({staffCount}명)</span>}
          </button>
        )}
        <Link href="/sales/bids/sources" className="cd-btn cd-btn-ghost cd-btn-sm cd-action">
          <Globe className="w-4 h-4" /> 공공입찰 수집 소스
        </Link>
        <Link href="/sales/intel/sources" className="cd-btn cd-btn-ghost cd-btn-sm cd-action">
          <Radar className="w-4 h-4" /> API & 스크래핑 소스
        </Link>
      </div>

      {staffOpen && (
        <SalesStaffModal
          theme={theme}
          onClose={() => setStaffOpen(false)}
          onSaved={() => {
            setStaffOpen(false);
            loadCount();
            onStaffChanged?.();
          }}
        />
      )}
    </section>
  );
}

function SalesStaffModal({ theme, onClose, onSaved }: { theme: string; onClose: () => void; onSaved: () => void }) {
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/sales/org", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/sales/assignees", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([org, a]) => {
        setSnapshot(org && Array.isArray(org.departments) ? org : null);
        const ids = new Set<string>(a && Array.isArray(a.manualIds) ? a.manualIds.map(String) : []);
        setPicked(ids);
        setInitial(new Set(ids));
      })
      .catch(() => setError("조직도를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, []);

  const nameById = useMemo(
    () => new Map((snapshot?.employees ?? []).map((e) => [e.employeeId, e.name] as const)),
    [snapshot]
  );
  const added = [...picked].filter((id) => !initial.has(id));
  const removed = [...initial].filter((id) => !picked.has(id));

  const toggle = (emp: OrganizationEmployeeRow) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(emp.employeeId)) next.delete(emp.employeeId);
      else next.add(emp.employeeId);
      return next;
    });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/sales/assignees", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeIds: [...picked] }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? `저장에 실패했습니다(HTTP ${res.status}).`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="cd-modal-overlay cdash cd-fields-white" data-theme={theme} onClick={onClose}>
      <div
        className="cd-modal cd-card-bg w-full"
        style={{ maxWidth: 560, padding: "1.25rem", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="cd-text text-lg font-extrabold">영업 담당자 설정</h3>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose} aria-label="닫기"><X className="w-4 h-4" /></button>
        </div>
        <div className="cd-text-faint text-xs mb-3">
          체크한 인원이 영업 담당자가 되고 영업/마케팅 메뉴가 열립니다. 체크를 해제하면 메뉴 권한도 회수됩니다.
          대표이사·관리자는 지정과 관계없이 메뉴를 봅니다. 변경은 대상자가 다시 로그인하면 반영됩니다.
        </div>

        {loading ? (
          <div className="cd-text-faint text-sm p-4">불러오는 중…</div>
        ) : (
          <OrganizationTree
            snapshot={snapshot}
            embedded
            title="조직도"
            employeeCheckbox
            checkedEmployeeIds={picked}
            onSelectEmployee={toggle}
          />
        )}

        <div className="flex flex-wrap gap-1 mt-3">
          {[...picked].map((id) => (
            <span key={id} className="cd-action cd-pill cd-pill-info inline-flex items-center gap-1">
              {nameById.get(id) ?? id}
              <button onClick={() => toggle({ employeeId: id } as OrganizationEmployeeRow)} aria-label="해제"><X className="w-3 h-3" /></button>
            </span>
          ))}
          {picked.size === 0 && <span className="cd-text-faint text-xs">지정된 영업 담당자가 없습니다.</span>}
        </div>

        {(added.length > 0 || removed.length > 0) && (
          <div className="cd-text-muted text-xs mt-2">
            {added.length > 0 && <>추가 {added.length}명 </>}
            {removed.length > 0 && <>· 해제 {removed.length}명(메뉴 권한 회수)</>}
          </div>
        )}
        {error && <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-sm mt-3">{error}</div>}

        <div className="flex justify-end gap-2 mt-4">
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>취소</button>
          <button
            className="cd-btn cd-btn-primary cd-btn-sm"
            onClick={save}
            disabled={saving || loading || (added.length === 0 && removed.length === 0)}
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
