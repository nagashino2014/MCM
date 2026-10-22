import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { computeCatalogMetrics } from "@/lib/catalog/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 회사소개서 지표 사전 값 + 통합허가 최초허가 계약 단위 상세(대조용) + 분류별 누적 계약 수
export async function GET() {
  try {
    await requirePermission("catalog.view");
    return NextResponse.json(await computeCatalogMetrics());
  } catch (err) {
    return authErrorToResponse(err);
  }
}
