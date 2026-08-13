import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { saveSalesCosts } from "@/lib/bonus/targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 제비용(영업비용) 일괄 저장 — 관리자 전용.
 * 외주금액은 contract_outsourcing 자동 집계라 이 라우트로 저장하지 않는다(블루프린트 §4).
 */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const body = await req.json();
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const parsed = rows
      .map((r: Record<string, unknown>) => ({
        contractId: String(r?.contractId ?? ""),
        salesCostAmount: Number(r?.salesCostAmount ?? 0),
      }))
      .filter((r: { contractId: string; salesCostAmount: number }) => r.contractId && Number.isFinite(r.salesCostAmount) && r.salesCostAmount >= 0);
    await saveSalesCosts(ctx.userId, parsed);
    return NextResponse.json({ ok: true, saved: parsed.length });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
