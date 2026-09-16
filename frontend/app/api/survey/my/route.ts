import { NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { listMySurveys } from "@/lib/survey/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 내가 참여할 수 있는 사내 설문(접수 중 · 대상자 · 응답 여부 포함). 웹·모바일 공용.
export async function GET() {
  try {
    const ctx = await requireAuthenticated();
    return NextResponse.json({ surveys: await listMySurveys(ctx.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
