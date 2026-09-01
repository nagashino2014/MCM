import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin, requirePermission } from "@/lib/auth/guards";
import { parsePeriod } from "@/lib/bonus/source";
import { getBonusSettings, saveBonusSettings, type BonusSettingsInput } from "@/lib/bonus/targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 반기 설정(기여도·적용비율·절대평가) 조회 — canEdit 로 admin 여부를 함께 내려준다. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("bonus.view", { fallbackRoles: ["editor"] });
    const p = parsePeriod(new URL(req.url).searchParams.get("period") ?? "");
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    const settings = await getBonusSettings(p.year, p.half);
    return NextResponse.json({ settings, canEdit: ctx.role === "admin" });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 반기 설정 저장 — 관리자 전용. */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const body = await req.json();
    const p = parsePeriod(String(body?.period ?? ""));
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    const calcMethod =
      body?.calcMethod === "salary" || body?.calcMethod === "profit" || body?.calcMethod === "base"
        ? (body.calcMethod as BonusSettingsInput["calcMethod"])
        : undefined;
    const salaryApplyRate = body?.salaryApplyRate == null || body.salaryApplyRate === "" ? null : Number(body.salaryApplyRate);
    const salaryMultiplier = body?.salaryMultiplier == null || body.salaryMultiplier === "" ? undefined : Number(body.salaryMultiplier);
    const input: BonusSettingsInput = {
      applyRate: Number(body?.applyRate ?? 4),
      contribSupportPct: Number(body?.contribSupportPct ?? 0),
      contribExecPct: Number(body?.contribExecPct ?? 0),
      deptHeadRates: (body?.deptHeadRates ?? {}) as Record<string, number>,
      absoluteGrading: Boolean(body?.absoluteGrading),
      gradeCaps: (body?.gradeCaps ?? {}) as Record<string, number>,
      calcMethod,
      salaryApplyRate,
      salaryMultiplier,
    };
    if (!Number.isFinite(input.applyRate) || input.applyRate < 0 || input.applyRate > 100) {
      return NextResponse.json({ error: "적용 비율이 올바르지 않습니다." }, { status: 400 });
    }
    if (salaryApplyRate != null && (!Number.isFinite(salaryApplyRate) || salaryApplyRate < 0 || salaryApplyRate > 100)) {
      return NextResponse.json({ error: "인건비 반영 적용 비율이 올바르지 않습니다." }, { status: 400 });
    }
    if (salaryMultiplier != null && (!Number.isFinite(salaryMultiplier) || salaryMultiplier < 0 || salaryMultiplier > 10)) {
      return NextResponse.json({ error: "인건비 차감 배수가 올바르지 않습니다(0~10)." }, { status: 400 });
    }
    if (calcMethod === "salary" && salaryApplyRate == null) {
      return NextResponse.json({ error: "인건비 반영 산정은 매출액 중 적용 비율이 필요합니다." }, { status: 400 });
    }
    if (calcMethod === "profit") {
      return NextResponse.json({ error: "영업이익 기반 산정은 아직 제공되지 않습니다." }, { status: 400 });
    }
    await saveBonusSettings(ctx.userId, p.year, p.half, input);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
