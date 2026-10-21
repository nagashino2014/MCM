import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getSemanticsOverview, listUnlinkedDocs, relinkManualValue } from "@/lib/approval/semantics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 데이터 관계 맵·연결 진단(운영자용).
//   기본 = 전체 개요(양식·입력 참조·결과 원장·시스템 소스·경고)
//   ?formId=&fieldKey=[&columnKey=&entity=] = 해당 참조 슬롯의 미연결 문서 목록
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const sp = req.nextUrl.searchParams;
    const formId = sp.get("formId");
    const fieldKey = sp.get("fieldKey");
    if (formId && fieldKey) {
      return NextResponse.json({
        docs: await listUnlinkedDocs(formId, fieldKey, { columnKey: sp.get("columnKey"), entity: sp.get("entity") }),
      });
    }
    return NextResponse.json(await getSemanticsOverview());
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 직접 입력 보정(L2) — 같은 직접 입력 값의 문서를 선택한 계약·사업장에 연결한다.
//   body = { formId, fieldKey, entity: "contract"|"company", manualText, targetId }
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const entity = body.entity === "company" ? "company" : body.entity === "contract" ? "contract" : null;
    const formId = String(body.formId ?? "").trim();
    const fieldKey = String(body.fieldKey ?? "").trim();
    const manualText = String(body.manualText ?? "");
    const targetId = String(body.targetId ?? "").trim();
    if (!entity || !formId || !fieldKey || !manualText.trim() || !targetId) {
      return NextResponse.json({ error: "보정 대상(양식·항목·직접 입력 값·연결할 대상)이 모두 필요합니다." }, { status: 400 });
    }
    try {
      const result = await relinkManualValue({ formId, fieldKey, entity, manualText, targetId });
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "approval_doc_relink",
        targetTable: "approval_docs",
        targetId: `${formId}:${fieldKey}`,
        before: { manualText },
        after: { entity, targetId, label: result.label, updated: result.updated },
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  } catch (err) {
    return authErrorToResponse(err);
  }
}
