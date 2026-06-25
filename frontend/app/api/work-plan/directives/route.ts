import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createDirective, listDirectivesByDept, type DirectiveInput } from "@/lib/work-plan/directives";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("work_plan.view");
    const sp = new URL(req.url).searchParams;
    const deptId = sp.get("dept") ?? "";
    const level = sp.get("level") ?? undefined;
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
