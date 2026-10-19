import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { assertContractsVisible, loadVisibleContractSet } from "@/lib/auth/scope-guards";
import { loadUserAccess, resolveDeptScope } from "@/lib/auth/rbac";
import { listParticipantsForContracts } from "@/lib/bid/package-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 선택한 실적 계약들의 수행인력 합집합(수행인력 확정 후보) + 수동 추가 인력
// ?contractIds=a,b,c&extraIds=e1,e2
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("sales.view");
    const raw = String(req.nextUrl.searchParams.get("contractIds") ?? "");
    const contractIds = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const extraIds = String(req.nextUrl.searchParams.get("extraIds") ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (contractIds.length > 100) {
      return NextResponse.json({ error: "계약은 한 번에 최대 100건까지 조회할 수 있습니다." }, { status: 400 });
    }
    // 가시 계약만. 추가 인원(extraIds)의 등급·전문분야는 영업 전사 범위 보유자에게만(2026-10-19 §7.7)
    const access = await loadUserAccess(ctx.userId);
    assertContractsVisible(await loadVisibleContractSet(ctx.userId, "contract.view"), contractIds);
    const scopedExtra = resolveDeptScope(access, "sales.view").kind === "all" ? extraIds : [];
    const participants = await listParticipantsForContracts(contractIds, scopedExtra);
    return NextResponse.json({ participants });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
