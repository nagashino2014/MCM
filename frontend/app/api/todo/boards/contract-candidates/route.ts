import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { resolveVisibleContractIds } from "@/lib/auth/contract-scope";
import { listContractCandidates } from "@/lib/todo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 프로젝트 보드 만들기 — 계약관리 용역 검색(§19-11a). GET ?q=&limit= → { contracts: TodoContractCandidate[] }.
// contract.view 가 있으면 그 가시 범위(+본인 수행 계약), 없으면 본인이 수행인력인 계약만(프로젝트 보드는 누구나 만들 수 있다).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const sp = req.nextUrl.searchParams;
    const canView = await hasPermission(ctx.userId, "contract.view").catch(() => false);
    const contractIds = canView ? await resolveVisibleContractIds(ctx.userId, "contract.view") : null;
    const limitRaw = Number(sp.get("limit") ?? 50);
    const contracts = await listContractCandidates(ctx.userId, {
      q: sp.get("q"),
      contractIds,
      participantOnly: !canView,
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
    });
    return NextResponse.json({ contracts });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
