import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listActivePackages } from "@/lib/bid/package-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 입찰 서류 생성 진행 중(draft) 패키지 목록 — 공공입찰 메인 상단 바로가기 카드
export async function GET() {
  try {
    await requirePermission("sales.view");
    const packages = await listActivePackages(10);
    return NextResponse.json({ packages });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
