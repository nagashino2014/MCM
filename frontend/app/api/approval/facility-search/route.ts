import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listFacilities } from "@/lib/ieps/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: 결재 양식 업체 검색(company_select·공문 수신처) 자동완성.
 * /api/facilities 는 facility.view 가 필요해 일반 직원 계정에서는 403 으로 검색 결과가 비었다
 * (2026-10-30 사내 테스트 피드백 — 관리자만 검색됨). 결재 권한만으로 쓸 수 있게 하되,
 * 양식 자동 채움에 필요한 기본 항목만 돌려준다.
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const q = String(req.nextUrl.searchParams.get("q") ?? "").trim();
    const limit = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? "15") || 15));
    if (q.length < 2) return NextResponse.json({ items: [] });

    const result = await listFacilities({ q, sort: "name", limit, offset: 0 });
    return NextResponse.json({
      items: result.items.map((f) => ({
        facilityId: f.facilityId,
        companyName: f.companyName,
        businessRegistrationNo: f.businessRegistrationNo,
        siteAddress: f.siteAddress,
        representativeName: f.representativeName,
        phoneNumber: f.phoneNumber,
        regionSido: f.regionSido,
        regionSigungu: f.regionSigungu,
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
