import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { computeCatalogMetrics } from "@/lib/catalog/metrics";
import { catalogRoles } from "@/lib/catalog/refresh/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 회사소개서 지표 사전 값 + 통합허가 최초허가 계약 단위 상세(대조용) + 분류별 누적 계약 수
// 계약 단위 행(발주처·사업장·결정번호)은 관리 담당(catalog.manage)에게만 — catalog.view 는 전 직원(312)이라 합계만 준다.
export async function GET() {
  try {
    const actor = await requirePermission("catalog.view");
    const [bundle, roles] = await Promise.all([computeCatalogMetrics(), catalogRoles(actor.userId)]);
    if (roles.manage) return NextResponse.json(bundle);
    return NextResponse.json({ ...bundle, initialPermit: { ...bundle.initialPermit, rows: [] } });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
