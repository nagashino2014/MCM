import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listCopyableLetters } from "@/lib/letter/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 공문 불러오기 목록(2026-11-26 사용자 요청) — 작성 화면의 '공문 불러오기' 창이 연도별 트리로 묶는다.
// 앱에서 결재로 만든 공문만(본문 원본 보유). q = 공문명·공문번호·기안자·수신처·참조 검색.
// 열람 권한은 발송공문 목록과 같다(approval.view — 전 직원, 2026-10-21 사용자 결정).
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const rows = await listCopyableLetters({ q: req.nextUrl.searchParams.get("q") });
    const letters = rows.map((l) => ({
      letterId: l.letterId,
      letterNo: l.letterNo,
      year: l.year ?? l.letterNo?.slice(0, 4) ?? (l.issueDate ?? l.createdAt).slice(0, 4),
      title: l.title ?? "",
      recipientNames: l.recipients.map((r) => r.name).filter(Boolean),
      drafterName: l.drafterName,
      issueDate: l.issueDate,
    }));
    return NextResponse.json({ letters });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
