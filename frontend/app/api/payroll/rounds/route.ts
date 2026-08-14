import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import {
  createAnnualRound,
  createPromotionRound,
  getPromotionContext,
  listRounds,
  previewAnnual,
  type AnnualOverride,
} from "@/lib/payroll/rounds";

/** 클라이언트 overrides 정제 — 알 수 없는 키·비정상 값 제거 */
function sanitizeOverrides(raw: unknown): Record<string, AnnualOverride> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, AnnualOverride> = {};
  for (const [empId, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const mode = o.mode === "amount" ? "amount" : o.mode === "rate" ? "rate" : null;
    const value = Number(o.value);
    if (!mode || !Number.isFinite(value)) continue;
    out[empId] = {
      mode,
      value,
      reason: String(o.reason ?? ""),
      reasonDetail: o.reasonDetail ? String(o.reasonDetail) : undefined,
    };
  }
  return Object.keys(out).length ? out : undefined;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 라운드 목록(+연도별 비율 이력) / ?promotionContext=employeeId 승진 패널 컨텍스트 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const employeeId = new URL(req.url).searchParams.get("promotionContext");
    if (employeeId) {
      return NextResponse.json(await getPromotionContext(employeeId));
    }
    return NextResponse.json({ rounds: await listRounds() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** action: preview(미리보기) | create-annual(일괄 draft 생성) | create-promotion(개별 승진) */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const body = await req.json();
    const action = String(body.action ?? "");
    if (action === "preview") {
      return NextResponse.json({
        rows: await previewAnnual(Number(body.cpiRate ?? 0), Number(body.extraRate ?? 0),
          body.scope === "all" ? "all" : "exclude_exec"),
      });
    }
    if (action === "create-annual") {
      const baseDate = String(body.baseDate ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
        return NextResponse.json({ error: "기준일(YYYY-MM-DD)이 필요합니다." }, { status: 400 });
      }
      return NextResponse.json(
        await createAnnualRound({
          baseDate,
          cpiRate: Number(body.cpiRate ?? 0),
          extraRate: Number(body.extraRate ?? 0),
          scope: body.scope === "all" ? "all" : "exclude_exec",
          overrides: sanitizeOverrides(body.overrides),
          actorUserId: ctx.userId,
        })
      );
    }
    if (action === "create-promotion") {
      const baseDate = String(body.baseDate ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
        return NextResponse.json({ error: "기준일(YYYY-MM-DD)이 필요합니다." }, { status: 400 });
      }
      if (!body.employeeId || !body.newPositionName || !body.newMonthly) {
        return NextResponse.json({ error: "대상 직원·승진 직급·급여가 필요합니다." }, { status: 400 });
      }
      return NextResponse.json(
        await createPromotionRound({
          employeeId: String(body.employeeId),
          baseDate,
          newPositionName: String(body.newPositionName),
          newMonthly: Number(body.newMonthly),
          actorUserId: ctx.userId,
        })
      );
    }
    return NextResponse.json({ error: "알 수 없는 action 입니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
