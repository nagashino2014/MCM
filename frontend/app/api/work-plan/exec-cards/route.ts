import { hasGlobalScope } from "@/lib/auth/rbac";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getReporterContext, listExecCards } from "@/lib/work-plan/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 임원/감독 카드 — filter: merged(통합완료·임원) | re_reported(재보고·임원) | directed(임원지시·감독).
// non-admin 은 본인 부서로 강제.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("work_plan.view");
    const sp = new URL(req.url).searchParams;
    const filter = (sp.get("filter") ?? "merged") as "merged" | "directed" | "re_reported";
    if (!["merged", "directed", "re_reported"].includes(filter)) {
      return NextResponse.json({ error: "invalid filter" }, { status: 400 });
    }
    let deptId = sp.get("dept") ?? "";
    if (!(await hasGlobalScope(ctx.userId, "work_plan.view"))) {
      const reporter = await getReporterContext(ctx.userId);
      deptId = reporter.deptId ?? "";
    }
    if (!deptId) return NextResponse.json({ cards: [] });
    return NextResponse.json({ cards: await listExecCards(deptId, filter) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
