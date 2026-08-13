import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { parsePeriod } from "@/lib/bonus/source";
import { suggestParticipation } from "@/lib/bonus/evaluations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 인력 변동 반영 참여도 자동 배분 제안(기간 가중) — 강제 아님, 부서장이 재조정 가능. */
export async function POST(req: NextRequest) {
  try {
    await requirePermission("staffing.evaluation.write", { fallbackRoles: ["editor"] });
    const body = await req.json();
    const p = parsePeriod(String(body?.period ?? ""));
    const contractId = String(body?.contractId ?? "");
    if (!p || !contractId) {
      return NextResponse.json({ error: "period/contractId가 필요합니다." }, { status: 400 });
    }
    return NextResponse.json({ suggestions: await suggestParticipation(contractId, p) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
