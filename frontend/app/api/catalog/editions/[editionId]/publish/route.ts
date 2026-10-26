import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { EditionError, addDistribution, getCatalogEdition, publishCatalogEdition } from "@/lib/catalog/render/editions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 생성본(인쇄·배포본) → 발행본 승격 { recipient?, purpose?, givenOn? } — catalog.publish.
//   검토한 PDF 를 그대로 대외 배포본으로 확정한다(다시 만들지 않는다). 열린 반영 대기는 이 발행본으로 해소된다.
export async function POST(req: NextRequest, { params }: { params: Promise<{ editionId: string }> }) {
  try {
    const actor = await requirePermission("catalog.publish");
    const { editionId } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const edition = await publishCatalogEdition(editionId, actor.userId);
    if (String(body.recipient ?? "").trim()) await addDistribution(editionId, body, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_publish",
      targetTable: "catalog_editions",
      targetId: editionId,
      after: { naming: edition.naming, scope: edition.scope, pages: edition.pages, resolved: edition.resolvedCount, warnings: edition.warnings.length },
    });
    const fresh = await getCatalogEdition(editionId);
    return NextResponse.json({ edition: fresh ? { ...fresh, pdfKey: undefined } : edition });
  } catch (err) {
    if (err instanceof EditionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return authErrorToResponse(err);
  }
}
