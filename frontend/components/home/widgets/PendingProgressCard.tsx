"use client";

import { useState } from "react";
import { PencilLine } from "lucide-react";
import { HomeCard, HomeRow } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";
import { ProgressReportModal } from "@/components/sales/ProgressReportModal";

interface PendingReport {
  projectId: string;
  title: string;
  facilityId: string | null;
  facilityName: string | null;
  activities: unknown[];
}

/** H2 — 경과 미입력. 목록 요약 + ProgressReportModal 재사용. */
export function PendingProgressCard({ theme }: { theme: string }) {
  const w = useHomeWidget<{ reports: PendingReport[] }>("/api/sales/pending-reports");
  const [open, setOpen] = useState(false);
  if (w.status === "forbidden") return null;
  const reports = w.status === "ok" ? w.data.reports : [];
  const totalActivities = reports.reduce((sum, r) => sum + (r.activities?.length ?? 0), 0);

  return (
    <>
      <HomeCard
        icon={<PencilLine className="w-4 h-4" />}
        title="경과 미입력"
        count={totalActivities}
        accent="#FFAE1F"
        loading={w.status === "loading"}
        error={w.status === "error" ? w.message : undefined}
        empty={w.status === "ok" && reports.length === 0}
        emptyText="경과 미입력 건이 없습니다."
        headerActions={
          reports.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold cd-text-muted hover:cd-text"
            >
              경과 입력
            </button>
          ) : undefined
        }
      >
        <ul className="flex flex-col gap-1.5">
          {reports.slice(0, 5).map((r) => (
            <li key={r.projectId}>
              <HomeRow onClick={() => setOpen(true)}>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] cd-text truncate">{r.title}</span>
                  {r.facilityName && (
                    <span className="block text-[11px] cd-text-faint truncate">{r.facilityName}</span>
                  )}
                </span>
                <span
                  className="text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0"
                  style={{ background: "color-mix(in srgb, #FFAE1F 16%, transparent)", color: "#FFAE1F" }}
                >
                  {r.activities?.length ?? 0}건
                </span>
              </HomeRow>
            </li>
          ))}
        </ul>
      </HomeCard>
      {open && (
        <ProgressReportModal
          theme={theme}
          onClose={() => setOpen(false)}
          onReported={w.reload}
        />
      )}
    </>
  );
}
