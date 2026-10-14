import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { snoozeItem } from "@/lib/todo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

// 스누즈 — body { preset: "10m"|"1h"|"3h"|"tomorrow" } 또는 { until: ISO }.
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({ item: await snoozeItem(ctx.userId, itemId, body ?? {}) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
