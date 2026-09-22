// POST /api/rules/internal/[docId]/revise — 시행 중인 판을 복사해 개정용 draft 판을 만든다.
// 이미 작성 중인 draft 가 있으면 새로 만들지 않고 그 판을 돌려준다(개정안이 둘로 갈라지지 않게).

import { NextRequest, NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/auth/audit";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createDraftVersion, getPublishedVersion, getRuleDocument, listRuleVersions } from "@/lib/rules/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ docId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await requirePermission("rules.manage");
    const { docId } = await params;
    const doc = await getRuleDocument(docId);
    if (!doc || doc.kind !== "internal") {
      return NextResponse.json({ error: "내부 규정을 찾을 수 없습니다." }, { status: 404 });
    }

    const draft = (await listRuleVersions(docId)).find((v) => v.status === "draft");
    if (draft) return NextResponse.json({ versionId: draft.versionId, existing: true });

    const published = await getPublishedVersion(docId);
    if (!published) return NextResponse.json({ error: "시행 중인 판이 없습니다." }, { status: 400 });
    const version = await createDraftVersion({ docId, body: published.body, actorUserId: ctx.userId });
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "internal_rule_revise",
      targetTable: "rule_versions",
      targetId: version.versionId,
      after: { docId, fromVersion: published.version, version: version.version },
    });
    return NextResponse.json({ versionId: version.versionId, existing: false });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
