// /api/rules/internal/[docId] — 내부 규정 머리 정보·작성 중 판 저장(PATCH) · 미시행 규정 삭제(DELETE).
// 발행된 판의 조문은 고치지 않는다(판 불변) — 개정은 /revise 로 새 draft 를 만든다.

import { NextRequest, NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/auth/audit";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { ISO_DATE, parseInternalRuleMeta } from "@/lib/rules/internal-meta";
import { deleteInternalRule, getRuleVersion, updateDraftVersion, updateInternalRuleMeta } from "@/lib/rules/store";
import type { RuleBody } from "@/lib/rules/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ docId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await requirePermission("rules.manage");
    const { docId } = await params;
    const payload = (await req.json().catch(() => ({}))) as {
      meta?: Record<string, unknown>;
      versionId?: string;
      body?: RuleBody;
      effectiveDate?: string | null;
      revisionNote?: string | null;
      warnings?: string[];
    };

    try {
      if (payload.meta) {
        const { meta, error } = parseInternalRuleMeta(payload.meta);
        if (error) return NextResponse.json({ error }, { status: 400 });
        await updateInternalRuleMeta(docId, meta);
      }
      if (payload.versionId) {
        const v = await getRuleVersion(payload.versionId);
        if (!v || v.docId !== docId) return NextResponse.json({ error: "판을 찾을 수 없습니다." }, { status: 404 });
        const effectiveDate =
          payload.effectiveDate === undefined ? undefined : String(payload.effectiveDate ?? "").trim() || null;
        if (effectiveDate && !ISO_DATE.test(effectiveDate)) {
          return NextResponse.json({ error: "시행일을 YYYY-MM-DD 형식으로 입력해 주세요." }, { status: 400 });
        }
        await updateDraftVersion(payload.versionId, {
          body: payload.body,
          effectiveDate,
          revisionNote: payload.revisionNote,
          warnings: payload.warnings,
        });
      }
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "저장하지 못했습니다." }, { status: 400 });
    }

    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "internal_rule_update",
      targetTable: "rule_documents",
      targetId: docId,
      after: { meta: !!payload.meta, versionId: payload.versionId ?? null },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const ctx = await requirePermission("rules.manage");
    const { docId } = await params;
    try {
      await deleteInternalRule(docId);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "삭제하지 못했습니다." }, { status: 400 });
    }
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "internal_rule_delete",
      targetTable: "rule_documents",
      targetId: docId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
