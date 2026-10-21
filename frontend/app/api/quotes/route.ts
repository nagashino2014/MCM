import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasGlobalScope, hasPermission } from "@/lib/auth/rbac";
import { listQuotes } from "@/lib/quote/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 발송견적 목록 — 양식별 문서 조회·문서함 '발송견적' 탭. from/to=YYYYMM, q=검색.
// 전사 견적(금액 포함)은 결재 관리(approval.manage, 양식별 문서 조회의 다른 탭과 동일) 또는
// 영업 조회 전사 범위(sales.view@all, 견적서 작성 담당) 보유자만 본다. 그 밖의 직원은 본인 기안 견적만(F-26, 2026-10-21).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const sp = req.nextUrl.searchParams;
    const norm = (v: string | null) => {
      const m = v?.match(/^(\d{4})(\d{2})$/);
      return m ? `${m[1]}-${m[2]}` : v || null;
    };
    const seeAll =
      (await hasPermission(ctx.userId, "approval.manage")) || (await hasGlobalScope(ctx.userId, "sales.view"));
    const quotes = await listQuotes({
      from: norm(sp.get("from")),
      to: norm(sp.get("to")),
      q: sp.get("q"),
      drafterUserId: seeAll ? null : ctx.userId,
    });
    return NextResponse.json({ quotes });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
