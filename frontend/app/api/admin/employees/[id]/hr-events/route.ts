import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { requireGlobalScope } from "@/lib/auth/scope-guards";
import { createHrEvent, deleteHrEvent, listHrEvents, type HrEventType } from "@/lib/admin/hr-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// 인사 이력 목록.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    await requireGlobalScope("staffing.sensitive.view"); // 승진·전보·퇴사 이력은 민감정보 전용 키(298, C-4)
    return NextResponse.json({ events: await listHrEvents(id) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 인사 이력 기록(승진/부서이동/퇴사).
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const actor = await requireGlobalScope("staffing.changes.record"); // 승진·이동·퇴사 기록은 전사 범위만
    const body = (await req.json()) as {
      eventType?: HrEventType;
      eventDate?: string;
      positionId?: string | null;
      fromDeptId?: string | null;
      toDeptId?: string | null;
      note?: string | null;
    };
    if (!body.eventType || !["promotion", "transfer", "resignation", "leave_start", "leave_end"].includes(body.eventType)) {
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
    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get("eventId");
    if (!eventId) {
      return NextResponse.json({ error: "eventId가 필요합니다." }, { status: 400 });
    }
    const actor = await requireGlobalScope("staffing.changes.record"); // 이력 삭제는 전사 범위만
    await deleteHrEvent(actor.userId, eventId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
