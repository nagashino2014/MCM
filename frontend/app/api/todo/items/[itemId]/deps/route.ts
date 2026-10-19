import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { addDep, listDeps, removeDep } from "@/lib/todo/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

// 선행·후행 의존(288, §28-3) — GET → { blockedBy, blocks, openBlockers } / POST { dependsOnItemId } / DELETE ?dependsOn=.
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    return NextResponse.json(await listDeps(ctx.userId, itemId));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    const body = (await req.json().catch(() => ({}))) as { dependsOnItemId?: unknown };
    const dependsOn = typeof body.dependsOnItemId === "string" ? body.dependsOnItemId : "";
    return NextResponse.json(await addDep(ctx.userId, itemId, dependsOn));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    const dependsOn = req.nextUrl.searchParams.get("dependsOn") ?? "";
    if (!dependsOn) return NextResponse.json({ error: "dependsOn 이 필요합니다." }, { status: 400 });
    return NextResponse.json(await removeDep(ctx.userId, itemId, dependsOn));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
