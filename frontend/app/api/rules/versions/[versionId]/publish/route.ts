// POST /api/rules/versions/[versionId]/publish — 검수 끝난 판을 시행판으로 세운다(RB-P0).
// 직전 published 는 superseded 로 내려가고 과거 판 열람 경로로 남는다.
// ⚠ 발행 후에는 body 수정 경로가 없다 — 동의·신고 산출물의 근거이기 때문(store.ts 주석).

import { NextRequest, NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/auth/audit";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getRuleVersion, publishVersion } from "@/lib/rules/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ versionId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await requirePermission("rules.manage");
    const { versionId } = await params;
    const payload = (await req.json().catch(() => ({}))) as { effectiveDate?: string };

    const current = await getRuleVersion(versionId);
    if (!current) return NextResponse.json({ error: "판을 찾을 수 없습니다." }, { status: 404 });

    const effectiveDate = String(payload.effectiveDate ?? current.effectiveDate ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      return NextResponse.json({ error: "시행일을 YYYY-MM-DD 형식으로 입력해 주세요." }, { status: 400 });
    }

    try {
      await publishVersion({ versionId, effectiveDate, actorUserId: ctx.userId });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "발행하지 못했습니다." }, { status: 400 });
    }

    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "rule_version_publish",
      targetTable: "rule_versions",
      targetId: versionId,
      after: { docId: current.docId, version: current.version, effectiveDate },
    });
    return NextResponse.json({ version: await getRuleVersion(versionId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
