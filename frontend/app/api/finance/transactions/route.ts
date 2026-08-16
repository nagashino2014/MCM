// 재무 원장 조회 API — kind=bank|card, 기간/대상/방향 필터 + 페이징 (P0 최소 조회)

import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listBankTransactions, listCardTransactions } from "@/lib/barobill/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const sp = req.nextUrl.searchParams;
    const kind = sp.get("kind") === "card" ? "card" : "bank";
    const from = sp.get("from") || undefined;
    const to = sp.get("to") || undefined;
    const keyword = sp.get("keyword") || undefined;
    const amountMin = sp.get("amountMin") ? Number(sp.get("amountMin")) : undefined;
    const amountMax = sp.get("amountMax") ? Number(sp.get("amountMax")) : undefined;
    const limit = Number(sp.get("limit") || 50);
    const offset = Number(sp.get("offset") || 0);

    const parseIds = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

    if (kind === "bank") {
      const direction = sp.get("direction");
      const result = await listBankTransactions({
        accountId: sp.get("accountId") || undefined,
        accountIds: parseIds(sp.get("accountIds")),
        direction: direction === "in" || direction === "out" ? direction : undefined,
        from,
        to,
        keyword,
        amountMin: Number.isFinite(amountMin) ? amountMin : undefined,
        amountMax: Number.isFinite(amountMax) ? amountMax : undefined,
        limit,
        offset,
      });
      return NextResponse.json(result);
    }

    const result = await listCardTransactions({
      cardId: sp.get("cardId") || undefined,
      cardIds: parseIds(sp.get("cardIds")),
      from,
      to,
      keyword,
      amountMin: Number.isFinite(amountMin) ? amountMin : undefined,
      amountMax: Number.isFinite(amountMax) ? amountMax : undefined,
      unusedOnly: sp.get("unusedOnly") === "1",
      limit,
      offset,
    });
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
