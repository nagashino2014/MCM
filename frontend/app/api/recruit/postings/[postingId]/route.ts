import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { deletePosting, getPosting, savePosting } from "@/lib/recruit/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ postingId: string }>;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    await requirePermission("recruit.view", { fallbackRoles: ["admin", "editor"] });
    const { postingId } = await context.params;
    const posting = await getPosting(postingId);
    if (!posting) return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ posting });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 저장 — 에디터 자동저장(snapshot 없이)과 명시 저장(snapshot=true: 버전 스냅샷) 공용.
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requirePermission("recruit.manage", { fallbackRoles: ["admin"] });
    const { postingId } = await context.params;
    const body = await req.json();
    const posting = await savePosting({
      postingId,
      title: body?.title != null ? String(body.title) : undefined,
      contentTree: body?.contentTree,
      theme: body?.theme,
      status: body?.status === "final" ? "final" : body?.status === "draft" ? "draft" : undefined,
      snapshot: body?.snapshot === true,
      updatedBy: ctx.userId,
    });
    return NextResponse.json({ posting });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requirePermission("recruit.manage", { fallbackRoles: ["admin"] });
    const { postingId } = await context.params;
    await deletePosting(postingId, ctx.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
