import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listLetters } from "@/lib/letter/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 발송공문 목록 — 양식별 문서 조회 '발송공문' 탭. 백필(imported) 포함.
// from/to = YYYY-MM(월 단위), q = 제목·공문번호·기안자 검색.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage");
    const sp = req.nextUrl.searchParams;
    const norm = (v: string | null) => {
      const m = /^(\d{4})(\d{2})$/.exec(String(v ?? "").trim());
      return m ? `${m[1]}-${m[2]}` : null;
    };
    const letters = await listLetters({
      from: norm(sp.get("from")),
      to: norm(sp.get("to")),
      q: sp.get("q"),
    });
    return NextResponse.json({ letters });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
