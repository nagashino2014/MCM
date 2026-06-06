import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireRole } from "@/lib/auth/guards";
import {
  assignPermissionTemplate,
  revokePermissionAssignment,
} from "@/lib/admin/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const body = await req.json();
    const assignmentId = await assignPermissionTemplate(actor.userId, body);
    return NextResponse.json({ assignmentId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const { searchParams } = new URL(req.url);
    const assignmentId = searchParams.get("assignmentId");
    if (!assignmentId) {
      return NextResponse.json({ error: "assignmentId가 필요합니다." }, { status: 400 });
    }
    await revokePermissionAssignment(actor.userId, assignmentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
