"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import WorkPlanEditor from "@/components/work-plan/WorkPlanEditor";
import type { OrganizationSnapshot } from "@/lib/admin/organization";
import type { WorkPlanReportDetail, WorkPlanTemplateRow } from "@/lib/work-plan/reports";

interface Loaded {
  report: WorkPlanReportDetail;
  templates: WorkPlanTemplateRow[];
  organization: OrganizationSnapshot;
}

export default function EditWorkPlanPage() {
  const params = useParams<{ reportId: string }>();
  const reportId = params.reportId;
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reportId) return;
    Promise.all([
      fetch(`/api/work-plan/${reportId}`, { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("보고서를 찾을 수 없습니다.");
        return r.json();
      }),
      fetch("/api/work-plan", { cache: "no-store" }).then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d?.organization) {
          throw new Error(d?.error || "양식·조직 정보를 불러오지 못했습니다. (DB 마이그레이션 적용 여부를 확인하세요)");
        }
        return d;
      }),
    ])
      .then(([report, meta]) =>
        setData({ report, templates: meta.templates ?? [], organization: meta.organization })
      )
      .catch((err) => setError((err as Error).message));
  }, [reportId]);

  if (error) {
    return <div className="p-8 text-sm cd-error-text">{error}</div>;
  }
  if (!data) {
    return <div className="p-8 text-sm cd-text-faint">불러오는 중…</div>;
  }
  return (
    <WorkPlanEditor
      mode="edit"
      initialReport={data.report}
      templates={data.templates}
      organization={data.organization}
    />
  );
}
