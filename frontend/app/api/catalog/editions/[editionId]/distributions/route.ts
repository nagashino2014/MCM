import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { EditionError, addDistribution, deleteDistribution, getCatalogEdition } from "@/lib/catalog/render/editions";
import { catalogRoles } from "@/lib/catalog/refresh/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 발행본 배포 기록(312 catalog_edition_distributions) — 누구에게 냈는지(블루프린트 §6-6). 관리·발행 담당(catalog.manage 또는 publish).
async function requireSteward() {
  const actor = await requirePermission("catalog.view");
  const roles = await catalogRoles(actor.userId);
  if (!roles.manage && !roles.publish) throw new AuthError("배포 기록은 회사소개서 관리·발행 담당만 남길 수 있습니다.", 403);
  return actor;
}

// POST: { recipient, purpose?, givenOn?(YYYY-MM-DD), note? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ editionId: string }> }) {
  try {
    const actor = await requireSteward();
    const { editionId } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const distId = await addDistribution(editionId, body, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_distribution",
      targetTable: "catalog_edition_distributions",
      targetId: distId,
      after: { editionId, recipient: body.recipient, purpose: body.purpose, givenOn: body.givenOn },
    });
    return NextResponse.json({ distributions: (await getCatalogEdition(editionId))?.distributions ?? [] });
  } catch (err) {
    if (err instanceof EditionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return authErrorToResponse(err);
  }
}

// DELETE: ?distId=
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ editionId: string }> }) {
  try {
    const actor = await requireSteward();
    const { editionId } = await params;
    const distId = req.nextUrl.searchParams.get("distId") ?? "";
    const before = (await getCatalogEdition(editionId))?.distributions.find((d) => d.distId === distId);
    if (!before) return NextResponse.json({ error: "배포 기록을 찾을 수 없습니다." }, { status: 404 });
    await deleteDistribution(editionId, distId);
    await recordAuditLog({ actorUserId: actor.userId, action: "catalog_distribution", targetTable: "catalog_edition_distributions", targetId: distId, before });
    return NextResponse.json({ distributions: (await getCatalogEdition(editionId))?.distributions ?? [] });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
