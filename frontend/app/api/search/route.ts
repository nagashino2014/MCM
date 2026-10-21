import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { searchContent } from "@/lib/search/global";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?q= : 상단 검색(Ctrl K) 내용 검색 — 메일·결재·주소록·계약·사업장·할 일, 종류별 최대 5건.
 * 열람 규칙은 종류마다 그 화면과 같다(lib/search/global.ts). 2글자 미만이면 빈 결과.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const items = await searchContent(ctx.userId, req.nextUrl.searchParams.get("q") ?? "");
    return NextResponse.json({ items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
