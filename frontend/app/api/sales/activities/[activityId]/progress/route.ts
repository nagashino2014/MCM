import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { updateActivityProgress } from "@/lib/sales/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ activityId: string }>;
}

// 경과(progress_note)만 갱신 — 모바일 경과 입력용 경량 라우트.
// 본 PUT(/api/sales/activities/[id])은 전체 교체라 모바일에서 부분 갱신에 쓰면 다른 필드가 소실된다.
export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { activityId } = await ctx.params;
    const body = (await req.json()) as { progressNote?: string };
    const note = (body.progressNote ?? "").trim();
    if (!note) {
      return NextResponse.json({ error: "경과 내용을 입력하세요." }, { status: 400 });
    }
    const found = await updateActivityProgress(activityId, note);
    if (!found) return NextResponse.json({ error: "일정을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
