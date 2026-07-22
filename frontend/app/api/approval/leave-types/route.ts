import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import type { LeaveTypeItem } from "@/lib/approval/leave-types";
import { listLeaveTypes, saveLeaveTypes } from "@/lib/approval/leave-types-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 휴가 종류 카탈로그 — 기안 화면(휴가 종류 필드)·관리 화면 공용. ?all=1 이면 비활성 포함
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const all = req.nextUrl.searchParams.get("all") === "1";
    return NextResponse.json({ types: await listLeaveTypes(!all) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 카탈로그 전체 저장(admin) — 사규 개정 시 관리자가 편집
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as { types?: LeaveTypeItem[] };
    if (!Array.isArray(body.types)) return NextResponse.json({ error: "types 배열이 필요합니다." }, { status: 400 });
    const count = await saveLeaveTypes(body.types, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_leave_update",
      targetTable: "leave_types",
      targetId: "catalog",
      after: { saved: count },
    });
    return NextResponse.json({ saved: count });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
