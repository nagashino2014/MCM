import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { forcedDeptId } from "@/lib/auth/scope-guards";
import { createDirective, listDirectivesByDept, type DirectiveInput } from "@/lib/work-plan/directives";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 지시 목록 — 전사 범위가 아니면 dept 파라미터를 무시하고 본인 부서로 강제(X-01, 2026-10-19).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("work_plan.view");
    const sp = new URL(req.url).searchParams;
    let deptId = sp.get("dept") ?? "";
    const level = sp.get("level") ?? undefined;
    // 전사면 요청 부서 그대로, 아니면 허용 부서(주 소속 + 겸직, 300) 안의 요청 부서 — 밖이면 주 소속
    deptId = await forcedDeptId(ctx.userId, "work_plan.view", deptId);
    if (!deptId) return NextResponse.json({ directives: [] });
    return NextResponse.json({ directives: await listDirectivesByDept(deptId, level) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("work_plan.directive", { fallbackRoles: ["editor"] });
    const body = (await req.json()) as DirectiveInput;
    if (!body.kind) return NextResponse.json({ error: "지시 유형이 필요합니다." }, { status: 400 });
    const directiveId = await createDirective(actor.userId, body);
    return NextResponse.json({ directiveId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
