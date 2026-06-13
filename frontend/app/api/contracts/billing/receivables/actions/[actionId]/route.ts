import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import {
  deleteReceivableAction,
  getReceivableActionById,
  updateReceivableAction,
} from "@/lib/ieps/receivables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ actionId: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    await requireEditor();
    const { actionId } = await ctx.params;
    const exists = await getReceivableActionById(actionId);
    if (!exists) {
      return NextResponse.json({ error: "대응 조치를 찾을 수 없습니다." }, { status: 404 });
    }
    const body = await req.json();
    const patch: {
      actionDate?: string | null;
      progressNote?: string;
      progressStage?: string | null;
      stageDates?: Record<string, string> | null;
    } = {};
    if (body.actionDate !== undefined) patch.actionDate = body.actionDate ? String(body.actionDate) : null;
    if (body.progressNote !== undefined) patch.progressNote = String(body.progressNote ?? "");
    if (body.progressStage !== undefined)
      patch.progressStage = body.progressStage ? String(body.progressStage).slice(0, 40) : null;
    if (body.stageDates !== undefined) {
      patch.stageDates =
        body.stageDates && typeof body.stageDates === "object" && !Array.isArray(body.stageDates)
          ? (body.stageDates as Record<string, string>)
          : null;
    }
    await updateReceivableAction(actionId, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    await requireEditor();
    const { actionId } = await ctx.params;
    const exists = await getReceivableActionById(actionId);
    if (!exists) {
      return NextResponse.json({ error: "대응 조치를 찾을 수 없습니다." }, { status: 404 });
    }
    await deleteReceivableAction(actionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
