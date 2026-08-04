import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  addLeaveEntries,
  deleteLeaveEntry,
  getLeaveSettings,
  getMyLeaveRemaining,
  getMySpecialLeaveRemaining,
  listLeaveEntries,
  listLeaveSummary,
  saveLeaveSettings,
  upsertUsageEntry,
} from "@/lib/approval/leave";
import type { AccrualBasis } from "@/lib/approval/leave-accrual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 직원별 휴가 관리 — ?year=(직원 집계, admin) / &employeeId=(날짜별 이력) / ?me=1(본인 잔여) / ?settings=1
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const year = String(sp.get("year") ?? new Date().getFullYear());
    if (sp.get("me") === "1") {
      const ctx = await requirePermission("approval.view");
      // 특별휴가(133) — 마이그레이션 미적용 환경에서도 본인 잔여 조회가 죽지 않게 실패는 빈 목록으로.
      const special = await getMySpecialLeaveRemaining(ctx.userId).catch(() => []);
      return NextResponse.json({ summary: await getMyLeaveRemaining(ctx.userId, year), special });
    }
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    if (sp.get("settings") === "1") {
      return NextResponse.json({ settings: await getLeaveSettings() });
    }
    const employeeId = sp.get("employeeId");
    if (employeeId) {
      return NextResponse.json({ entries: await listLeaveEntries(employeeId, year) });
    }
    return NextResponse.json({ rows: await listLeaveSummary(year), settings: await getLeaveSettings() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  // 부여/조정 일괄
  entries?: { employeeId: string; year: string; entryType: "grant" | "adjust"; days: number; note?: string | null }[];
  // 사용 이력 추가/수정
  usage?: { entryId?: string | null; employeeId: string; usedOn: string; leaveTypeKey: string; days: number; note?: string | null };
  // 엔트리 삭제
  deleteEntryId?: string;
  // 발생 기준 설정
  accrualBasis?: AccrualBasis;
}

// POST: 부여/조정·사용 이력 추가/수정·삭제·발생기준 설정 — admin 전용
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as PostBody;

    if (body.accrualBasis) {
      await saveLeaveSettings(body.accrualBasis === "hire_date" ? "hire_date" : "jan1");
      await recordAuditLog({ actorUserId: actor.userId, action: "approval_leave_update", targetTable: "leave_settings", targetId: "default", after: { accrualBasis: body.accrualBasis } });
      return NextResponse.json({ ok: true });
    }
    if (body.deleteEntryId) {
      await deleteLeaveEntry(body.deleteEntryId);
      await recordAuditLog({ actorUserId: actor.userId, action: "approval_leave_update", targetTable: "annual_leave_ledger", targetId: body.deleteEntryId, after: { deleted: true } });
      return NextResponse.json({ ok: true });
    }
    if (body.usage) {
      await upsertUsageEntry({ ...body.usage, entryId: body.usage.entryId ?? null, actorUserId: actor.userId });
      await recordAuditLog({ actorUserId: actor.userId, action: "approval_leave_update", targetTable: "annual_leave_ledger", targetId: body.usage.entryId ?? "new-usage", after: { usedOn: body.usage.usedOn, type: body.usage.leaveTypeKey, days: body.usage.days } });
      return NextResponse.json({ ok: true });
    }
    const count = await addLeaveEntries({ entries: body.entries ?? [], actorUserId: actor.userId });
    if (count === 0) return NextResponse.json({ error: "추가할 유효한 엔트리가 없습니다." }, { status: 400 });
    await recordAuditLog({ actorUserId: actor.userId, action: "approval_leave_update", targetTable: "annual_leave_ledger", targetId: "bulk", after: { added: count } });
    return NextResponse.json({ added: count });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
