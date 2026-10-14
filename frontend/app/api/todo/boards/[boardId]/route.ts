import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { deleteBoard, getBoard, updateBoard } from "@/lib/todo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ boardId: string }>;
}

// 보드 단건 — GET / PATCH { name, layout, columnStatusMap, archived, projectName, clientName, contractId, facilityId, color }
//   (lib/todo/types.ts TodoBoardPatchInput, owner·보드 admin) / DELETE(owner, 개인 기본 보드 불가).
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { boardId } = await context.params;
    return NextResponse.json({ board: await getBoard(ctx.userId, boardId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { boardId } = await context.params;
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({ board: await updateBoard(ctx.userId, boardId, body ?? {}) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { boardId } = await context.params;
    await deleteBoard(ctx.userId, boardId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
