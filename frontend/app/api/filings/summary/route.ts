import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getFilingSummary, syncFilings } from "@/lib/filings/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 홈 카드용 요약 — 대기·초과·임박 건수와 상위 항목. 403 이면 카드가 숨겨진다. */
export async function GET() {
  try {
    await requirePermission("filing.view");
    await syncFilings();
    return NextResponse.json(await getFilingSummary(6));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
