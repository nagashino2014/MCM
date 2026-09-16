import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { deleteNotice, getNotice, updateNotice } from "@/lib/survey/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ noticeId: string }>;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    await requirePermission("survey.view", { fallbackRoles: ["admin", "editor"] });
    const { noticeId } = await context.params;
    const notice = await getNotice(noticeId);
    if (!notice) return NextResponse.json({ error: "배포 이미지를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ notice });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 편집기 자동저장 — 이름·레이아웃·필드·테마를 부분 갱신.
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requirePermission("survey.manage", { fallbackRoles: ["admin"] });
    const { noticeId } = await context.params;
    const body = await req.json();
    const notice = await updateNotice(
      noticeId,
      {
        name: body?.name != null ? String(body.name) : undefined,
        layout: body?.layout,
        fields: body?.fields,
        theme: body?.theme,
        surveyId: body?.surveyId !== undefined ? (body.surveyId ? String(body.surveyId) : null) : undefined,
      },
      ctx.userId
    );
    return NextResponse.json({ notice });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    await requirePermission("survey.manage", { fallbackRoles: ["admin"] });
    const { noticeId } = await context.params;
    await deleteNotice(noticeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
