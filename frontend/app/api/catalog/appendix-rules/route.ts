import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { DEFAULT_APPENDIX_RULES } from "@/lib/catalog/appendix";
import { MASTER_DOC_ID, getAppendixRules, saveAppendixRules } from "@/lib/catalog/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 문서(판)별 부록 표시 범위 규칙 — 현재는 마스터본만(맞춤판은 스튜디오 단계에서 연다)
export async function GET() {
  try {
    await requirePermission("catalog.view");
    return NextResponse.json({ docId: MASTER_DOC_ID, rules: await getAppendixRules(MASTER_DOC_ID), defaults: DEFAULT_APPENDIX_RULES });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 표시 범위 규칙 저장 { rules }
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as { rules?: unknown };
    const before = await getAppendixRules(MASTER_DOC_ID);
    const rules = await saveAppendixRules(MASTER_DOC_ID, body.rules, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_documents",
      targetId: MASTER_DOC_ID,
      before: { appendixRules: before },
      after: { appendixRules: rules },
    });
    return NextResponse.json({ docId: MASTER_DOC_ID, rules });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
