import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { deleteRule, listRules, saveRule } from "@/lib/payroll/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ rules: await listRules() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const body = await req.json();
    if (!body.employeeId || !body.itemId || body.amount == null) {
      return NextResponse.json({ error: "직원·항목·금액이 필요합니다." }, { status: 400 });
    }
    const ruleId = await saveRule(
      {
        ruleId: body.ruleId ?? null,
        employeeId: String(body.employeeId),
        itemId: String(body.itemId),
        amount: Number(body.amount),
        validFrom: body.validFrom || null,
        validTo: body.validTo || null,
        payMonths: Array.isArray(body.payMonths) && body.payMonths.length ? body.payMonths.map(Number) : null,
        note: body.note || null,
        isActive: body.isActive !== false,
      },
      ctx.userId
    );
    return NextResponse.json({ ruleId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
    const ruleId = new URL(req.url).searchParams.get("ruleId");
    if (!ruleId) return NextResponse.json({ error: "ruleId가 필요합니다." }, { status: 400 });
    await deleteRule(ruleId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
