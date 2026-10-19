import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { requireEmployeeScope } from "@/lib/auth/scope-guards";
import { getEmployeeDetail, saveEmployeeDetail } from "@/lib/admin/employee-records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    await requireEmployeeScope("staffing.view", id); // 소속 부서·본인 범위(2026-10-19 §7.7)
    const employee = await getEmployeeDetail(id);
    if (!employee) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ employee });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const actor = await requireEmployeeScope("staffing.edit", id);
    const body = await req.json();
    const employeeId = await saveEmployeeDetail(actor.userId, { ...body, employeeId: id });
    return NextResponse.json({ employeeId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
