import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { sendFirstNotices, promotionGate } from "@/lib/approval/leave-promotion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 1차 연차 고지 일괄 발송(admin) — 7/1~7/20 기간에만 허용.
// 잔여>0·1차 미발송 직원 전원에게 leave_notices(round=1) 생성. { year }
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as { year?: string; round?: number };
    const year = String(body.year ?? new Date().getFullYear());
    const round = Number(body.round ?? 1);
    if (round !== 1) return NextResponse.json({ error: "1차 발송만 지원합니다(2차는 LP-P3)." }, { status: 400 });

    const now = new Date();
    const gate = promotionGate(now);
    if (!gate.canFirst) {
      return NextResponse.json(
        { error: "1차 고지는 7월 1일~20일에만 발송할 수 있습니다.", gate },
        { status: 409 }
      );
    }

    const result = await sendFirstNotices(year, now, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_leave_notice_send",
      targetTable: "leave_notices",
      targetId: `${year}-1`,
      after: result,
    });
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
