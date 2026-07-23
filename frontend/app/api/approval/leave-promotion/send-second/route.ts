import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { sendSecondNotices, promotionGate, type SecondAssignment } from "@/lib/approval/leave-promotion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 2차 연차 고지 일괄 발송(admin) — 1차 미제출자에 회사 지정일 통보. 7/21+ 에만 허용.
// { year, assignments: [{ employeeId, assigned: ["YYYY-MM-DD", ...] }] }
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as { year?: string; assignments?: SecondAssignment[] };
    const year = String(body.year ?? new Date().getFullYear());
    const assignments = Array.isArray(body.assignments) ? body.assignments : [];
    if (assignments.length === 0) return NextResponse.json({ error: "발송 대상이 없습니다." }, { status: 400 });

    const now = new Date();
    const gate = promotionGate(now);
    if (!gate.canSecond) {
      return NextResponse.json({ error: "2차 고지는 1차 기간(7/20) 이후에만 발송할 수 있습니다.", gate }, { status: 409 });
    }

    const result = await sendSecondNotices(year, now, assignments, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_leave_notice_send",
      targetTable: "leave_notices",
      targetId: `${year}-2`,
      after: result,
    });
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
