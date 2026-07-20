import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listParticipantsForContracts } from "@/lib/bid/package-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 선택한 실적 계약들의 수행인력 합집합(수행인력 확정 후보) + 수동 추가 인력
// ?contractIds=a,b,c&extraIds=e1,e2
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const raw = String(req.nextUrl.searchParams.get("contractIds") ?? "");
    const contractIds = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const extraIds = String(req.nextUrl.searchParams.get("extraIds") ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (contractIds.length > 100) {
      return NextResponse.json({ error: "계약은 한 번에 최대 100건까지 조회할 수 있습니다." }, { status: 400 });
    }
    const participants = await listParticipantsForContracts(contractIds, extraIds);
    return NextResponse.json({ participants });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
