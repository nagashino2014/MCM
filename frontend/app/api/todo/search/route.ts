import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { searchItems } from "@/lib/todo/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 할 일 검색(§28-3 선행 피커) — GET ?q=&exclude=<itemId>&limit= → { items }. 가시 범위, 완료·보관 제외.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const sp = req.nextUrl.searchParams;
    const items = await searchItems(ctx.userId, sp.get("q") ?? "", { excludeItemId: sp.get("exclude"), limit: Number(sp.get("limit") ?? 20) });
    return NextResponse.json({ items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
