import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listQuotes } from "@/lib/quote/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 발송견적 목록 — 양식별 문서 조회 '발송견적' 탭. from/to=YYYYMM, q=검색.
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
    });
    return NextResponse.json({ quotes });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
