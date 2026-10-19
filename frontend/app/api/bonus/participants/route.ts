import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { loadParticipationContractId, requireContractDeptScope } from "@/lib/auth/scope-guards";
import { removeBonusParticipant, setBonusParticipant } from "@/lib/bonus/evaluations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 참여자/관리자 지정 — 관리자 지정 시 수행부서(owning_dept_id)가 비어 있으면
 * 관리자 소속 본부로 자동 채운다(응답 owningDeptFilled).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const contractId = String(body?.contractId ?? "");
    const employeeId = String(body?.employeeId ?? "");
    const roleLabel = String(body?.roleLabel ?? "");
    if (!contractId || !employeeId || !roleLabel) {
      return NextResponse.json({ error: "contractId/employeeId/roleLabel이 필요합니다." }, { status: 400 });
    }
    // 계약 수행부서 범위 확인(2026-10-19 §7.7)
    await requireContractDeptScope("staffing.evaluation.write", [contractId]);
    const result = await setBonusParticipant(contractId, employeeId, roleLabel);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const participationId = new URL(req.url).searchParams.get("participationId") ?? "";
    if (!participationId) {
      return NextResponse.json({ error: "participationId가 필요합니다." }, { status: 400 });
    }
    // 참여 행의 계약 수행부서 범위 확인(2026-10-19 §7.7) — 해석 불가 id 는 403
    const contractId = await loadParticipationContractId(participationId);
    await requireContractDeptScope("staffing.evaluation.write", [contractId ?? "__missing__"]);
    await removeBonusParticipant(participationId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
