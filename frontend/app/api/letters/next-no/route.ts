import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { checkLetterNoAvailable, getLetterNumbering } from "@/lib/letter/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 공문 채번 현황 — 작성 화면 상단 표시·직접 지정·이관 등록의 공용 소스.
//   nextNo   다음 자동 채번 예정 번호(반납 풀의 최소 결번 우선. 실제 확정은 상신 시 allocateDocNo)
//   gaps     결번(미등록 번호) — 수동 지정으로 건너뛴 사외 공문 자리. 이관 등록으로 메운다.
//   canAssign 직접 지정 권한(approval.manage) 보유 여부
//   check=<번호> 를 주면 해당 번호의 사용 가능 여부(available/usedBy)를 함께 판정한다.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const year = String(req.nextUrl.searchParams.get("year") ?? new Date().getFullYear());
    const numbering = await getLetterNumbering(year);
    const check = req.nextUrl.searchParams.get("check");
    const excludeDocId = req.nextUrl.searchParams.get("docId");
    return NextResponse.json({
      ...numbering,
      year,
      canAssign: await hasPermission(ctx.userId, "approval.manage"),
      check: check ? { no: check, ...(await checkLetterNoAvailable(check.trim(), excludeDocId)) } : null,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
