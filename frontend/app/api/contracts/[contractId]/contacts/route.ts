import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listContractContacts } from "@/lib/contracts/certificate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

// GET: 증명서 발급기관 담당자 선택용 — 계약의 통합허가 대상 사업장 담당자 리스트
export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    const { contractId } = await ctx.params;
    await requirePermission("contract.view", { target: { contractId } });
    return NextResponse.json(await listContractContacts(contractId));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
