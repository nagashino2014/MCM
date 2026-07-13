import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { indexPendingEmbeddings } from "@/lib/intel/rag-indexer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 임베딩 미보유 신호를 배치 적재. body: { limit?: number } (기본 200, 최대 500)
export async function POST(req: NextRequest) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json().catch(() => ({}))) as { limit?: number };
    const limitRaw = Number(body.limit);
    const result = await indexPendingEmbeddings(
      Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined
    );
    if (!result.configured) {
      return NextResponse.json(
        { error: "VOYAGE_API_KEY가 설정되지 않아 임베딩을 적재할 수 없습니다." },
        { status: 503 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
