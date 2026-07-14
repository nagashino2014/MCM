import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { searchSimilarSignals } from "@/lib/intel/rag-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 유사 신호 검색(브리핑 없이 탐색만). q 필수, 필터는 브리핑과 동일.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") ?? "").trim();
    if (!q) return NextResponse.json({ error: "q 파라미터가 필요합니다." }, { status: 400 });
    const topKRaw = Number(sp.get("topK"));
    const { hits, mode } = await searchSimilarSignals(
      q,
      {
        source: sp.get("source") || undefined,
        grade: sp.get("grade") || undefined,
        relevance: sp.get("relevance") || undefined,
        matchStatus: sp.get("matchStatus") || undefined,
        from: sp.get("from") || undefined,
        to: sp.get("to") || undefined,
      },
      Number.isFinite(topKRaw) && topKRaw > 0 ? topKRaw : undefined
    );
    return NextResponse.json({ hits, mode });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
