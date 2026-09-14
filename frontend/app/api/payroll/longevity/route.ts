import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { deleteLongevityRule, listLongevityRules, listLongevityUpcoming, saveLongevityRule } from "@/lib/payroll/longevity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 장기근속 포상 규칙(별표 9) + 최근 6개월~향후 12개월 도달자(부여·지급 상태). */
export async function GET() {
  try {
    await requireAdmin();
    const [rules, upcoming] = await Promise.all([listLongevityRules(), listLongevityUpcoming()]);
    return NextResponse.json({ rules, upcoming });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 규칙 저장(연수 기준 upsert) */
export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    await saveLongevityRule({
      years: Number(body.years),
      leaveDays: Number(body.leaveDays ?? 0),
      allowanceAmount: Number(body.allowanceAmount ?? 0),
      isActive: body.isActive !== false,
      note: body.note ? String(body.note) : null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
    const years = Number(new URL(req.url).searchParams.get("years") ?? 0);
    if (!years) return NextResponse.json({ error: "years 가 필요합니다." }, { status: 400 });
    await deleteLongevityRule(years);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
