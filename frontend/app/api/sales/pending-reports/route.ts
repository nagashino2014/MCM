import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { filterByVisibleProjects, resolveVisibleProjectSet } from "@/lib/auth/scope-guards";
import { loadUserAccess } from "@/lib/auth/rbac";
import { listPendingProgressReports } from "@/lib/sales/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requirePermission("sales.view");
    // 가시 영업건(sales.view 범위: 전사 / 담당 부서·부서원 관계자 / 본인 관계자)만(2026-10-19 §7.7)
    const visibleProjects = resolveVisibleProjectSet(await loadUserAccess(ctx.userId), "sales.view");
    const reports = filterByVisibleProjects(await listPendingProgressReports(), visibleProjects, (r) => r.projectId);
    return NextResponse.json({ reports });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
