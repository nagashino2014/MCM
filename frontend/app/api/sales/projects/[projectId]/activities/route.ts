import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createActivity, listActivities } from "@/lib/sales/queries";
import type { SalesActivityFilter, SalesActivityInput, SalesActivityStatus, SalesActivityType } from "@/lib/sales/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    await requirePermission("sales.view", { target: { projectId } });
    const sp = req.nextUrl.searchParams;
    const yearRaw = sp.get("year");
    const filter: SalesActivityFilter = {
      year: yearRaw ? Number(yearRaw) : undefined,
      activityType: (sp.get("activityType") as SalesActivityType) || undefined,
      authorEmployeeId: sp.get("authorEmployeeId") || undefined,
      status: (sp.get("status") as SalesActivityStatus) || undefined,
    };
    const activities = await listActivities(projectId, filter);
    return NextResponse.json({ activities });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const ctx = await requirePermission("sales.edit", { target: { projectId }, fallbackRoles: ["editor"] });
    const body = (await req.json()) as Partial<SalesActivityInput>;
    if (!body.activityType) {
      return NextResponse.json({ error: "활동 유형은 필수입니다." }, { status: 400 });
    }
    const input: SalesActivityInput = {
      activityType: body.activityType,
      status: (body.status as SalesActivityStatus) ?? "done",
      scheduledAt: body.scheduledAt ?? null,
      endedAt: body.endedAt ?? null,
      occurredAt: body.occurredAt ?? null,
      place: body.place ?? null,
      summary: body.summary ?? null,
      progressNote: body.progressNote ?? null,
      quoteAmount: body.quoteAmount ?? null,
      bidAmount: body.bidAmount ?? null,
      quotes: Array.isArray(body.quotes) ? body.quotes : undefined,
      bids: Array.isArray(body.bids) ? body.bids : undefined,
      bidResult: body.bidResult ?? null,
      color: body.color ?? null,
      authorEmployeeId: body.authorEmployeeId ?? null,
      contactPersonIds: Array.isArray(body.contactPersonIds) ? body.contactPersonIds : [],
      assignees: Array.isArray(body.assignees) ? body.assignees : undefined,
    };
    const activityId = await createActivity(projectId, input, ctx.userId || null);
    return NextResponse.json({ activityId }, { status: 201 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
