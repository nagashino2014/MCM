import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getLetterByDocId } from "@/lib/letter/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 결재 문서(doc_id) 기준 발송 대장 조회 — 전자결재 문서 모달의 발송 상태·이력(194) 표시용.
// 문서를 볼 수 있는 사람이면 발송 상태도 볼 수 있다(재발송 실행 권한은 send 라우트가 별도 검사).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    await requirePermission("approval.view");
    const { docId } = await params;
    const letter = await getLetterByDocId(docId);
    return NextResponse.json({ letter });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
