import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  MEAL_WARNING_ACTIONS,
  listMealWarnings,
  setMealWarningAction,
  type MealWarningAction,
} from "@/lib/approval/overtime-meal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 식대 부당 사용 이력(?year=&month= — 귀속 구간 전월26~금월25, 마이그 203·204).
 * 지출결의서 상신 시 자동 검출된 초과근무 신청 미달 식대 건과 처분 상태를 보여준다.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const sp = new URL(req.url).searchParams;
    const year = Number(sp.get("year"));
    const month = Number(sp.get("month"));
    if (!year || !month) return NextResponse.json({ error: "year·month가 필요합니다." }, { status: 400 });
    const rows = await listMealWarnings(year, month);
    const deductTotal = rows.filter((r) => r.action === "deduct").reduce((a, r) => a + (r.amount ?? 0), 0);
    return NextResponse.json({
      year, month, rows,
      summary: {
        count: rows.length,
        people: new Set(rows.map((r) => r.employeeId)).size,
        repeat: rows.filter((r) => r.priorCount > 0).length,
        deduct: rows.filter((r) => r.action === "deduct").length,
        withhold: rows.filter((r) => r.action === "withhold").length,
        deductTotal,
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/**
 * 처분 지정 — warning(경고, 기본)·withhold(불지급)·deduct(급여 차감, '식대환수' 공제로
 * 급여대장 생성 시 자동 반영). 1·2회는 경고 원칙, 반복 건에 불지급·차감을 지정한다.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as {
      warningId?: string;
      action?: string;
      note?: string | null;
    };
    if (!body.warningId || !body.action || !(MEAL_WARNING_ACTIONS as string[]).includes(body.action)) {
      return NextResponse.json({ error: "warningId·action(warning|withhold|deduct)이 필요합니다." }, { status: 400 });
    }
    await setMealWarningAction(body.warningId, body.action as MealWarningAction, body.note ?? null, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "overtime_meal_action",
      targetTable: "overtime_meal_warnings",
      targetId: body.warningId,
      after: { action: body.action, note: body.note ?? null },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
