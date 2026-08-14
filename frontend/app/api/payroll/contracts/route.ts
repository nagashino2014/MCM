import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { getContractTree, listContracts } from "@/lib/payroll/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 근로계약 — ?employeeId= 카드 목록 / 무파라미터 = 조직 트리. admin 전용(§8-4). */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const employeeId = new URL(req.url).searchParams.get("employeeId");
    if (!employeeId) {
      return NextResponse.json(await getContractTree());
    }
    return NextResponse.json({ contracts: await listContracts(employeeId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
