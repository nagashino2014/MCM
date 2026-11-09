import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { EditionError, deleteGeneratedEdition } from "@/lib/catalog/render/editions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE: 생성본(검토용 PDF) 지우기 — catalog.manage(생성본을 만들고 보는 권한과 같다). 발행본은 409 로 거절한다.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ editionId: string }> }) {
  try {
    const actor = await requirePermission("catalog.manage");
    const { editionId } = await params;
    const removed = await deleteGeneratedEdition(editionId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_edition_delete",
      targetTable: "catalog_editions",
      targetId: editionId,
      before: removed,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof EditionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return authErrorToResponse(err);
  }
}
