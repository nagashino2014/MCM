import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 설문 대상(부서) 선택용 목록 — 조직도 권한(org.view)까지 요구하지 않도록 설문 권한으로 얇게 제공한다.
export async function GET() {
  try {
    await requirePermission("survey.manage", { fallbackRoles: ["admin"] });
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT d.dept_id, d.dept_name,
                (SELECT COUNT(*) FROM employee_profiles e
                   JOIN users u ON u.user_id = e.user_id AND u.status = 'active'
                  WHERE e.dept_id = d.dept_id) AS member_count
           FROM departments d
          WHERE d.is_active = 1
          ORDER BY d.display_order ASC, d.dept_name ASC`
      )
    );
    return NextResponse.json({
      departments: rows.map((r) => ({
        deptId: String(r.dept_id),
        deptName: String(r.dept_name ?? ""),
        memberCount: Number(r.member_count ?? 0),
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
