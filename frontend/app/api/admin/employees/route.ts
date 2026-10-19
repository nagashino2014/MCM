import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { filterEmployeesByScope } from "@/lib/auth/scope-guards";
import { loadUserAccess } from "@/lib/auth/rbac";
import { listEmployees, saveEmployeeDetail } from "@/lib/admin/employee-records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requirePermission("staffing.view", { fallbackRoles: ["admin"] });
    // 목록은 범위로 거른다 — 전사(all) 전체 / 부서장(self_dept) 소속 부서 / 사원(self) 본인 행만(2026-10-19 §7.7).
    const items = filterEmployeesByScope(await loadUserAccess(ctx.userId), "staffing.view", await listEmployees());
    return NextResponse.json({ items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("staffing.edit", { fallbackRoles: ["admin"] });
    const body = await req.json();
    const employeeId = await saveEmployeeDetail(actor.userId, body);
    return NextResponse.json({ employeeId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
