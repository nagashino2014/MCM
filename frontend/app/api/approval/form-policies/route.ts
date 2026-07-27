import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listFormPolicies, saveFormPolicies } from "@/lib/approval/precheck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?formId= : 양식 사전검토 정책 목록(admin)
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage");
    const formId = String(req.nextUrl.searchParams.get("formId") ?? "");
    if (!formId) return NextResponse.json({ error: "formId 가 필요합니다." }, { status: 400 });
    return NextResponse.json({ policies: await listFormPolicies(formId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PutBody {
  formId?: string;
  policies?: { fieldKey: string | null; kind: string; config: Record<string, unknown>; severity: string }[];
}

// PUT : 양식 정책 전체 교체(admin)
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.manage");
    const body = (await req.json().catch(() => ({}))) as PutBody;
    if (!body.formId) return NextResponse.json({ error: "formId 가 필요합니다." }, { status: 400 });
    await saveFormPolicies(body.formId, Array.isArray(body.policies) ? body.policies : []);
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "approval_policy_update",
      targetTable: "approval_form_policies",
      targetId: body.formId,
      after: { count: body.policies?.length ?? 0 },
    });
    return NextResponse.json({ policies: await listFormPolicies(body.formId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
