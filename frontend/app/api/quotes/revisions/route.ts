import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listQuoteRevisions, resolveQuoteRootDocId } from "@/lib/quote/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 견적 버전 이력(269) — ?docId=<아무 버전의 doc_id> → 그 용역 건의 원본(root)과 상신된 전 버전 목록.
// 작성 화면의 '견적 이력' 리스트와 재견적 진입(최신 버전 복사)의 공용 소스.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const docId = req.nextUrl.searchParams.get("docId")?.trim();
    if (!docId) return NextResponse.json({ error: "docId 가 필요합니다." }, { status: 400 });
    const rootDocId = await resolveQuoteRootDocId(docId);
    if (!rootDocId) return NextResponse.json({ error: "견적 문서를 찾을 수 없습니다." }, { status: 404 });
    const items = await listQuoteRevisions(rootDocId);
    return NextResponse.json({ rootDocId, items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
