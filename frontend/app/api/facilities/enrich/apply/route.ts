import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { reviewCandidates } from "@/lib/ieps/facility-update";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("facility.edit");
    const body = await req.json();
    if (!Array.isArray(body.candidateIds) || !body.candidateIds.length || body.candidateIds.length > 200 || body.candidateIds.some((v: unknown) => typeof v !== "string" || v.length > 100) || !["apply","reject","revert"].includes(body.action)) {
      return NextResponse.json({ error: "저장된 후보 ID(최대 200개)와 검토 동작이 필요합니다. 후보를 다시 조회하세요." }, { status: 400 });
    }
    return NextResponse.json(await reviewCandidates(fn => withDbWrite(db => fn(db)), [...new Set<string>(body.candidateIds)], actor.userId, body.action));
  } catch (e) { return authErrorToResponse(e); }
}
