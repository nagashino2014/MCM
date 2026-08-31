import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { BonusPeriod } from "@/lib/bonus/source";
import { listStatementsOverview } from "@/lib/bonus/statements";
import { saveDoc } from "@/lib/approval/docs";

/**
 * 성과급 지급 계획 기안 (블루프린트 §6)
 * - 일괄산정 결과(전체 명세)를 표로 담은 1장짜리 지급 계획서를 draft 로 생성한다.
 * - 결재선 = 대표이사 직결(다른 결재선 불필요 확정). 상신은 기안 화면에서 검토 후 사용자가 직접.
 * - 생성한 문서는 bonus_period_settings.plan_doc_id 에 물린다 — 명세서 발송은 이 문서가
 *   'approved' 가 된 뒤에만 가능하다(2026-08-31 사용자 확정 게이트, lib/bonus/send.ts).
 */

export const BONUS_PLAN_FORM_ID = "frm-bonus-plan";

async function findCeoUserId(): Promise<string | null> {
  const db = await getDb();
  // user↔employee 연결이 양방향 두 가지로 공존하므로 둘 다 조회
  const rows = rowsToObjects(
    await db.exec(
      `SELECT u.user_id
         FROM users u
         LEFT JOIN employee_profiles e1 ON e1.employee_id = u.employee_id
         LEFT JOIN employee_profiles e2 ON e2.user_id = u.user_id
        WHERE e1.position_id = 'ceo' OR e2.position_id = 'ceo'
        LIMIT 1`
    )
  );
  return rows[0]?.user_id ? String(rows[0].user_id) : null;
}

export async function createBonusPlanDraft(
  actorUserId: string,
  p: BonusPeriod
): Promise<{ docId: string }> {
  const overview = await listStatementsOverview(p);
  if (!overview.length) {
    throw Object.assign(new Error("산정 결과가 없습니다. 먼저 일괄산정을 실행하세요."), { status: 400 });
  }
  const ceoUserId = await findCeoUserId();
  if (!ceoUserId) {
    throw Object.assign(new Error("대표이사 계정을 찾을 수 없습니다(직급 'ceo'와 사용자 연결 필요)."), {
      status: 400,
    });
  }
  const label = `${p.year}년 ${p.half === "H1" ? "상반기" : "하반기"}`;
  const total = overview.reduce((a, b) => a + b.totalAmount, 0);
  // 표/총액은 화면 표시 그대로 쓰이므로 천단위 콤마 문자열로 채운다(양식 렌더러는 값 무가공 표시).
  const fmt = (v: number) => Math.round(v).toLocaleString("ko-KR");
  const docId = await saveDoc({
    docId: null,
    formId: BONUS_PLAN_FORM_ID,
    title: `${label} 성과급 지급 계획`,
    urgent: false,
    fieldValues: {
      period: label,
      total: fmt(total),
      headcount: overview.length,
      rows: overview.map((r) => {
        const cur = Math.round(r.totalAmount);
        const prev = r.prevAmount != null ? Math.round(r.prevAmount) : null;
        const rate =
          prev != null && prev !== 0 ? ((cur - prev) / prev) * 100 : null;
        return {
          name: r.employeeName,
          dept: r.deptName ?? "-",
          position: r.positionName ?? "-",
          amount: fmt(cur),
          prev_amount: prev != null ? fmt(prev) : "-",
          change: rate != null ? `${rate >= 0 ? "+" : ""}${rate.toFixed(1)}%` : "-",
        };
      }),
      note: "",
    },
    line: [{ stepType: "approve", assigneeUserId: ceoUserId }],
    actorUserId,
  });
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO bonus_period_settings (period_year, period_half, plan_doc_id, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now()::text)
       ON CONFLICT (period_year, period_half) DO UPDATE SET
         plan_doc_id = EXCLUDED.plan_doc_id,
         updated_by = EXCLUDED.updated_by,
         updated_at = EXCLUDED.updated_at`,
      [p.year, p.half, docId, actorUserId]
    );
  });
  return { docId };
}

export interface BonusPlanApproval {
  docId: string;
  docNo: string | null;
  /** approval_docs.status — draft|in_progress|approved|rejected|canceled */
  status: string;
  title: string;
  submittedAt: string | null;
  completedAt: string | null;
}

/** 반기 성과급 기안 문서의 현재 상태(없으면 null) — 명세서 발송 게이트·화면 배지의 근거. */
export async function getBonusPlanApproval(p: BonusPeriod): Promise<BonusPlanApproval | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.doc_no, d.status, d.title, d.submitted_at, d.completed_at
         FROM bonus_period_settings s
         JOIN approval_docs d ON d.doc_id = s.plan_doc_id
        WHERE s.period_year = $1 AND s.period_half = $2`,
      [p.year, p.half]
    )
  );
  const row = rows[0];
  if (!row) return null;
  return {
    docId: String(row.doc_id),
    docNo: row.doc_no != null ? String(row.doc_no) : null,
    status: String(row.status ?? "draft"),
    title: String(row.title ?? ""),
    submittedAt: row.submitted_at != null ? String(row.submitted_at) : null,
    completedAt: row.completed_at != null ? String(row.completed_at) : null,
  };
}
