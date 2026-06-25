import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listOrganizationSnapshot, saveDepartment } from "@/lib/admin/organization";
import { recordAuditLog } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("org.view", { fallbackRoles: ["admin"] });
    return NextResponse.json(await listOrganizationSnapshot());
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("org.edit", { fallbackRoles: ["admin"] });
    const body = await req.json();
    const department = await saveDepartment(body);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "employee_update",
      targetTable: "departments",
      targetId: department.deptId,
      after: department,
    });
    return NextResponse.json({ department });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
