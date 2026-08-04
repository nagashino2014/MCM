import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  addLeaveEntries,
  addSpecialLeaveEntry,
  deleteLeaveEntry,
  deleteSpecialLeaveEntry,
  getLeaveSettings,
  getMyLeaveRemaining,
  getMySpecialLeaveRemaining,
  listLeaveEntries,
  listLeaveSummary,
  listSpecialLeaveEntries,
  listSpecialLeaveRemainingAll,
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
      // 특별휴가(133) 이력 — 마이그레이션 미적용 환경에서도 죽지 않게 실패는 빈 목록으로.
      const specialEntries = await listSpecialLeaveEntries(employeeId).catch(() => []);
      return NextResponse.json({ entries: await listLeaveEntries(employeeId, year), specialEntries });
    }
    const special = await listSpecialLeaveRemainingAll().catch(() => ({}));
    return NextResponse.json({ rows: await listLeaveSummary(year), settings: await getLeaveSettings(), special });
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
  // 특별휴가(장기근속·초과근무 대체) 부여/사용/조정 추가 — unit='hour' 면 days 는 시간 수(134)
  specialEntry?: {
    employeeId: string;
    kind: "longevity" | "overtime_comp";
    entryType: "grant" | "use" | "adjust";
    days: number;
    unit?: "day" | "hour";
    effectiveOn?: string | null;
    expiresOn?: string | null;
    note?: string | null;
  };
  // 특별휴가 엔트리 삭제
  deleteSpecialEntryId?: string;
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
    if (body.specialEntry) {
      const s = body.specialEntry;
      if (!s.employeeId || !["longevity", "overtime_comp"].includes(s.kind) || !["grant", "use", "adjust"].includes(s.entryType) || !(Number(s.days) > 0)) {
        return NextResponse.json({ error: "특별휴가 입력값이 올바르지 않습니다." }, { status: 400 });
      }
      const entryId = await addSpecialLeaveEntry({ ...s, days: Number(s.days) });
      await recordAuditLog({ actorUserId: actor.userId, action: "approval_leave_update", targetTable: "special_leave_ledger", targetId: entryId, after: { kind: s.kind, entryType: s.entryType, days: s.days } });
      return NextResponse.json({ entryId });
    }
    if (body.deleteSpecialEntryId) {
      await deleteSpecialLeaveEntry(body.deleteSpecialEntryId);
      await recordAuditLog({ actorUserId: actor.userId, action: "approval_leave_update", targetTable: "special_leave_ledger", targetId: body.deleteSpecialEntryId, after: { deleted: true } });
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
