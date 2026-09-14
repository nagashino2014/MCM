import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { deleteRule, deleteRules, listRules, saveRule, saveRulesBulk } from "@/lib/payroll/rules";

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
    // 항목별 설정 — 대상자 여러 명에게 같은 규칙을 한 번에(직원 열 = 조직도 선택 태그).
    if (Array.isArray(body.employeeIds)) {
      if (!body.employeeIds.length || !body.itemId || body.amount == null) {
        return NextResponse.json({ error: "대상자·항목·금액이 필요합니다." }, { status: 400 });
      }
      const out = await saveRulesBulk(
        {
          employeeIds: body.employeeIds.map(String),
          itemId: String(body.itemId),
          amount: Number(body.amount),
          validFrom: body.validFrom || null,
          validTo: body.validTo || null,
          payMonths: Array.isArray(body.payMonths) && body.payMonths.length ? body.payMonths.map(Number) : null,
          note: body.note || null,
        },
        ctx.userId
      );
      return NextResponse.json(out);
    }
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
    const sp = new URL(req.url).searchParams;
    const ruleIds = sp.get("ruleIds");
    if (ruleIds) {
      const deleted = await deleteRules(ruleIds.split(",").map((s) => s.trim()).filter(Boolean));
      return NextResponse.json({ ok: true, deleted });
    }
    const ruleId = sp.get("ruleId");
    if (!ruleId) return NextResponse.json({ error: "ruleId가 필요합니다." }, { status: 400 });
    await deleteRule(ruleId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
