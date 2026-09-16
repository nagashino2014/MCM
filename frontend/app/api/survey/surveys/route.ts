import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createSurvey, duplicateSurvey, listSurveys } from "@/lib/survey/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 설문 목록 — ?kind=internal|external (필수) &status=&q=
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("survey.view", { fallbackRoles: ["admin", "editor"] });
    const sp = req.nextUrl.searchParams;
    const kind = sp.get("kind") === "external" ? "external" : "internal";
    return NextResponse.json({
      surveys: await listSurveys({
        kind,
        status: sp.get("status"),
        q: sp.get("q"),
        viewerUserId: kind === "internal" ? ctx.userId : null,
      }),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 설문 생성. { copyFrom: surveyId } 면 문항까지 복제.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("survey.manage", { fallbackRoles: ["admin"] });
    const body = await req.json();
    if (body?.copyFrom) {
      const survey = await duplicateSurvey(String(body.copyFrom), ctx.userId);
      return NextResponse.json({ survey }, { status: 201 });
    }
    const survey = await createSurvey({
      kind: body?.kind === "external" ? "external" : "internal",
      title: body?.title != null ? String(body.title) : undefined,
      description: body?.description != null ? String(body.description) : undefined,
      isAnonymous: body?.isAnonymous === true,
      periodStart: body?.periodStart ?? null,
      periodEnd: body?.periodEnd ?? null,
      audience: body?.audience,
      createdBy: ctx.userId,
    });
    return NextResponse.json({ survey }, { status: 201 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
