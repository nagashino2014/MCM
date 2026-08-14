import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { deleteContract, updateContract } from "@/lib/payroll/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 계약 검수 수정 — 추출값 보정·태그 변경·검수 완료(note 해제). */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ contractId: string }> }
) {
  try {
    await requireAdmin();
    const { contractId } = await params;
    const body = await req.json();
    await updateContract(contractId, {
      contractDate: body.contractDate ?? null,
      effectiveFrom: body.effectiveFrom ?? null,
      effectiveTo: body.effectiveTo ?? null,
      positionName: body.positionName ?? null,
      duty: body.duty ?? null,
      firstHiredAt: body.firstHiredAt ?? null,
      annualSalary: body.annualSalary == null ? null : Number(body.annualSalary),
      monthlySalary: body.monthlySalary == null ? null : Number(body.monthlySalary),
      wageComponents: body.wageComponents ?? undefined,
      tag: body.tag ?? null,
      reviewed: Boolean(body.reviewed),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 앱 생성(generated) 계약 삭제 — 테스트·오기 제거용. 서명 완료 건은 불가. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ contractId: string }> }
) {
  try {
    await requireAdmin();
    const { contractId } = await params;
    await deleteContract(contractId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
