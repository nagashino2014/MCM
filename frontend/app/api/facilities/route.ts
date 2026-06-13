import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, authErrorToResponse } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import {
  getFacilityFilterOptions,
  listFacilities,
  type FacilityListFilter,
} from "@/lib/ieps/queries";
import { syncAllGroupCompanyFacilities } from "@/lib/ieps/group-company-facility-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    await withDbWrite(async (db) => {
      await syncAllGroupCompanyFacilities(db);
    });
    const { searchParams } = new URL(req.url);

    const includeFilters = searchParams.get("includeFilters") === "1";
    const filter: FacilityListFilter = {
      q: searchParams.get("q") || undefined,
      integratedPermitTarget: searchParams.get("integratedPermitTarget") === "1",
      sido: searchParams.get("sido") || undefined,
      sidos: searchParams.get("sidos")
        ? searchParams
            .get("sidos")!
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      sigungu: searchParams.get("sigungu") || undefined,
      industryCode: searchParams.get("industryCode") || undefined,
      industryCategory: searchParams.get("industryCategory") || undefined,
      airClass: searchParams.get("airClass") ? Number(searchParams.get("airClass")) : undefined,
      waterClass: searchParams.get("waterClass")
        ? Number(searchParams.get("waterClass"))
        : undefined,
      source: searchParams.get("source") || undefined,
      sort: (searchParams.get("sort") as "recent" | "name") || "recent",
      limit: clampLimit(Number(searchParams.get("limit") ?? "50")),
      offset: Math.max(0, Number(searchParams.get("offset") ?? "0")),
    };

    const result = await listFacilities(filter);
    if (includeFilters) {
      const filters = await getFacilityFilterOptions();
      return NextResponse.json({ ...result, filters });
    }
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(200, n);
}
