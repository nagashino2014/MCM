import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  getAttendanceSettings,
  ignoreAdtEmpNo,
  listDailyForWeek,
  listIgnoredEmps,
  listMappableEmployees,
  listUnmatched,
  listWeekStarts,
  listWeekly,
  listWorkSchedules,
  mapAdtEmpNo,
  saveAttendanceSettings,
  saveWorkSchedules,
  setOvertimeExcluded,
  unignoreAdtEmpNo,
  unmapAdtEmpNo,
} from "@/lib/adt/queries";
import type { AttendanceSettings, WorkScheduleKind } from "@/lib/adt/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: ?weekStart=(주별 요약, 기본 최근 주) / &adtEmpNo=(그 주 일별 상세) / ?unmatched=1 / ?employees=1 / ?settings=1
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const sp = req.nextUrl.searchParams;

    if (sp.get("settings") === "1") {
      return NextResponse.json({ settings: await getAttendanceSettings() });
    }
    if (sp.get("schedules") === "1") {
      return NextResponse.json({ schedules: await listWorkSchedules() });
    }
    if (sp.get("unmatched") === "1") {
      return NextResponse.json({
        unmatched: await listUnmatched(),
        employees: await listMappableEmployees(),
        ignored: await listIgnoredEmps(),
      });
    }
    if (sp.get("employees") === "1") {
      return NextResponse.json({ employees: await listMappableEmployees() });
    }
    const adtEmpNo = sp.get("adtEmpNo");
    const weekStart = sp.get("weekStart") || (await listWeekStarts(1))[0] || null;
    if (adtEmpNo && weekStart) {
      return NextResponse.json({ daily: await listDailyForWeek(adtEmpNo, weekStart) });
    }
    const weeks = await listWeekStarts();
    const rows = weekStart ? await listWeekly(weekStart) : [];
    return NextResponse.json({ weekStart, weeks, rows });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  map?: { employeeId: string; adtEmpNo: string };
  unmap?: { employeeId: string };
  exclude?: { employeeId: string; excluded: boolean };
  ignore?: { adtEmpNo: string; label?: string | null; reason?: string | null };
  unignore?: { adtEmpNo: string };
  settings?: Partial<AttendanceSettings>;
  schedules?: Array<{ employeeId: string; kind: WorkScheduleKind }>;
}

// POST: 매핑(map)·매핑해제(unmap)·정책 저장(settings) — admin 전용
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as PostBody;

    if (body.map?.employeeId && body.map?.adtEmpNo) {
      const r = await mapAdtEmpNo(body.map.employeeId, body.map.adtEmpNo).catch((e: Error) => {
        throw new Error(/unique|duplicate/i.test(e.message) ? "이미 다른 직원에 매핑된 사번입니다." : e.message);
      });
      await recordAuditLog({ actorUserId: actor.userId, action: "adt_attendance_map", targetTable: "employee_profiles", targetId: body.map.employeeId, after: { adtEmpNo: body.map.adtEmpNo, rebound: r.rebound } });
      return NextResponse.json({ ok: true, rebound: r.rebound });
    }
    if (body.unmap?.employeeId) {
      await unmapAdtEmpNo(body.unmap.employeeId);
      await recordAuditLog({ actorUserId: actor.userId, action: "adt_attendance_map", targetTable: "employee_profiles", targetId: body.unmap.employeeId, after: { adtEmpNo: null } });
      return NextResponse.json({ ok: true });
    }
    if (body.ignore?.adtEmpNo) {
      await ignoreAdtEmpNo(body.ignore.adtEmpNo, { label: body.ignore.label ?? null, reason: body.ignore.reason ?? null, actorUserId: actor.userId });
      await recordAuditLog({ actorUserId: actor.userId, action: "adt_attendance_ignore", targetTable: "attendance_ignored_emp", targetId: body.ignore.adtEmpNo, after: { label: body.ignore.label ?? null, reason: body.ignore.reason ?? null } });
      return NextResponse.json({ ok: true });
    }
    if (body.unignore?.adtEmpNo) {
      await unignoreAdtEmpNo(body.unignore.adtEmpNo);
      await recordAuditLog({ actorUserId: actor.userId, action: "adt_attendance_ignore", targetTable: "attendance_ignored_emp", targetId: body.unignore.adtEmpNo, after: { removed: true } });
      return NextResponse.json({ ok: true });
    }
    if (body.exclude?.employeeId) {
      await setOvertimeExcluded(body.exclude.employeeId, !!body.exclude.excluded);
      await recordAuditLog({ actorUserId: actor.userId, action: "adt_attendance_exclude", targetTable: "employee_profiles", targetId: body.exclude.employeeId, after: { overtimeExcluded: !!body.exclude.excluded } });
      return NextResponse.json({ ok: true });
    }
    if (body.schedules) {
      const n = await saveWorkSchedules(body.schedules, actor.userId);
      await recordAuditLog({ actorUserId: actor.userId, action: "adt_attendance_schedule", targetTable: "attendance_work_schedules", targetId: "bulk", after: { count: n, items: body.schedules } });
      return NextResponse.json({ ok: true, saved: n });
    }
    if (body.settings) {
      await saveAttendanceSettings(body.settings);
      await recordAuditLog({ actorUserId: actor.userId, action: "adt_attendance_settings", targetTable: "attendance_settings", targetId: "default", after: body.settings });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "처리할 요청이 없습니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
