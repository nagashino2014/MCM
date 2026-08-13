import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 홈 위젯 — 본인 반기별 성과급 지급내역(서버에서 본인 강제).
 * 로그인 user → employee 매핑이 없으면 빈 목록(403 아님 — 카드에서 안내).
 */
export async function GET() {
  try {
    const ctx = await requireSession();
    const db = await getDb();
    // user↔employee 연결은 양방향 두 가지가 공존 — 둘 다 조회
    const empRows = rowsToObjects(
      await db.exec(
        `SELECT COALESCE(u.employee_id, e2.employee_id) AS employee_id
           FROM users u
           LEFT JOIN employee_profiles e2 ON e2.user_id = u.user_id
          WHERE u.user_id = $1
          LIMIT 1`,
        [ctx.userId]
      )
    );
    const employeeId = empRows[0]?.employee_id ? String(empRows[0].employee_id) : null;
    if (!employeeId) return NextResponse.json({ rows: [], linked: false });
    const rows = rowsToObjects(
      await db.exec(
        `SELECT s.period_year, s.period_half, s.bucket, s.total_amount, s.calculated_at,
                (SELECT COUNT(*) FROM bonus_statement_lines l WHERE l.statement_id = s.statement_id) AS line_count
           FROM bonus_statements s
          WHERE s.employee_id = $1
          ORDER BY s.period_year DESC, s.period_half DESC
          LIMIT 6`,
        [employeeId]
      )
    ).map((row) => ({
      periodYear: Number(row.period_year ?? 0),
      periodHalf: String(row.period_half ?? "H1"),
      bucket: String(row.bucket ?? "participant"),
      totalAmount: Number(row.total_amount ?? 0),
      lineCount: Number(row.line_count ?? 0),
      calculatedAt: String(row.calculated_at ?? ""),
    }));
    return NextResponse.json({ rows, linked: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
