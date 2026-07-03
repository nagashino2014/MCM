"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { ScheduleModal } from "./ScheduleModal";
import { ACTIVITY_TYPE_META, SALES_ACTIVITY_TYPE_LABELS, type SalesActivity, type SalesProjectMember } from "@/lib/sales/types";
import type { OrganizationSnapshot } from "@/components/admin/users/types";

interface Report {
  projectId: string;
  title: string;
  facilityId: string;
  facilityName: string | null;
  members: SalesProjectMember[];
  activities: SalesActivity[];
}
type Person = { id: number; personName: string; title: string | null; status: string };

const dLabel = (a: SalesActivity) => {
  const s = (a.scheduledAt ?? a.occurredAt ?? a.createdAt).slice(5, 10).replace("-", ".");
  const e = a.endedAt ? a.endedAt.slice(5, 10).replace("-", ".") : null;
  return e && e !== s ? `${s} ~ ${e}` : s;
};

/** 경과 보고 대상 리스트 모달 — 좌: 영업 건 리스트 / 우: 해당 건의 미보고 일정 목록. 일정 클릭 시 스케쥴 수정(경과 입력). */
export function ProgressReportModal({ theme, onClose, onReported }: { theme: string; onClose: () => void; onReported?: () => void }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [selProject, setSelProject] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [editing, setEditing] = useState<{ report: Report; activity: SalesActivity } | null>(null);

  const loadReports = useCallback(() => {
    fetch("/api/sales/pending-reports", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { reports: [] }))
      .then((d) => {
        const list: Report[] = Array.isArray(d.reports) ? d.reports : [];
        setReports(list);
        setSelProject((prev) => (prev && list.some((r) => r.projectId === prev) ? prev : list[0]?.projectId ?? null));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadReports();
    fetch("/api/sales/org", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSnapshot(d && Array.isArray(d.departments) ? d : null))
      .catch(() => {});
  }, [loadReports]);

  const cur = reports.find((r) => r.projectId === selProject) ?? null;

  const openEdit = async (report: Report, activity: SalesActivity) => {
    try {
      const res = await fetch(`/api/facilities/${report.facilityId}/contacts`, { cache: "no-store" });
      const d = await res.json().catch(() => ({ people: [] }));
      setPeople(Array.isArray(d.people) ? d.people : []);
    } catch {
      setPeople([]);
    }
    setEditing({ report, activity });
  };

  return (
    <div className="cd-modal-overlay cdash cd-fields-white" data-theme={theme} onClick={onClose}>
      <div className="cd-modal cd-card-bg w-full flex flex-col" style={{ maxWidth: 900, height: "78vh", padding: "1.25rem" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h3 className="cd-text text-lg font-extrabold">경과 보고 대상</h3>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 min-h-0 flex gap-3">
          {/* 좌: 영업 건 리스트 */}
          <div className="w-64 shrink-0 flex flex-col rounded-2xl border cd-border-c p-3 min-h-0">
            <h4 className="cd-text font-bold text-sm mb-2 shrink-0">영업 건 리스트</h4>
            <div className="flex flex-col gap-1.5 overflow-y-auto scrollbar-hide">
              {reports.map((r) => {
                const on = r.projectId === selProject;
                return (
                  <button key={r.projectId} type="button" onClick={() => setSelProject(r.projectId)}
                    className="text-left rounded-xl border p-2.5 transition"
                    style={on
                      ? { background: "var(--cd-primary-soft)", borderColor: "var(--cd-primary)" }
                      : { background: "var(--cd-card)", borderColor: "var(--cd-border)" }}>
                    <div className="cd-text text-sm font-bold truncate">{r.title}</div>
                    <div className="cd-text-faint text-[11px] truncate">{r.facilityName ?? ""} · 미보고 {r.activities.length}건</div>
                  </button>
                );
              })}
              {reports.length === 0 && <div className="cd-text-faint text-xs py-6 text-center">경과 보고 대상이 없습니다.</div>}
            </div>
          </div>

          {/* 우: 일정 목록(미보고) */}
          <div className="flex-1 min-w-0 flex flex-col rounded-2xl border cd-border-c p-3 min-h-0">
            <h4 className="cd-text font-bold text-sm mb-2 shrink-0">일정 목록 <span className="cd-text-faint font-normal text-xs">— 스케쥴을 클릭하면 경과를 입력합니다</span></h4>
            <div className="flex flex-col gap-2 overflow-y-auto scrollbar-hide">
              {cur?.activities.map((a) => {
                const color = ACTIVITY_TYPE_META[a.activityType].color;
                const actors = (a.assignees ?? []).filter((x) => x.roleKind === "attendee").map((x) => x.employeeName).filter(Boolean).join(", ");
                return (
                  <button key={a.activityId} type="button" onClick={() => openEdit(cur, a)}
                    className="flex items-center gap-3 w-full text-left rounded-xl border cd-border-c p-3 cd-row-hover">
                    <span className="w-8 h-3 rounded-full shrink-0" style={{ background: color }} />
                    <span className="cd-text-muted text-xs shrink-0 tabular-nums">{dLabel(a)}</span>
                    <div className="flex-1 min-w-0 text-right">
                      <div className="cd-text text-sm font-bold truncate">{SALES_ACTIVITY_TYPE_LABELS[a.activityType]}</div>
                      {actors && <div className="cd-text-faint text-[11px] truncate">{actors}</div>}
                    </div>
                  </button>
                );
              })}
              {cur && cur.activities.length === 0 && <div className="cd-text-faint text-xs py-6 text-center">미보고 일정이 없습니다.</div>}
              {!cur && <div className="cd-text-faint text-xs py-6 text-center">좌측에서 영업 건을 선택하세요.</div>}
            </div>
          </div>
        </div>
      </div>

      {editing && (
        <ScheduleModal
          theme={theme}
          projectId={editing.report.projectId}
          activity={editing.activity}
          people={people}
          snapshot={snapshot}
          members={editing.report.members}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadReports(); onReported?.(); }}
        />
      )}
    </div>
  );
}
