import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getPosting } from "@/lib/recruit/store";
import { deleteApplicantCount, listApplicantCounts, upsertApplicantCount } from "@/lib/recruit/tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ postingId: string }>;
}

// 날짜별 지원자 수(273) — 수동 기록. GET 목록 / POST {countedOn, count, memo} 기록(같은 날은 갱신) / DELETE ?countedOn=
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    await requirePermission("recruit.view", { fallbackRoles: ["admin", "editor"] });
    const { postingId } = await context.params;
    return NextResponse.json({ counts: await listApplicantCounts(postingId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requirePermission("recruit.manage", { fallbackRoles: ["admin"] });
    const { postingId } = await context.params;
    if (!(await getPosting(postingId))) return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    await upsertApplicantCount(postingId, { countedOn: body?.countedOn, count: body?.count, memo: body?.memo }, ctx.userId);
    return NextResponse.json({ counts: await listApplicantCounts(postingId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    await requirePermission("recruit.manage", { fallbackRoles: ["admin"] });
    const { postingId } = await context.params;
    const countedOn = req.nextUrl.searchParams.get("countedOn") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(countedOn)) return NextResponse.json({ error: "countedOn 이 필요합니다." }, { status: 400 });
    await deleteApplicantCount(postingId, countedOn);
    return NextResponse.json({ counts: await listApplicantCounts(postingId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
