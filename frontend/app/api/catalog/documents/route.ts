import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { CatalogDocumentError, createCatalogDocument, listCatalogDocuments } from "@/lib/catalog/projects";
import { TEMPLATE_LIST } from "@/lib/catalog/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 문서 목록(마스터 + 맞춤판, 보관한 것 제외) + 고를 수 있는 템플릿 — 전 직원(catalog.view). 발행본 열람이 문서별이라 목록은 모두 본다.
export async function GET() {
  try {
    await requirePermission("catalog.view");
    const documents = await listCatalogDocuments();
    return NextResponse.json({ documents, templates: TEMPLATE_LIST.map((t) => ({ id: t.id, label: t.label, desc: t.desc, plan: t.plan })) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 새 문서 { template: standard|photo|graphic|formal|brief, title } — catalog.manage. 템플릿은 문서별 고정(계획서 §3-1).
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const document = await createCatalogDocument({ template: body.template, title: body.title }, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_documents",
      targetId: document.docId,
      after: { title: document.title, template: document.template, kind: document.kind },
    });
    return NextResponse.json({ document });
  } catch (err) {
    if (err instanceof CatalogDocumentError) return NextResponse.json({ error: err.message }, { status: err.status });
    return authErrorToResponse(err);
  }
}
