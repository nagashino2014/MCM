import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { deleteExtraPerson, listExtraPeople, saveExtraPerson, type CatalogExtraPerson } from "@/lib/catalog/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 직접 입력 임원(고문 등 촉탁) 추가·수정(personId 있으면 수정)
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as Partial<CatalogExtraPerson>;
    const personId = await saveExtraPerson({ ...body, name: String(body.name ?? "") }, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_extra_people",
      targetId: personId,
      after: { name: body.name, roleLabel: body.roleLabel, employmentType: body.employmentType, countInTotal: body.countInTotal },
    });
    return NextResponse.json({ personId, extraPeople: await listExtraPeople() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 직접 입력 임원 삭제 ?personId=
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const personId = String(req.nextUrl.searchParams.get("personId") ?? "");
    if (!personId) return NextResponse.json({ error: "personId 가 필요합니다." }, { status: 400 });
    await deleteExtraPerson(personId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_extra_people",
      targetId: personId,
      after: { deleted: true },
    });
    return NextResponse.json({ extraPeople: await listExtraPeople() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
