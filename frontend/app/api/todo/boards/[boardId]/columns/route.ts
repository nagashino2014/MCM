import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { addColumn, deleteColumn, updateColumn } from "@/lib/todo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ boardId: string }>;
}

// 열 — POST { name, statusMap?, wipLimit?, afterColumnId?|beforeColumnId? } / PATCH { columnId, ...(순서·매핑·WIP·접기) } / DELETE ?columnId=
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { boardId } = await context.params;
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({ board: await addColumn(ctx.userId, boardId, body ?? {}) }, { status: 201 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { boardId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const columnId = String(body?.columnId ?? "");
    if (!columnId) return NextResponse.json({ error: "columnId 가 필요합니다." }, { status: 400 });
    const { columnId: _omit, ...patch } = body as Record<string, unknown>;
    void _omit;
    return NextResponse.json({ board: await updateColumn(ctx.userId, boardId, columnId, patch) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { boardId } = await context.params;
    const columnId = req.nextUrl.searchParams.get("columnId") ?? "";
    if (!columnId) return NextResponse.json({ error: "columnId 가 필요합니다." }, { status: 400 });
    return NextResponse.json({ board: await deleteColumn(ctx.userId, boardId, columnId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
