import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  dryRunFormAction,
  listConnectorCatalog,
  listFormActions,
  listRecentDocsForForm,
  saveFormActions,
  type FormActionConfig,
} from "@/lib/approval/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * 양식 연계(액션 배선) 설정 API(P7) — 빌더 "연계" 섹션 전용.
 * GET  ?formId= : 설정 목록 + 커넥터 카탈로그 + 드라이런 후보 문서
 * PUT  {formId, actions[]} : 전체 동기화 저장(목록에 없는 액션은 삭제 — 실행 이력도 함께)
 * POST {formId, actionKind, fieldMap, docId} : 드라이런(실행 없이 슬롯 해석·실행 예고)
 */

export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const formId = req.nextUrl.searchParams.get("formId") ?? "";
    if (!formId) return NextResponse.json({ error: "formId가 필요합니다." }, { status: 400 });
    const [actions, recentDocs] = await Promise.all([listFormActions(formId), listRecentDocsForForm(formId)]);
    return NextResponse.json({ actions, catalog: listConnectorCatalog(), recentDocs });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as { formId?: string; actions?: FormActionConfig[] };
    const formId = String(body.formId ?? "").trim();
    if (!formId || !Array.isArray(body.actions)) {
      return NextResponse.json({ error: "formId와 actions가 필요합니다." }, { status: 400 });
    }
    const saved = await saveFormActions(formId, body.actions);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_form_actions_update",
      targetTable: "approval_form_actions",
      targetId: formId,
      after: { count: saved.length, kinds: saved.map((a) => a.actionKind) },
    });
    return NextResponse.json({ actions: saved });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as {
      formId?: string;
      actionKind?: string;
      fieldMap?: Record<string, string>;
      docId?: string;
    };
    const formId = String(body.formId ?? "").trim();
    const actionKind = String(body.actionKind ?? "").trim();
    const docId = String(body.docId ?? "").trim();
    if (!formId || !actionKind || !docId) {
      return NextResponse.json({ error: "formId·actionKind·docId가 필요합니다." }, { status: 400 });
    }
    const result = await dryRunFormAction({ formId, actionKind, fieldMap: body.fieldMap ?? {}, docId });
    return NextResponse.json({ result });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
