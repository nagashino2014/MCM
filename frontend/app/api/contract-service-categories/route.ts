import { NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { loadContractServiceTypes } from "@/lib/contracts/service-categories-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 계약 용역 대분류·세분류(사용 중지 포함) — 로그인 사용자 전원 읽기. 편집은 /api/admin/contract-service-categories. */
export async function GET() {
  try {
    await requireAuthenticated();
    return NextResponse.json({ types: await loadContractServiceTypes() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
