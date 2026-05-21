import { NextRequest, NextResponse } from "next/server";
import { getRecentFacilities } from "@/lib/ieps/queries";
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
  const limitParam = Number(searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 10;

  try {
    const items = await getRecentFacilities(limit);
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { error: "사업장 조회 실패: " + (err as Error).message },
      { status: 500 }
    );
  }
}
