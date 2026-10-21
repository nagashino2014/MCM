import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listQuotes } from "@/lib/quote/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 발송견적 목록 — 양식별 문서 조회·문서함 '발송견적' 탭. from/to=YYYYMM, q=검색.
// 열람은 전 직원(approval.view)이 모든 견적 — 과거 발행 견적 확인용(2026-10-21 사용자 결정, F-26 의 본인 기안 제한을 대체).
// 수신처 편집·수주 결과 기입(PATCH)은 결재 관리(approval.manage), 재발송은 기안자 본인·결재 관리만.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const sp = req.nextUrl.searchParams;
    const norm = (v: string | null) => {
      const m = v?.match(/^(\d{4})(\d{2})$/);
      return m ? `${m[1]}-${m[2]}` : v || null;
    };
    const quotes = await listQuotes({
      from: norm(sp.get("from")),
      to: norm(sp.get("to")),
      q: sp.get("q"),
      drafterUserId: null,
    });
    return NextResponse.json({ quotes });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
