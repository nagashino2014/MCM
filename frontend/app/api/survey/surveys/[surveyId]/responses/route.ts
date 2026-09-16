import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getMyResponse, getSurveyDetail, isAudienceMember, isOpenNow, submitResponse } from "@/lib/survey/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ surveyId: string }>;
}

/**
 * 응답 화면용 설문 조회 — 전 직원이 대상이라 survey.view 권한이 아니라 로그인만 요구한다.
 * 대신 사내 설문 · 대상자 · 접수 기간 검사를 여기서 한다.
 */
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireAuthenticated();
    const { surveyId } = await context.params;
    const survey = await getSurveyDetail(surveyId);
    if (!survey || survey.kind !== "internal") {
      return NextResponse.json({ error: "설문을 찾을 수 없습니다." }, { status: 404 });
    }
    if (!(await isAudienceMember(survey, ctx.userId))) {
      return NextResponse.json({ error: "이 설문의 응답 대상이 아닙니다." }, { status: 403 });
    }
    const mine = await getMyResponse(surveyId, ctx.userId);
    return NextResponse.json({
      survey: { ...survey, responseCount: undefined },
      open: isOpenNow(survey),
      myResponse: mine,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 응답 제출 — 1인 1회. { answers: { [questionId]: 답 }, source: "web" | "mobile" }
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireAuthenticated();
    const { surveyId } = await context.params;
    const survey = await getSurveyDetail(surveyId);
    if (!survey) return NextResponse.json({ error: "설문을 찾을 수 없습니다." }, { status: 404 });
    if (!(await isAudienceMember(survey, ctx.userId))) {
      return NextResponse.json({ error: "이 설문의 응답 대상이 아닙니다." }, { status: 403 });
    }
    const body = await req.json();
    const result = await submitResponse({
      surveyId,
      userId: ctx.userId,
      answers: body?.answers && typeof body.answers === "object" ? body.answers : {},
      source: body?.source === "mobile" ? "mobile" : "web",
    });
    return NextResponse.json({ response: result }, { status: 201 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
