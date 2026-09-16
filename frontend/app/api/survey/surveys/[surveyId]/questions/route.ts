import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { saveQuestions } from "@/lib/survey/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ surveyId: string }>;
}

// 문항 전체 교체 — 빌더가 보낸 배열 순서가 곧 문항 순서. 응답이 들어온 설문은 409.
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    await requirePermission("survey.manage", { fallbackRoles: ["admin"] });
    const { surveyId } = await context.params;
    const body = await req.json();
    const list = Array.isArray(body?.questions) ? body.questions : [];
    const questions = await saveQuestions(surveyId, list);
    return NextResponse.json({ questions });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
