// GET /api/rules — 규정 목록 + 각 규정의 판 이력(RB-P0/P1).
// 열람은 전 임직원(rules.view), 판 목록에는 draft 도 포함되므로 관리 권한 여부로 걸러 준다.

import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { listRuleDocuments, listRuleVersions } from "@/lib/rules/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requirePermission("rules.view");
    const canManage = await hasPermission(ctx.userId, "rules.manage");
    const docs = await listRuleDocuments();
    const items = await Promise.all(
      docs.map(async (doc) => {
        const versions = await listRuleVersions(doc.docId);
        return {
          ...doc,
          versions: canManage ? versions : versions.filter((v) => v.status !== "draft"),
        };
      }),
    );
    return NextResponse.json({ documents: items, canManage });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
