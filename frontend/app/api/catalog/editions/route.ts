import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { EditionError, addDistribution, generateCatalogPdf, getCatalogEdition, listCatalogEditions, publishCatalogEdition } from "@/lib/catalog/render/editions";
import { parseRenderOptions } from "@/lib/catalog/render/options";
import { catalogRoles } from "@/lib/catalog/refresh/service";
import { ConverterError } from "@/lib/print-kit/converter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 발행 = PDF 생성(converter) + 승격 — 렌더 경로와 같은 여유
export const maxDuration = 180;

// GET: 발행본 목록(마스터본) — 전 직원(catalog.view). 배포 기록은 관리·발행 담당에게만 보인다.
export async function GET() {
  try {
    const actor = await requirePermission("catalog.view");
    const roles = await catalogRoles(actor.userId);
    const steward = roles.manage || roles.publish;
    const editions = await listCatalogEditions(undefined, 50, { stage: "published", withDistributions: steward });
    return NextResponse.json({ editions, roles: { manage: roles.manage, publish: roles.publish } });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 발행 { scope: full|summary, naming: masked|real, recipient?, purpose?, givenOn? } — catalog.publish
//   지금 데이터로 인쇄·배포본 PDF 를 만들고, 넘침 경고가 없으면 바로 발행한다.
//   넘침이 있으면 생성본으로만 남기고 409 { needsConfirm, edition } — 화면이 확인을 받은 뒤 /editions/{id}/publish 로 승격한다.
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.publish");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const opts = parseRenderOptions({ ...body, edition: "print" });
    const generated = await generateCatalogPdf(opts, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_render",
      targetTable: "catalog_editions",
      targetId: generated.editionId,
      after: { edition: generated.edition, naming: generated.naming, scope: generated.scope, pages: generated.pages, warnings: generated.warnings.length, forPublish: true },
    });
    const overflow = generated.warnings.filter((w) => w.kind === "overflow").length;
    if (overflow > 0) return NextResponse.json({ needsConfirm: true, edition: generated }, { status: 409 });
    const edition = await publishCatalogEdition(generated.editionId, actor.userId);
    if (String(body.recipient ?? "").trim()) await addDistribution(edition.editionId, body, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_publish",
      targetTable: "catalog_editions",
      targetId: edition.editionId,
      after: { naming: edition.naming, scope: edition.scope, pages: edition.pages, resolved: edition.resolvedCount },
    });
    const fresh = await getCatalogEdition(edition.editionId);
    return NextResponse.json({ edition: fresh ? { ...fresh, pdfKey: undefined } : edition });
  } catch (err) {
    if (err instanceof ConverterError || err instanceof EditionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return authErrorToResponse(err);
  }
}
