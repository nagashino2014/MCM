import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { deleteSurvey, getSurveyDetail, updateSurvey } from "@/lib/survey/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ surveyId: string }>;
}

// 설문 상세(문항 포함).
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    await requirePermission("survey.view", { fallbackRoles: ["admin", "editor"] });
    const { surveyId } = await context.params;
    const survey = await getSurveyDetail(surveyId);
    if (!survey) return NextResponse.json({ error: "설문을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ survey });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 설문 수정 — 제목·안내문·상태(작성/접수/마감)·기간·대상·익명 여부·구글 폼 연결.
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requirePermission("survey.manage", { fallbackRoles: ["admin"] });
    const { surveyId } = await context.params;
    const body = await req.json();
    const survey = await updateSurvey(
      surveyId,
      {
        title: body?.title != null ? String(body.title) : undefined,
        description: body?.description !== undefined ? (body.description == null ? null : String(body.description)) : undefined,
        status: body?.status,
        isAnonymous: body?.isAnonymous,
        periodStart: body?.periodStart,
        periodEnd: body?.periodEnd,
        audience: body?.audience,
        googleFormUrl: body?.googleFormUrl,
        googleFormEditUrl: body?.googleFormEditUrl,
        googleFormId: body?.googleFormId,
        googleScriptId: body?.googleScriptId,
      },
      ctx.userId
    );
    return NextResponse.json({ survey });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    await requirePermission("survey.manage", { fallbackRoles: ["admin"] });
    const { surveyId } = await context.params;
    await deleteSurvey(surveyId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
