import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireRole } from "@/lib/auth/guards";
import { getEmployeeDetail, saveEmployeeDetail } from "@/lib/admin/employee-records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requireRole("admin");
    const { id } = await ctx.params;
    const employee = await getEmployeeDetail(id);
    if (!employee) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ employee });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireRole("admin");
    const { id } = await ctx.params;
    const body = await req.json();
    const employeeId = await saveEmployeeDetail(actor.userId, { ...body, employeeId: id });
    return NextResponse.json({ employeeId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
