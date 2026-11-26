import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import { listMealReturnChecks } from "@/lib/approval/meal-return";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 식사 외출 대조표(?year=&month= — 귀속 구간 전월26~금월25, 2026-11-26).
 * 지출결의서 식대 결제 시각 × ADT 출입 태그로 결제 후 사무실 복귀까지의 시간을 직원별로 보여 준다.
 * 조회 전용. 직원 출입 동선이 담겨 열람을 접속기록에 남긴다.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("payroll.view");
    const sp = new URL(req.url).searchParams;
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
