import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listDepEdges } from "@/lib/todo/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 의존 간선 일괄 조회(§29-1 타임라인 화살표) — GET ?itemIds=a,b,c → { edges: [{ itemId, dependsOnItemId }] }. 양쪽 모두 요청 집합에 있고 가시 범위인 것만.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const raw = req.nextUrl.searchParams.get("itemIds") ?? "";
    const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 500);
    return NextResponse.json({ edges: ids.length ? await listDepEdges(ctx.userId, ids) : [] });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
