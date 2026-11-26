import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import { recordAuditLog } from "@/lib/auth/audit";
import { listMealReturnChecks, loadMealOutAlertSettings, saveMealOutAlertSettings } from "@/lib/approval/meal-return";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 식사 외출 대조표(?year=&month= — 귀속 구간 전월26~금월25, 2026-11-26).
 * 지출결의서 식대 결제 시각 × ADT 출입 태그로 결제 후 사무실 복귀까지의 시간을 직원별로 보여 준다.
 * 조회 전용. 직원 출입 동선이 담겨 열람을 접속기록에 남긴다.
 * ?settings=1 — 반복 외출 경고 설정(마이그 380)만 돌려준다.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("payroll.view");
    const sp = new URL(req.url).searchParams;
    if (sp.get("settings") === "1") {
      return NextResponse.json({ settings: await loadMealOutAlertSettings() });
    }
    const year = Number(sp.get("year"));
    const month = Number(sp.get("month"));
    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json({ error: "year·month가 필요합니다." }, { status: 400 });
    }
    const result = await listMealReturnChecks(year, month);
    await recordAccessLog({
      actorUserId: ctx.userId,
      action: "view",
      targetKind: "attendance_tags",
      targetId: `meal-return:${year}-${String(month).padStart(2, "0")}`,
      detail: { rows: result.rows.length },
    });
    return NextResponse.json({ year, month, ...result });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/**
 * 반복 외출 경고 설정 저장 — { enabled, longOutMinutes, lookbackDays, repeatCount }.
 * 긴 외출 날이 최근 lookbackDays 일 안에 repeatCount 이상이면 초과근무 신청서 작성 화면에 경고가 뜬다.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("payroll.edit");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const next = {
      enabled: body.enabled === true,
      longOutMinutes: Number(body.longOutMinutes),
      lookbackDays: Number(body.lookbackDays),
      repeatCount: Number(body.repeatCount),
    };
    const before = await loadMealOutAlertSettings();
    await saveMealOutAlertSettings(next, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "meal_out_alert_settings",
      targetTable: "meal_out_alert_settings",
      targetId: "default",
      before,
      after: next,
    });
    return NextResponse.json({ ok: true, settings: next });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
