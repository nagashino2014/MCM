import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { deleteAdvisor, listAdvisors, saveAdvisor, type CatalogAdvisor } from "@/lib/catalog/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 자문위원 추가·수정(advisorId 있으면 수정)
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as Partial<CatalogAdvisor>;
    const saved = await saveAdvisor({ ...body, name: String(body.name ?? "") }, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_advisors",
      targetId: saved.advisorId,
      after: { name: saved.name, isPublic: saved.isPublic },
    });
    return NextResponse.json({ advisor: saved, advisors: await listAdvisors() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 자문위원 삭제 ?advisorId=
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const advisorId = String(req.nextUrl.searchParams.get("advisorId") ?? "");
    if (!advisorId) return NextResponse.json({ error: "advisorId 가 필요합니다." }, { status: 400 });
    await deleteAdvisor(advisorId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_advisors",
      targetId: advisorId,
      after: { deleted: true },
    });
    return NextResponse.json({ advisors: await listAdvisors() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
