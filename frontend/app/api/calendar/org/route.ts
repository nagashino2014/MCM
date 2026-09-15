// 일정 참석자 선택용 조직도 스냅샷 — 세션만 있으면 된다(/api/sales/org 는 sales.view 가 필요해 일반 직원이 못 쓴다).

import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listOrganizationSnapshot } from "@/lib/admin/organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json(await listOrganizationSnapshot());
  } catch (err) {
    return authErrorToResponse(err);
  }
}
