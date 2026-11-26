import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getLetterCopySource } from "@/lib/letter/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 공문 불러오기(2026-11-26 사용자 요청) — 예전 공문의 제목·수신처·참조·본문·붙임 목록 등
// 새 공문에 옮길 값. 문서번호·시행일·동봉 첨부파일·결재선은 싣지 않는다(lib/letter/types.ts LetterCopySource).
// 권한은 같은 공문의 PDF 열람과 같다(approval.view).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ letterId: string }> }) {
  try {
    await requirePermission("approval.view");
    const { letterId } = await params;
    const source = await getLetterCopySource(letterId);
    if (!source) return NextResponse.json({ error: "불러올 수 있는 공문이 아닙니다(과거 이관 공문은 본문 원본이 없습니다)." }, { status: 404 });
    return NextResponse.json({ source });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
