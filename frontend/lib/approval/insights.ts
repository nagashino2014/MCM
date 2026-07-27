/**
 * 전자결재 인사이트(AX-P1) — 결재 소요시간·단계 체류·반려율·병목 산출(admin 대시보드).
 * AX-P2~P3 AI 레이어의 ROI 베이스라인(도입 전 반려율·소요시간)이 된다.
 * 타임스탬프는 ISO text → ::timestamptz 캐스팅 후 epoch 차로 시간 계산.
 * 설계: docs/e-approval-differentiation-blueprint.md §9-2.
 */
import { getDb, rowsToObjects } from "@/lib/db";

export interface ApprovalInsights {
  kpis: {
    inProgress: number;
    avgProcessingHours: number | null; // 완료 문서 상신→완료(최근 90일)
    rejectRatePct: number | null; // 최근 90일 완료 중 반려 비율
    avgDwellHours: number | null; // 단계 활성→처리(최근 90일)
  };
  monthly: { month: string; submitted: number; rejected: number; rejectRatePct: number; avgProcessingHours: number | null }[];
  approvers: { name: string; handled: number; avgDwellHours: number | null }[];
  forms: { formName: string; count: number; avgProcessingHours: number | null }[];
}

function round1(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

export async function getApprovalInsights(): Promise<ApprovalInsights> {
  const db = await getDb();
  const since90 = new Date(Date.now() - 90 * 86400000).toISOString();

  // KPI: 진행 중 건수
  const inProg = rowsToObjects(await db.exec(`SELECT count(*) AS c FROM approval_docs WHERE status = 'in_progress'`));

  // KPI: 최근 90일 완료 문서 평균 소요시간 + 반려율
  const proc = rowsToObjects(
    await db.exec(
      `SELECT
         avg(EXTRACT(EPOCH FROM (completed_at::timestamptz - submitted_at::timestamptz)) / 3600.0) AS avg_hours,
         count(*) AS total,
         count(*) FILTER (WHERE status = 'rejected') AS rejected
       FROM approval_docs
       WHERE status IN ('approved','rejected') AND completed_at IS NOT NULL AND submitted_at IS NOT NULL
         AND completed_at >= $1`,
      [since90]
    )
  );
  const p = proc[0] ?? {};
  const total90 = Number(p.total ?? 0);
  const rejected90 = Number(p.rejected ?? 0);

  // KPI: 최근 90일 단계 평균 체류시간
  const dwell = rowsToObjects(
    await db.exec(
      `SELECT avg(EXTRACT(EPOCH FROM (acted_at::timestamptz - activated_at::timestamptz)) / 3600.0) AS avg_hours
         FROM approval_steps
        WHERE status IN ('approved','rejected') AND acted_at IS NOT NULL AND activated_at IS NOT NULL
          AND acted_at >= $1`,
      [since90]
    )
  );

  // 월별(최근 12개월) 상신·반려·평균 소요
  const monthly = rowsToObjects(
    await db.exec(
      `SELECT to_char(submitted_at::timestamptz, 'YYYY-MM') AS month,
              count(*) AS submitted,
              count(*) FILTER (WHERE status = 'rejected') AS rejected,
              avg(EXTRACT(EPOCH FROM (completed_at::timestamptz - submitted_at::timestamptz)) / 3600.0)
                FILTER (WHERE status IN ('approved','rejected') AND completed_at IS NOT NULL) AS avg_hours
         FROM approval_docs
        WHERE submitted_at IS NOT NULL AND submitted_at::timestamptz >= now() - interval '12 months'
        GROUP BY 1 ORDER BY 1`
    )
  );

  // 결재자별(최근 90일 처리) 평균 체류
  const approvers = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(assignee_name, assignee_user_id) AS name,
              count(*) AS handled,
              avg(EXTRACT(EPOCH FROM (acted_at::timestamptz - activated_at::timestamptz)) / 3600.0) AS avg_hours
         FROM approval_steps
        WHERE status IN ('approved','rejected') AND acted_at IS NOT NULL AND activated_at IS NOT NULL
          AND acted_at >= $1
        GROUP BY 1 ORDER BY avg_hours DESC NULLS LAST LIMIT 15`,
      [since90]
    )
  );

  // 양식별 건수·평균 소요(최근 90일 상신)
  const forms = rowsToObjects(
    await db.exec(
      `SELECT f.name AS form_name, count(*) AS cnt,
              avg(EXTRACT(EPOCH FROM (d.completed_at::timestamptz - d.submitted_at::timestamptz)) / 3600.0)
                FILTER (WHERE d.status IN ('approved','rejected') AND d.completed_at IS NOT NULL) AS avg_hours
         FROM approval_docs d JOIN approval_forms f ON f.form_id = d.form_id
        WHERE d.submitted_at IS NOT NULL AND d.submitted_at >= $1
        GROUP BY f.name ORDER BY cnt DESC LIMIT 15`,
      [since90]
    )
  );

  return {
    kpis: {
      inProgress: Number(inProg[0]?.c ?? 0),
      avgProcessingHours: round1(p.avg_hours),
      rejectRatePct: total90 > 0 ? Math.round((rejected90 / total90) * 1000) / 10 : null,
      avgDwellHours: round1(dwell[0]?.avg_hours),
    },
    monthly: monthly.map((r) => {
      const sub = Number(r.submitted ?? 0);
      const rej = Number(r.rejected ?? 0);
      return {
        month: String(r.month ?? ""),
        submitted: sub,
        rejected: rej,
        rejectRatePct: sub > 0 ? Math.round((rej / sub) * 1000) / 10 : 0,
        avgProcessingHours: round1(r.avg_hours),
      };
    }),
    approvers: approvers.map((r) => ({
      name: String(r.name ?? "-"),
      handled: Number(r.handled ?? 0),
      avgDwellHours: round1(r.avg_hours),
    })),
    forms: forms.map((r) => ({
      formName: String(r.form_name ?? "-"),
      count: Number(r.cnt ?? 0),
      avgProcessingHours: round1(r.avg_hours),
    })),
  };
}
