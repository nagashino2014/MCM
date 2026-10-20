// 전 직원용 조직도 스냅샷 — 결재선·참조자 선택, 양식 user_select, 공유 대상 지정 등 비영업 화면 공용.
// 세션만 요구한다(/api/sales/org 는 sales.view 가 필요한데 298 이후 사원·부서장·임원은 sales.view 가 없다).
// 인사 정보(사번·입사일·성별·생년월일 보유)는 비워서 내보낸다 — listOrganizationDirectory.

import { NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { listOrganizationDirectory } from "@/lib/admin/organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuthenticated();
    return NextResponse.json(await listOrganizationDirectory());
  } catch (err) {
    return authErrorToResponse(err);
  }
}
