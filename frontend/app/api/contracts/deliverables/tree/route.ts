import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { resolveVisibleContractIds } from "@/lib/auth/contract-scope";
import { listContractsForTree } from "@/lib/ieps/contracts";
import { resolveDeliverableContractIds } from "@/lib/deliverable/scope";

/**
 * 착수계·준공계 작성 화면의 계약 트리 — /contracts/downloads 와 같은 트리 구조를 쓰되,
 * 작성 권한 범위(관리자=전체 / 실무자=본인이 수행인력인 계약)를 추가로 교집합한다.
 * 계약이 하나도 없는 용역분류(부모 노드)는 응답에서 제외한다.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("contract.view");
    const visible = await resolveVisibleContractIds(ctx.userId, "contract.view");
    const mine = await resolveDeliverableContractIds(ctx.userId, ctx.role);

    // RBAC 가시 범위 ∩ 작성 권한 범위. 어느 한쪽이라도 null 이면 그쪽은 제한 없음.
    let ids: string[] | null = visible;
    if (mine != null) {
      ids = visible == null ? mine : visible.filter((id) => mine.includes(id));
    }

    const sp = req.nextUrl.searchParams;
    const payload = await listContractsForTree(sp.get("year"), sp.get("dept"), ids);
    const groups = (payload.groups ?? []).filter((g) => (g.contracts?.length ?? 0) > 0);
    return NextResponse.json({ ...payload, groups, scoped: mine != null });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
