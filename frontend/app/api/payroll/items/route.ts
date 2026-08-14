import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { listPayrollItems, savePayrollItem } from "@/lib/payroll/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 급여 항목 사전 조회(사용 라인 수 포함). */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ items: await listPayrollItems() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 급여 항목 사전 저장 — 별칭·통상임금 산입·정렬·활성 (§4-3). */
export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const itemId = String(body.itemId ?? "").trim();
    const name = String(body.name ?? "").trim();
    const kind = body.kind === "deduction" ? "deduction" : "pay";
    if (!itemId || !name) {
      return NextResponse.json({ error: "itemId·name 이 필요합니다." }, { status: 400 });
    }
    await savePayrollItem({
      itemId,
      name,
      kind,
      aliases: Array.isArray(body.aliases) ? body.aliases.map(String) : [],
      inOrdinaryWage: Boolean(body.inOrdinaryWage),
      displayOrder: Number(body.displayOrder ?? 0),
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
