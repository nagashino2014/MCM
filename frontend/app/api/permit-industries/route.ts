import { NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { loadPermitIndustries } from "@/lib/ieps/permit-industries-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 통합허가 대상 업종 목록(사용 중지 포함) — 로그인 사용자 전원 읽기. 편집은 /api/admin/permit-industries. */
export async function GET() {
  try {
    await requireAuthenticated();
    return NextResponse.json({ industries: await loadPermitIndustries() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
