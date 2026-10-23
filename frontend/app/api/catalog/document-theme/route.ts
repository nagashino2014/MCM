import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import type { DocumentTheme } from "@/lib/catalog/document-theme";
import { fontSetLabel } from "@/lib/catalog/font-library";
import { MASTER_DOC_ID, getDocumentTheme, saveDocumentTheme } from "@/lib/catalog/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 문서(판) 설정 — 표지 디자인·표지 사진·서체 세트(+ 세트 이름: 서체 라이브러리 세트 포함). 현재는 마스터본만(맞춤판은 스튜디오 단계에서 연다)
export async function GET() {
  try {
    await requirePermission("catalog.view");
    const theme = await getDocumentTheme(MASTER_DOC_ID);
    return NextResponse.json({ docId: MASTER_DOC_ID, theme, fontSetLabel: await fontSetLabel(theme.fontSet) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 문서 설정 저장 { theme: { cover?, coverPhoto?, fontSet? } } — 보낸 항목만 바꾼다
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as { theme?: Partial<DocumentTheme> };
    const before = await getDocumentTheme(MASTER_DOC_ID);
    const theme = await saveDocumentTheme(MASTER_DOC_ID, body.theme ?? {}, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_documents",
      targetId: MASTER_DOC_ID,
      before: { theme: before },
      after: { theme },
    });
    return NextResponse.json({ docId: MASTER_DOC_ID, theme });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
