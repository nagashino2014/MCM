import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireRole } from "@/lib/auth/guards";
import { deletePosition, savePosition } from "@/lib/admin/organization";
import { recordAuditLog } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const body = await req.json();
    const position = await savePosition(body);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "employee_update",
      targetTable: "positions",
      targetId: position.positionId,
      after: position,
    });
    return NextResponse.json({ position });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const { searchParams } = new URL(req.url);
    const positionId = searchParams.get("positionId");
    if (!positionId) {
      return NextResponse.json({ error: "positionId가 필요합니다." }, { status: 400 });
    }
    await deletePosition(positionId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "employee_update",
      targetTable: "positions",
      targetId: positionId,
      after: { deleted: true },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
