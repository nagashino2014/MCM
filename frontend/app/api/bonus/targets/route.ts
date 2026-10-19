import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { filterRowsByDeptScope, loadUserAccess, resolveDeptScope } from "@/lib/auth/rbac";
import { parsePeriod } from "@/lib/bonus/source";
import { listBonusTargets } from "@/lib/bonus/targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 지급 대상 LIST — 해당 반기 세금계산서 발행 실적이 있는 용역(분류 필터는 클라이언트).
 * 범위(2026-10-19): bonus.view 가 전사(all)가 아니면 수행부서(owningDeptId)가 본인 부서 범위인 용역만 내린다 —
 * 부서장(self_dept)은 소속 본부 용역만, 수행부서 미지정 용역은 전사 범위 보유자에게만 보인다.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("bonus.view", { fallbackRoles: ["editor"] });
    const p = parsePeriod(new URL(req.url).searchParams.get("period") ?? "");
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    const [targets, access] = await Promise.all([listBonusTargets(p), loadUserAccess(ctx.userId)]);
    const scope = resolveDeptScope(access, "bonus.view");
    return NextResponse.json({
      period: `${p.year}-${p.half}`,
      targets: filterRowsByDeptScope(targets, scope, (t) => t.owningDeptId),
      scope: scope.kind,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
