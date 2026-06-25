import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listPermissionsSnapshot, savePermissionTemplate } from "@/lib/admin/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("rbac.template.manage", { fallbackRoles: ["admin"] });
    return NextResponse.json(await listPermissionsSnapshot());
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("rbac.template.manage", { fallbackRoles: ["admin"] });
    const body = await req.json();
    const templateId = await savePermissionTemplate(actor.userId, body);
    return NextResponse.json({ templateId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
