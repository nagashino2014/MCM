import { NextRequest, NextResponse } from "next/server";
import { getReviewQueue } from "@/lib/ieps/queries";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
  } catch (err) {
    return authErrorToResponse(err);
  }
  const { searchParams } = new URL(req.url);
  const limit = clamp(Number(searchParams.get("limit") ?? "50"), 1, 200);
  const offset = Math.max(0, Number(searchParams.get("offset") ?? "0"));
  const includeReviewed = searchParams.get("includeReviewed") === "1";

  try {
    const result = await getReviewQueue({ limit, offset, includeReviewed });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: "검수 대기열 조회 실패: " + (err as Error).message },
      { status: 500 }
    );
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
