import { NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { listOrganizationSnapshot } from "@/lib/admin/organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 조직 스냅샷(부서·직원) — editor 이상 read-only. 수행인력 지정 등에서 OrganizationTree 재사용.
export async function GET() {
  try {
    await requireAuthenticated();
    return NextResponse.json(await listOrganizationSnapshot());
  } catch (err) {
    return authErrorToResponse(err);
  }
}
