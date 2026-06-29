import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listActiveEmployees } from "@/lib/sales/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 영업건 관계자 선택용 경량 직원 목록. 영업 담당자(sales.view)도 접근 가능.
export async function GET() {
  try {
    await requirePermission("sales.view");
    const employees = await listActiveEmployees();
    return NextResponse.json({ employees });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
