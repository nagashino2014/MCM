import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { createBonusPaymentPlanDraft, listBonusPlanCandidates, type BonusPlanInput } from "@/lib/payroll/bonus-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 상여금 지급 계획 — 대상자 후보(재직자) */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ candidates: await listBonusPlanCandidates() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 상여금 지급 계획 기안(draft) 생성 — 결재선=대표이사 직결. 승인 시 상여대장 자동 생성(payroll.bonus_ledger). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const body = (await req.json()) as Partial<BonusPlanInput>;
    const out = await createBonusPaymentPlanDraft(ctx.userId, {
      payMonth: String(body.payMonth ?? ""),
      reason: String(body.reason ?? "기타 상여"),
      mode: body.mode === "individual" ? "individual" : "uniform",
      uniformAmount: body.uniformAmount != null ? Number(body.uniformAmount) : undefined,
      targets: Array.isArray(body.targets) ? body.targets : [],
      note: body.note ?? null,
    });
    return NextResponse.json({ ok: true, ...out, href: `/approval/draft?docId=${out.docId}` });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 400) return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    return authErrorToResponse(err);
  }
}
