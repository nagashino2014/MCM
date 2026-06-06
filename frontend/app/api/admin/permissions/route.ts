import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireRole } from "@/lib/auth/guards";
import { listPermissionsSnapshot, savePermissionTemplate } from "@/lib/admin/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("admin");
    return NextResponse.json(await listPermissionsSnapshot());
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const body = await req.json();
    const templateId = await savePermissionTemplate(actor.userId, body);
    return NextResponse.json({ templateId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
