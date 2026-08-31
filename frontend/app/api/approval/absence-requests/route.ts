import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  cancelAbsenceRequest,
  createAbsenceRequest,
  listAbsenceRequests,
  listMyOpenAbsenceRequests,
} from "@/lib/approval/absence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: ?mine=1 → 본인 열린 요청(기안 화면 배너) / 그 외 → 관리자 목록(?status=)
export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get("mine") === "1") {
      const actor = await requirePermission("approval.view");
      return NextResponse.json({ requests: await listMyOpenAbsenceRequests(actor.userId) });
    }
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const status = req.nextUrl.searchParams.get("status") || undefined;
    return NextResponse.json({ requests: await listAbsenceRequests(status) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 요청 생성(관리자) — {employeeId, dateFrom, dateTo?, note?}
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as {
      employeeId?: string;
      dateFrom?: string;
      dateTo?: string | null;
      note?: string | null;
    };
    const employeeId = String(body.employeeId ?? "").trim();
    const dateFrom = String(body.dateFrom ?? "").trim();
    if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
      return NextResponse.json({ error: "대상 직원과 결근 시작일(YYYY-MM-DD)이 필요합니다." }, { status: 400 });
    }
    const created = await createAbsenceRequest({
      employeeId,
      dateFrom,
      dateTo: body.dateTo ?? null,
      note: body.note ?? null,
      requestedBy: actor.userId,
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "absence_request_create",
      targetTable: "absence_statement_requests",
      targetId: created.requestId,
      after: { employeeId, dateFrom, dateTo: created.dateTo },
    });
    return NextResponse.json({ request: created });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: ?requestId= — 열린 요청 취소(관리자)
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const requestId = req.nextUrl.searchParams.get("requestId") ?? "";
    if (!requestId) return NextResponse.json({ error: "requestId가 필요합니다." }, { status: 400 });
    await cancelAbsenceRequest(requestId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "absence_request_cancel",
      targetTable: "absence_statement_requests",
      targetId: requestId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
