import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { submitNoticePlan } from "@/lib/approval/leave-promotion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 1차 고지 회신(직원 본인) — 사용예정일 배열 + 클릭 전자서명 동의.
// { plan: ["YYYY-MM-DD", ...], agree: true }
export async function POST(req: NextRequest, { params }: { params: Promise<{ noticeId: string }> }) {
  try {
    const ctx = await requireSession();
    const { noticeId } = await params;
    const body = (await req.json().catch(() => ({}))) as { plan?: string[]; agree?: boolean };
    if (!body.agree) return NextResponse.json({ error: "전자서명 동의가 필요합니다." }, { status: 400 });
    const plan = Array.isArray(body.plan) ? body.plan.map((d) => String(d)) : [];
    if (!plan.some((d) => d.trim())) return NextResponse.json({ error: "사용예정일을 1일 이상 입력하세요." }, { status: 400 });

    const res = await submitNoticePlan(ctx.userId, noticeId, plan);
    if (!res.ok) return NextResponse.json({ error: res.error ?? "회신에 실패했습니다." }, { status: 400 });
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "approval_leave_notice_submit",
      targetTable: "leave_notices",
      targetId: noticeId,
      after: { planDays: plan.filter((d) => d.trim()).length },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
