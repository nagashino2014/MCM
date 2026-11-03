import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listAgreementVersions, resolveAgreementRootDocId } from "@/lib/agreement/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 계약서 버전 이력(336) — ?docId=<아무 버전의 doc_id> → 원본(root)과 전 버전(작성 중 포함) 목록.
// 작성 화면의 '버전 이력' 카드·버전 비교와 [새 버전](최신 버전 복사)의 공용 소스. ?values=1 이면 본문 포함(비교용).
export async function GET(req: NextRequest) {
  try {
    await requirePermission("contract.view");
    const docId = req.nextUrl.searchParams.get("docId")?.trim();
    if (!docId) return NextResponse.json({ error: "docId 가 필요합니다." }, { status: 400 });
    const rootDocId = await resolveAgreementRootDocId(docId);
    if (!rootDocId) return NextResponse.json({ error: "계약서 문서를 찾을 수 없습니다." }, { status: 404 });
    const items = await listAgreementVersions(rootDocId, { withValues: req.nextUrl.searchParams.get("values") === "1" });
    return NextResponse.json({ rootDocId, items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
