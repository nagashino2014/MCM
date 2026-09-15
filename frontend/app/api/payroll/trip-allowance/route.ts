import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import {
  deleteTripLodgingRule, listTripLodgingRules, listTripLodgingUpcoming, saveTripLodgingRule,
} from "@/lib/payroll/trip-allowance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 숙박출장수당 기준표(국내여비기준표, 마이그 224) + 최근 3개월~다음 달 인원별 산정 내역·대장 반영 상태. */
export async function GET() {
  try {
    await requireAdmin();
    const [rules, upcoming] = await Promise.all([listTripLodgingRules(), listTripLodgingUpcoming()]);
    return NextResponse.json({ rules, upcoming });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 규칙 저장(직급 하한 기준 upsert) */
export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    await saveTripLodgingRule({
      rankFrom: Number(body.rankFrom),
      label: String(body.label ?? ""),
      dailyAmount: Number(body.dailyAmount ?? 0),
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
    const raw = new URL(req.url).searchParams.get("rankFrom");
    if (raw == null || raw === "") return NextResponse.json({ error: "rankFrom 이 필요합니다." }, { status: 400 });
    await deleteTripLodgingRule(Number(raw));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
