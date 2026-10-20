import { loadUserAccess } from "@/lib/auth/rbac";
import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { allowedDeptIds } from "@/lib/auth/scope-guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { getReporterContext } from "@/lib/work-plan/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 부서장 감독/머지 권한 컨텍스트.
//  - admin(work_plan.view 전사): 전체 부서 선택 가능(departments 동봉, deptId=null → 클라가 선택).
//  - non-admin(부서장 포함): 자기 소속 부서로 시작(deptId). 겸직으로 부서 범위가 2개 이상이면(300)
//    그 부서들만 departments 로 동봉해 화면이 부서 선택을 보인다 — 주 소속이 첫 번째.
export async function GET() {
  try {
    const ctx = await requirePermission("work_plan.view");
    const access = await loadUserAccess(ctx.userId);
    const allowed = allowedDeptIds(access, "work_plan.view");
    const isAdmin = allowed == null;
    const reporter = await getReporterContext(ctx.userId);

    let departments: { deptId: string; deptName: string }[] | undefined;
    if (isAdmin || allowed.length > 1) {
      const db = await getDb();
      const r = await db.exec(
        `SELECT dept_id, dept_name FROM departments
          WHERE is_active = 1 AND ($1::text[] IS NULL OR dept_id = ANY($1::text[]))
          ORDER BY display_order ASC, dept_name ASC`,
        [isAdmin ? null : allowed]
      );
      departments = rowsToObjects(r).map((row) => ({ deptId: String(row.dept_id ?? ""), deptName: String(row.dept_name ?? "") }));
      if (!isAdmin) departments.sort((a, b) => allowed.indexOf(a.deptId) - allowed.indexOf(b.deptId));
    }

    return NextResponse.json({
      isAdmin,
      deptId: isAdmin ? null : (reporter.deptId ?? allowed[0] ?? null),
      deptName: reporter.deptName,
      departments,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
