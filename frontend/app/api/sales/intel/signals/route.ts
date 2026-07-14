import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listIntelSignals } from "@/lib/intel/intel-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const sp = req.nextUrl.searchParams;
    const limitRaw = Number(sp.get("limit"));
    const offsetRaw = Number(sp.get("offset"));
    const { signals, total } = await listIntelSignals({
      source: sp.get("source") || undefined,
      signalType: sp.get("signalType") || undefined,
      matchStatus: sp.get("matchStatus") || undefined,
      status: sp.get("status") || undefined,
      grade: sp.get("grade") || undefined,
      includeDuplicates: sp.get("includeDuplicates") === "1",
      relevance: sp.get("relevance") || undefined,
      q: sp.get("q") || undefined,
      from: sp.get("from") || undefined,
      to: sp.get("to") || undefined,
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
      offset: Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : undefined,
    });
    return NextResponse.json({ signals, total });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
