import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { hasPermission } from "@/lib/auth/rbac";
import { kstToday } from "@/lib/approval/absence-routing";
import {
  cancelAbsence,
  createAbsence,
  getDefaultDelegate,
  listMyAbsences,
  myPendingSplit,
  setDefaultDelegate,
  userDisplayName,
} from "@/lib/approval/absence-store";
import { rerouteAbsentPendingSteps } from "@/lib/approval/docs";
import { notifyAbsenceChangedByOther } from "@/lib/approval/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 부재·대결 설정 — 본인(DA-1) + 결재 관리자(approval.manage)의 대리 등록·취소(DA-2).
// docs/e-approval-delegation-blueprint.md §6-1·§6-2.

/** 대상자 판정 — 본인이 아니면 approval.manage 필요. */
async function resolveTarget(actorUserId: string, requested: string | null | undefined): Promise<string> {
  const target = requested?.trim() || actorUserId;
  if (target !== actorUserId && !(await hasPermission(actorUserId, "approval.manage"))) {
    throw Object.assign(new Error("다른 직원의 부재는 결재 관리자만 설정할 수 있습니다."), { status: 403 });
  }
  return target;
}

const modeLabel = (mode: string, delegateName: string | null) =>
  mode === "skip" ? "다음 결재자로 넘기기" : `대결 · ${delegateName ?? "-"}`;

// GET ?userId= : 부재 목록 + 휴가 연동 기본 대결자 + 지금 대기 중인 결재(중간/최종) 건수
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const target = await resolveTarget(ctx.userId, req.nextUrl.searchParams.get("userId"));
    const [absences, defaultDelegate, pending, canManage, targetName] = await Promise.all([
      listMyAbsences(target),
      getDefaultDelegate(target),
      myPendingSplit(target),
      hasPermission(ctx.userId, "approval.manage"),
      target === ctx.userId ? Promise.resolve(null) : userDisplayName(target),
    ]);
    return NextResponse.json({ today: kstToday(), absences, defaultDelegate, pending, canManage, targetUserId: target, targetName });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  userId?: string | null;
  startDate?: string;
  endDate?: string;
  mode?: string;
  delegateUserId?: string | null;
  delegateName?: string | null;
  reason?: string | null;
  allowSelfAct?: boolean;
}

// POST: 부재 등록 — 시작일이 오늘 이전이면 지금 대기 중인 중간 단계 결재를 즉시 재라우팅
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const body = (await req.json().catch(() => ({}))) as PostBody;
    const target = await resolveTarget(ctx.userId, body.userId);
    const startDate = String(body.startDate ?? "");
    const endDate = String(body.endDate ?? "");
    const absenceId = await createAbsence({
      userId: target,
      startDate,
      endDate,
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
      after: { userId: target, startDate, endDate, mode: body.mode, delegateUserId: body.delegateUserId ?? null },
    });
    const rerouted = startDate <= kstToday() ? (await rerouteAbsentPendingSteps({ userId: target })).rerouted : 0;
    if (target !== ctx.userId) {
      await notifyAbsenceChangedByOther({
        userId: target,
        actorName: (await userDisplayName(ctx.userId)) ?? "결재 관리자",
        action: "created",
        startDate,
        endDate,
        modeLabel: modeLabel(String(body.mode ?? ""), body.delegateName ?? null),
      });
    }
    return NextResponse.json({ absenceId, rerouted });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE ?absenceId=&userId= : 부재 취소(본인 또는 결재 관리자). 이미 넘어간 결재는 되돌리지 않는다.
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const absenceId = req.nextUrl.searchParams.get("absenceId") ?? "";
    if (!absenceId) return NextResponse.json({ error: "absenceId 가 필요합니다." }, { status: 400 });
    const target = await resolveTarget(ctx.userId, req.nextUrl.searchParams.get("userId"));
    const canceled = await cancelAbsence(target, absenceId);
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "approval_absence_cancel",
      targetTable: "approval_absences",
      targetId: absenceId,
      after: { userId: target },
    });
    if (canceled && target !== ctx.userId) {
      await notifyAbsenceChangedByOther({
        userId: target,
        actorName: (await userDisplayName(ctx.userId)) ?? "결재 관리자",
        action: "canceled",
        startDate: canceled.startDate,
        endDate: canceled.endDate,
        modeLabel: modeLabel(canceled.mode, null).replace(" · -", ""),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 휴가 연동 기본 대결자 저장(null = 해제). userId 지정 시 결재 관리자 대리 설정.
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const body = (await req.json().catch(() => ({}))) as { userId?: string | null; delegateUserId?: string | null };
    const target = await resolveTarget(ctx.userId, body.userId);
    await setDefaultDelegate(target, body.delegateUserId ?? null);
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "approval_default_delegate_update",
      targetTable: "approval_delegates",
      targetId: target,
      after: { delegateUserId: body.delegateUserId ?? null },
    });
    return NextResponse.json({ defaultDelegate: await getDefaultDelegate(target) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
