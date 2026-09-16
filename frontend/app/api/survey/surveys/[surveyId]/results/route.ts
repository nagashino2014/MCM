import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getResults } from "@/lib/survey/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ surveyId: string }>;
}

// 집계 — 익명 설문이면 응답자 목록이 비어 나온다(store 에서 차단).
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    await requirePermission("survey.view", { fallbackRoles: ["admin", "editor"] });
    const { surveyId } = await context.params;
    return NextResponse.json({ results: await getResults(surveyId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
