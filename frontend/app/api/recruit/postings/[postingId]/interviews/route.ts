import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getPosting } from "@/lib/recruit/store";
import { createInterview, deleteInterview, listInterviews, updateInterview } from "@/lib/recruit/tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ postingId: string }>;
}

// 면접 예정자(273) — 수동 기록. GET 목록 / POST 추가 / PATCH {interviewId, ...} 수정·상태 / DELETE ?interviewId=
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    await requirePermission("recruit.view", { fallbackRoles: ["admin", "editor"] });
    const { postingId } = await context.params;
    return NextResponse.json({ interviews: await listInterviews(postingId) });
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
    const interviewId = await createInterview(postingId, body ?? {}, ctx.userId);
    return NextResponse.json({ interviewId, interviews: await listInterviews(postingId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requirePermission("recruit.manage", { fallbackRoles: ["admin"] });
    const { postingId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const interviewId = String(body?.interviewId ?? "");
    if (!interviewId) return NextResponse.json({ error: "interviewId 가 필요합니다." }, { status: 400 });
    const { interviewId: _omit, ...patch } = body as Record<string, unknown>;
    void _omit;
    await updateInterview(postingId, interviewId, patch, ctx.userId);
    return NextResponse.json({ interviews: await listInterviews(postingId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    await requirePermission("recruit.manage", { fallbackRoles: ["admin"] });
    const { postingId } = await context.params;
    const interviewId = req.nextUrl.searchParams.get("interviewId") ?? "";
    if (!interviewId) return NextResponse.json({ error: "interviewId 가 필요합니다." }, { status: 400 });
    await deleteInterview(postingId, interviewId);
    return NextResponse.json({ interviews: await listInterviews(postingId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
