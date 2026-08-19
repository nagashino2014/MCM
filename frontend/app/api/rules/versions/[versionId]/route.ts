// /api/rules/versions/[versionId] — 판 조회(열람·검수) · 검수 저장 · draft 폐기 (RB-P0).

import { NextRequest, NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/auth/audit";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import type { RuleBody } from "@/lib/rules/types";
import {
  deleteDraftVersion,
  getImportWarnings,
  getRuleVersion,
  markVersionRead,
  updateDraftVersion,
} from "@/lib/rules/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ versionId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = await requirePermission("rules.view");
    const { versionId } = await params;
    const version = await getRuleVersion(versionId);
    if (!version) return NextResponse.json({ error: "판을 찾을 수 없습니다." }, { status: 404 });

    const warnings = await getImportWarnings(versionId);
    // 시행 중인 판을 실제로 열어 본 기록만 남긴다(draft 검수는 열람 실적이 아니다).
    if (version.status === "published") await markVersionRead(versionId, ctx.userId);
    return NextResponse.json({ version, warnings });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PATCH — 검수 저장(draft 전용). body: { body?, effectiveDate?, revisionNote?, warnings? }
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await requirePermission("rules.manage");
    const { versionId } = await params;
    const payload = (await req.json().catch(() => ({}))) as {
      body?: RuleBody;
      effectiveDate?: string | null;
      revisionNote?: string | null;
      warnings?: string[];
    };

    try {
      await updateDraftVersion(versionId, payload);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "저장하지 못했습니다." }, { status: 400 });
    }

    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "rule_version_update",
      targetTable: "rule_versions",
      targetId: versionId,
      after: { fields: Object.keys(payload) },
    });
    const version = await getRuleVersion(versionId);
    return NextResponse.json({ version });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const ctx = await requirePermission("rules.manage");
    const { versionId } = await params;
    try {
      await deleteDraftVersion(versionId);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "삭제하지 못했습니다." }, { status: 400 });
    }
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "rule_version_delete",
      targetTable: "rule_versions",
      targetId: versionId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
