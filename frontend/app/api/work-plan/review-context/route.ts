import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { getReporterContext } from "@/lib/work-plan/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 부서장 감독/머지 권한 컨텍스트.
//  - admin: 전체 부서 선택 가능(departments 동봉, deptId=null → 클라가 선택).
//  - non-admin(부서장 포함): 자기 소속 부서로 고정(deptId), departments 미동봉.
export async function GET() {
  try {
    const ctx = await requireSession();
    const isAdmin = ctx.role === "admin";
    const reporter = await getReporterContext(ctx.userId);

    let departments: { deptId: string; deptName: string }[] | undefined;
    if (isAdmin) {
      const db = await getDb();
      const r = await db.exec(
        "SELECT dept_id, dept_name FROM departments WHERE is_active = 1 ORDER BY display_order ASC, dept_name ASC"
      );
      departments = rowsToObjects(r).map((row) => ({ deptId: String(row.dept_id ?? ""), deptName: String(row.dept_name ?? "") }));
    }

    return NextResponse.json({
      isAdmin,
      deptId: isAdmin ? null : reporter.deptId,
      deptName: reporter.deptName,
      departments,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
