import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import type { DocumentTheme } from "@/lib/catalog/document-theme";
import { fontSetLabel } from "@/lib/catalog/font-library";
import { CatalogDocumentError, MASTER_DOC_ID, getCatalogDocument, getDocumentTheme, saveDocumentTheme } from "@/lib/catalog/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const docIdOf = (req: NextRequest) => {
  const id = req.nextUrl.searchParams.get("doc") || MASTER_DOC_ID;
  return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : MASTER_DOC_ID;
};

// GET: 문서(판) 설정 ?doc=master — 템플릿·표지 디자인·표지 사진·서체 세트·색 컨셉·모티프(+ 세트 이름: 서체 라이브러리 세트 포함)
export async function GET(req: NextRequest) {
  try {
    await requirePermission("catalog.view");
    const docId = docIdOf(req);
    if (!(await getCatalogDocument(docId))) return NextResponse.json({ error: "회사소개서 문서를 찾지 못했습니다." }, { status: 404 });
    const theme = await getDocumentTheme(docId);
    return NextResponse.json({ docId, theme, fontSetLabel: await fontSetLabel(theme.fontSet) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 문서 설정 저장 ?doc=master { theme: { cover?, coverPhoto?, fontSet?, concept?, motif?, areas? } } — 보낸 항목만 바꾼다.
//      template 은 문서별 고정(계획서 §3-1) — 지금 값과 다른 template 을 보내면 400.
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const docId = docIdOf(req);
    const body = (await req.json().catch(() => ({}))) as { theme?: Partial<DocumentTheme> };
    if (!(await getCatalogDocument(docId))) return NextResponse.json({ error: "회사소개서 문서를 찾지 못했습니다." }, { status: 404 });
    const before = await getDocumentTheme(docId);
    const theme = await saveDocumentTheme(docId, body.theme ?? {}, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_documents",
      targetId: docId,
      before: { theme: before },
      after: { theme },
    });
    return NextResponse.json({ docId, theme });
  } catch (err) {
    if (err instanceof CatalogDocumentError) return NextResponse.json({ error: err.message }, { status: err.status });
    return authErrorToResponse(err);
  }
}
