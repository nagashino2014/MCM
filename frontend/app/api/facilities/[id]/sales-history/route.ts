import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { filterByVisibleProjects, resolveVisibleProjectSet } from "@/lib/auth/scope-guards";
import { loadUserAccess } from "@/lib/auth/rbac";
import { listFacilityProjectHistory } from "@/lib/sales/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const who = await requirePermission("sales.view");
    // 가시 영업건(sales.view 범위: 전사 / 담당 부서·부서원 관계자 / 본인 관계자)만(2026-10-19 §7.7)
    const visibleProjects = resolveVisibleProjectSet(await loadUserAccess(who.userId), "sales.view");
    const { id } = await ctx.params;
    const items = filterByVisibleProjects(await listFacilityProjectHistory(id), visibleProjects, (r) => r.projectId);
    return NextResponse.json({ items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
