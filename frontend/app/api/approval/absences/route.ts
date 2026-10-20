import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { kstToday } from "@/lib/approval/absence-routing";
import {
  cancelAbsence,
  createAbsence,
  getDefaultDelegate,
  listMyAbsences,
  myPendingSplit,
  setDefaultDelegate,
} from "@/lib/approval/absence-store";
import { rerouteAbsentPendingSteps } from "@/lib/approval/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 부재·대결 설정(DA-1, 본인) — docs/e-approval-delegation-blueprint.md §6-1.

// GET: 내 부재 목록 + 휴가 연동 기본 대결자 + 지금 대기 중인 결재(중간/최종) 건수
export async function GET() {
  try {
    const ctx = await requirePermission("approval.view");
    const [absences, defaultDelegate, pending] = await Promise.all([
      listMyAbsences(ctx.userId),
      getDefaultDelegate(ctx.userId),
      myPendingSplit(ctx.userId),
    ]);
    return NextResponse.json({ today: kstToday(), absences, defaultDelegate, pending });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  startDate?: string;
  endDate?: string;
  mode?: string;
  delegateUserId?: string | null;
  reason?: string | null;
  allowSelfAct?: boolean;
}

// POST: 부재 등록 — 시작일이 오늘 이전이면 지금 대기 중인 중간 단계 결재를 즉시 재라우팅
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const body = (await req.json().catch(() => ({}))) as PostBody;
    const absenceId = await createAbsence({
      userId: ctx.userId,
      startDate: String(body.startDate ?? ""),
      endDate: String(body.endDate ?? ""),
      mode: String(body.mode ?? ""),
      delegateUserId: body.delegateUserId ?? null,
      reason: body.reason ?? null,
      allowSelfAct: body.allowSelfAct !== false,
      createdBy: ctx.userId,
    });
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "approval_absence_create",
      targetTable: "approval_absences",
      targetId: absenceId,
      after: { startDate: body.startDate, endDate: body.endDate, mode: body.mode, delegateUserId: body.delegateUserId ?? null },
    });
    const rerouted = String(body.startDate ?? "") <= kstToday() ? (await rerouteAbsentPendingSteps({ userId: ctx.userId })).rerouted : 0;
    return NextResponse.json({ absenceId, rerouted });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE ?absenceId= : 부재 취소(본인 것만). 이미 넘어간 결재는 되돌리지 않는다.
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const absenceId = req.nextUrl.searchParams.get("absenceId") ?? "";
    if (!absenceId) return NextResponse.json({ error: "absenceId 가 필요합니다." }, { status: 400 });
    await cancelAbsence(ctx.userId, absenceId);
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "approval_absence_cancel",
      targetTable: "approval_absences",
      targetId: absenceId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 휴가 연동 기본 대결자 저장(null = 해제)
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const body = (await req.json().catch(() => ({}))) as { delegateUserId?: string | null };
    await setDefaultDelegate(ctx.userId, body.delegateUserId ?? null);
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "approval_default_delegate_update",
      targetTable: "approval_delegates",
      targetId: ctx.userId,
      after: { delegateUserId: body.delegateUserId ?? null },
    });
    return NextResponse.json({ defaultDelegate: await getDefaultDelegate(ctx.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
