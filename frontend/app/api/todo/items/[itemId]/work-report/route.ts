import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createWorkReportDraft } from "@/lib/todo/work-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

// 할 일 → 업무 보고 초안(§25-3). POST { ai?: boolean } → { reportId, href, updated, aiUsed, periodStart, periodEnd }.
// 보고 작성 권한(work_plan.edit)이 필요하다 — 생성 뒤 사용자가 /work-plan/[reportId] 에서 검토·제출한다.
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const actor = await requirePermission("work_plan.edit", { fallbackRoles: ["editor"] });
    const { itemId } = await context.params;
    const body = (await req.json().catch(() => ({}))) as { ai?: unknown };
    const result = await createWorkReportDraft(actor.userId, itemId, { ai: body.ai !== false });
    return NextResponse.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 400) return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    return authErrorToResponse(err);
  }
}
