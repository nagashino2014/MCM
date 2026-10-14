import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { addMember, listMembers, removeMember } from "@/lib/todo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ boardId: string }>;
}

// 멤버 — GET 목록 / POST { userId, role: admin|member|viewer } / DELETE ?userId=(관리자 제거 또는 본인 탈퇴).
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { boardId } = await context.params;
    return NextResponse.json({ members: await listMembers(ctx.userId, boardId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { boardId } = await context.params;
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({ members: await addMember(ctx.userId, boardId, body ?? {}) }, { status: 201 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { boardId } = await context.params;
    const userId = req.nextUrl.searchParams.get("userId") ?? "";
    if (!userId) return NextResponse.json({ error: "userId 가 필요합니다." }, { status: 400 });
    return NextResponse.json({ members: await removeMember(ctx.userId, boardId, userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
