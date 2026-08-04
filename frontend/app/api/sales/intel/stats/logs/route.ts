import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getIntelCollectLogs, type IntelLogGranularity } from "@/lib/intel/intel-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRANULARITIES: IntelLogGranularity[] = ["day", "week", "month", "year"];

// 전체 수집 로그(전체 보기 모달) — granularity=day|week|month|year, page/pageSize 페이지네이션.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const sp = req.nextUrl.searchParams;
    const gRaw = (sp.get("granularity") ?? "day") as IntelLogGranularity;
    const granularity = GRANULARITIES.includes(gRaw) ? gRaw : "day";
    const page = Number(sp.get("page")) > 0 ? Number(sp.get("page")) : 1;
    const pageSize = Number(sp.get("pageSize")) > 0 ? Number(sp.get("pageSize")) : 15;
    const result = await getIntelCollectLogs(granularity, page, pageSize);
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
