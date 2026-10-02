import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listOrganizationSnapshot } from "@/lib/admin/organization";
import {
  RECORD_PERMISSION,
  loadRecordCounts,
  loadRecordProfile,
  loadStaffRecordDetail,
  resolveRecordScope,
  scopeAllowsDept,
} from "@/lib/staffing/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * 수행인력 실적.
 *  GET              → 열람 범위에 맞춘 조직 스냅샷 + 직원별 수행 용역 건수(트리 뱃지)
 *  GET ?employeeId= → 그 인력의 수행 용역 이력·세분류별 개인/전사 평균 수행기간
 * 범위: 관리자·임원 전사 / 부서장 소속 부서(하위 포함) / 그 외 403.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission(RECORD_PERMISSION);
    const scope = await resolveRecordScope(ctx.userId);
    if (scope.kind === "none") throw new AuthError("이 작업을 수행할 권한이 없습니다.", 403);

    const employeeId = req.nextUrl.searchParams.get("employeeId")?.trim();
    if (employeeId) {
      const profile = await loadRecordProfile(employeeId);
      if (!profile) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
      if (!scopeAllowsDept(scope, profile.deptId)) throw new AuthError("소속 부서원의 실적만 조회할 수 있습니다.", 403);
      return NextResponse.json(await loadStaffRecordDetail(employeeId));
    }

    const [snapshot, counts] = await Promise.all([listOrganizationSnapshot(), loadRecordCounts()]);
    if (scope.kind === "dept") {
      const allowed = new Set(scope.deptIds);
      snapshot.departments = snapshot.departments.filter((d) => allowed.has(d.deptId));
      snapshot.employees = snapshot.employees.filter((e) => e.deptId != null && allowed.has(e.deptId));
      snapshot.departmentPositions = snapshot.departmentPositions.filter((d) => allowed.has(d.deptId));
      const visible = new Set(snapshot.employees.map((e) => e.employeeId));
      for (const id of Object.keys(counts)) if (!visible.has(id)) delete counts[id];
    }
    return NextResponse.json({ scope: scope.kind, snapshot, counts });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
