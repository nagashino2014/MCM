import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getPackage } from "@/lib/bid/package-store";
import { readStorageObject, binaryResponse } from "@/lib/contracts/document-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BID_TYPES = new Set(["order_plan", "prior_spec", "bid_notice"]);

// GET: 최근 생성 산출물(zip) 다운로드 — P4 보관본(최신 1건). 재생성 시 대체된다.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const sp = req.nextUrl.searchParams;
    const bidType = String(sp.get("bidType") ?? "");
    const bidId = String(sp.get("bidId") ?? "");
    if (!BID_TYPES.has(bidType) || !bidId) {
      return NextResponse.json({ error: "bidType/bidId 파라미터가 필요합니다." }, { status: 400 });
    }
    const pkg = await getPackage(bidType, bidId);
    if (!pkg?.output?.storageKey) {
      return NextResponse.json({ error: "보관된 생성본이 없습니다. 먼저 문서 생성을 실행하세요." }, { status: 404 });
    }
    const bytes = await readStorageObject(pkg.output.storageKey);
    return binaryResponse(bytes, "application/zip", pkg.output.fileName);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
