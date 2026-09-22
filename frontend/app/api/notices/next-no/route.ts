import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { checkNoticeNoAvailable, getNextNoticeNo } from "@/lib/notice/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 내부고시 채번 현황 — 작성 화면 상단 표시·직접 지정용(공문 /api/letters/next-no 와 같은 계약).
//   nextNo    다음 자동 채번 예정 번호 '내부고시-NNNN호'(확정은 상신 시 allocateDocNo)
//   canAssign 직접 지정 권한(approval.manage)
//   check=<번호>&docId= 를 주면 해당 번호의 사용 가능 여부(available/usedBy)
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const check = req.nextUrl.searchParams.get("check");
    const excludeDocId = req.nextUrl.searchParams.get("docId");
    return NextResponse.json({
      nextNo: await getNextNoticeNo(),
      canAssign: await hasPermission(ctx.userId, "approval.manage"),
      check: check ? { no: check, ...(await checkNoticeNoAvailable(check.trim(), excludeDocId)) } : null,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
