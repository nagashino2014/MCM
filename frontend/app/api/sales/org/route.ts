import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listOrganizationSnapshot } from "@/lib/admin/organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 영업 스케쥴 담당인력 지정용 조직도 스냅샷. 영업 담당자(sales.view)도 접근 가능.
export async function GET() {
  try {
    await requirePermission("sales.view");
    return NextResponse.json(await listOrganizationSnapshot());
  } catch (err) {
    return authErrorToResponse(err);
  }
}
