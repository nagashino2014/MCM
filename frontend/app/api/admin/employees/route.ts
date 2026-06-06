import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireRole } from "@/lib/auth/guards";
import { listEmployees, saveEmployeeDetail } from "@/lib/admin/employee-records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("admin");
    return NextResponse.json({ items: await listEmployees() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const body = await req.json();
    const employeeId = await saveEmployeeDetail(actor.userId, body);
    return NextResponse.json({ employeeId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
