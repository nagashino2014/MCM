"use client";

import { useEffect, useState } from "react";
import WorkPlanEditor from "@/components/work-plan/WorkPlanEditor";
import type { OrganizationSnapshot } from "@/lib/admin/organization";
import type { WorkPlanTemplateRow } from "@/lib/work-plan/reports";

interface Meta {
  templates: WorkPlanTemplateRow[];
  organization: OrganizationSnapshot;
}

export default function NewWorkPlanPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/work-plan", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d?.organization) {
          throw new Error(d?.error || "양식·조직 정보를 불러오지 못했습니다. (DB 마이그레이션 적용 여부를 확인하세요)");
        }
        return d;
      })
      .then((d) => setMeta({ templates: d.templates ?? [], organization: d.organization }))
      .catch((err) => setError((err as Error).message));
  }, []);

  if (error) {
    return <div className="p-8 text-sm cd-error-text">{error}</div>;
  }
  if (!meta) {
    return <div className="p-8 text-sm cd-text-faint">불러오는 중…</div>;
  }
  return <WorkPlanEditor mode="new" templates={meta.templates} organization={meta.organization} />;
}
