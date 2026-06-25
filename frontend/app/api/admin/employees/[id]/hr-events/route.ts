import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createHrEvent, deleteHrEvent, listHrEvents, type HrEventType } from "@/lib/admin/hr-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// 인사 이력 목록.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("staffing.view", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    return NextResponse.json({ events: await listHrEvents(id) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 인사 이력 기록(승진/부서이동/퇴사).
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("staffing.changes.record", { fallbackRoles: ["admin"] });
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      eventType?: HrEventType;
      eventDate?: string;
      positionId?: string | null;
      fromDeptId?: string | null;
      toDeptId?: string | null;
      note?: string | null;
    };
    if (!body.eventType || !["promotion", "transfer", "resignation"].includes(body.eventType)) {
      return NextResponse.json({ error: "eventType이 올바르지 않습니다." }, { status: 400 });
    }
    const event = await createHrEvent(actor.userId, {
      employeeId: id,
      eventType: body.eventType,
      eventDate: String(body.eventDate ?? ""),
      positionId: body.positionId ?? null,
      fromDeptId: body.fromDeptId ?? null,
      toDeptId: body.toDeptId ?? null,
      note: body.note ?? null,
    });
    return NextResponse.json({ event });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 인사 이력 삭제(+첨부 문서 행, 퇴사 이벤트면 인원/계정 복구).
export async function DELETE(req: NextRequest, _ctx: RouteContext) {
  try {
    const actor = await requirePermission("staffing.changes.record", { fallbackRoles: ["admin"] });
    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get("eventId");
    if (!eventId) {
      return NextResponse.json({ error: "eventId가 필요합니다." }, { status: 400 });
    }
    await deleteHrEvent(actor.userId, eventId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
