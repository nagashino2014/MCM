import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { mealOutAlertForUser } from "@/lib/approval/meal-return";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 초과근무 신청 기안용 — 본인의 반복 식사 외출 경고(마이그 380).
 * 최근 N일 식대 중 결제 후 사무실 복귀가 기준 시간 이상 걸린 날이 설정 횟수 이상이면 warn=true.
 * 기안 화면이 양식 위에 경고 문구를 띄운다(상신은 막지 않는다). 본인 기록만 돌려준다.
 */
export async function GET() {
  try {
    const ctx = await requireSession();
    const alert = await mealOutAlertForUser(ctx.userId);
    return NextResponse.json({ alert });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
