import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listDiscoveryCandidates } from "@/lib/intel/rag-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 영업 발굴 후보 — 매칭 + 확정/후보 등급 + 미전환 신호.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const limitRaw = Number(req.nextUrl.searchParams.get("limit"));
    const candidates = await listDiscoveryCandidates(
      Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined
    );
    return NextResponse.json({ candidates });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
