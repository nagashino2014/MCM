import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { deleteActivity, updateActivity } from "@/lib/sales/queries";
import type { SalesActivityInput, SalesActivityStatus } from "@/lib/sales/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ activityId: string }>;
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { activityId } = await context.params;
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json()) as Partial<SalesActivityInput>;
    if (!body.activityType) {
      return NextResponse.json({ error: "활동 유형은 필수입니다." }, { status: 400 });
    }
    const input: SalesActivityInput = {
      activityType: body.activityType,
      status: (body.status as SalesActivityStatus) ?? "done",
      scheduledAt: body.scheduledAt ?? null,
      occurredAt: body.occurredAt ?? null,
      place: body.place ?? null,
      summary: body.summary ?? null,
      quoteAmount: body.quoteAmount ?? null,
      bidAmount: body.bidAmount ?? null,
      authorEmployeeId: body.authorEmployeeId ?? null,
      contactPersonIds: Array.isArray(body.contactPersonIds) ? body.contactPersonIds : undefined,
    };
    await updateActivity(activityId, input);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { activityId } = await context.params;
    await requirePermission("sales.delete", { fallbackRoles: ["editor"] });
    await deleteActivity(activityId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
