import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { promoteOrganization, TRADE_ROLES, type TradeRole } from "@/lib/contact-import/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** 거래가 시작된 기관을 사업장 마스터로 옮긴다. */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit");
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { tradeRoles?: string[] };
    const roles = (body.tradeRoles ?? []).filter((r): r is TradeRole => (TRADE_ROLES as readonly string[]).includes(r));
    if (!roles.length) return NextResponse.json({ error: "매출·매입 중 거래 구분을 골라 주세요." }, { status: 400 });
    const result = await withDbWrite((db) => promoteOrganization(db, id, roles, actor.userId));
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
