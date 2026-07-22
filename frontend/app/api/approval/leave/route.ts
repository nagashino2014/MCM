import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  addLeaveEntries,
  deleteLeaveEntry,
  getMyLeaveRemaining,
  listLeaveEntries,
  listLeaveSummary,
} from "@/lib/approval/leave";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 연차 대장 — ?year=YYYY(직원별 집계, admin) / &employeeId=(엔트리 내역) / ?me=1(본인 잔여)
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const year = String(sp.get("year") ?? new Date().getFullYear());
    if (sp.get("me") === "1") {
      const ctx = await requirePermission("approval.view");
      return NextResponse.json({ summary: await getMyLeaveRemaining(ctx.userId, year) });
    }
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const employeeId = sp.get("employeeId");
    if (employeeId) {
      return NextResponse.json({ entries: await listLeaveEntries(employeeId, year) });
    }
    return NextResponse.json({ rows: await listLeaveSummary(year) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  entries?: { employeeId: string; year: string; entryType: "grant" | "adjust"; days: number; note?: string | null }[];
  deleteEntryId?: string;
}

// POST: 부여/조정 엔트리 추가(일괄 임포트 포함) 또는 엔트리 삭제 — admin 전용
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as PostBody;
    if (body.deleteEntryId) {
      await deleteLeaveEntry(body.deleteEntryId);
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "approval_leave_update",
        targetTable: "annual_leave_ledger",
        targetId: body.deleteEntryId,
        after: { deleted: true },
      });
      return NextResponse.json({ ok: true });
    }
    const count = await addLeaveEntries({ entries: body.entries ?? [], actorUserId: actor.userId });
    if (count === 0) return NextResponse.json({ error: "추가할 유효한 엔트리가 없습니다." }, { status: 400 });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_leave_update",
      targetTable: "annual_leave_ledger",
      targetId: "bulk",
      after: { added: count },
    });
    return NextResponse.json({ added: count });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
