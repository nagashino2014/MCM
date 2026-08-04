import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getSource } from "@/lib/scraper/sources-store";
import { listRunLogs } from "@/lib/scraper/run-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ sourceId: string }>;
}

// 소스별 수집 실행 로그(기본 최근 5일) — 야간배치/수동/백필 실행 내역.
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("sales.view");
    const { sourceId } = await ctx.params;
    const source = await getSource(sourceId);
    if (!source) return NextResponse.json({ error: "소스를 찾을 수 없습니다." }, { status: 404 });
    const daysRaw = Number(req.nextUrl.searchParams.get("days"));
    const runs = await listRunLogs(sourceId, Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : 5);
    return NextResponse.json({ runs });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
