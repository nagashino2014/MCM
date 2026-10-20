import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { addFinalRule, deleteFinalRule, listFinalRules } from "@/lib/approval/final-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 전결 규정(DA-3) — 양식별 [전결] 버튼을 쓸 수 있는 사람(지정 인원·기안 부서장). 결재 운영자 전용.

// GET: 전결 규칙 목록
export async function GET() {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    return NextResponse.json({ rules: await listFinalRules() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 규칙 추가 { formId('*'=전 양식), userId | deptHead }
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as { formId?: string; userId?: string | null; deptHead?: boolean };
    const ruleId = await addFinalRule({ formId: String(body.formId ?? "*"), userId: body.userId ?? null, deptHead: !!body.deptHead });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_final_rule_create",
      targetTable: "approval_final_rules",
      targetId: ruleId,
      after: { formId: body.formId ?? "*", userId: body.userId ?? null, deptHead: !!body.deptHead },
    });
    return NextResponse.json({ ruleId, rules: await listFinalRules() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE ?ruleId= : 규칙 삭제
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const ruleId = req.nextUrl.searchParams.get("ruleId") ?? "";
    if (!ruleId) return NextResponse.json({ error: "ruleId 가 필요합니다." }, { status: 400 });
    await deleteFinalRule(ruleId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_final_rule_delete",
      targetTable: "approval_final_rules",
      targetId: ruleId,
    });
    return NextResponse.json({ rules: await listFinalRules() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
