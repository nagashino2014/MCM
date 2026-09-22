// /api/rules/internal — 내부 규정(266) 목록 · 신규 작성.
// 열람은 전 임직원(rules.view) — 목록엔 시행 이력이 있는 규정만, 관리 권한자에겐 작성 중(draft)까지 보인다.
// 작성·수정·발행은 rules.manage(사규와 같은 권한).

import { NextRequest, NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/auth/audit";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { ISO_DATE, parseInternalRuleMeta } from "@/lib/rules/internal-meta";
import { createInternalRule, listRuleDocuments, listRuleVersions, nextInternalRegNo } from "@/lib/rules/store";
import type { RuleBody } from "@/lib/rules/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requirePermission("rules.view");
    const canManage = await hasPermission(ctx.userId, "rules.manage");
    const docs = await listRuleDocuments(false, "internal");
    const items = (
      await Promise.all(
        docs.map(async (doc) => {
          const versions = await listRuleVersions(doc.docId);
          return { ...doc, versions: canManage ? versions : versions.filter((v) => v.status !== "draft") };
        }),
      )
    ).filter((d) => d.versions.length > 0);
    return NextResponse.json({ documents: items, canManage, nextRegNo: canManage ? await nextInternalRegNo() : null });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("rules.manage");
    const payload = (await req.json().catch(() => ({}))) as {
      meta?: Record<string, unknown>;
      body?: RuleBody;
      effectiveDate?: string | null;
      revisionNote?: string | null;
      warnings?: string[];
    };
    const { meta, error } = parseInternalRuleMeta(payload.meta);
    if (error) return NextResponse.json({ error }, { status: 400 });
    if (!payload.body || !Array.isArray(payload.body.chapters)) {
      return NextResponse.json({ error: "조문 본문이 없습니다." }, { status: 400 });
    }
    const effectiveDate = String(payload.effectiveDate ?? "").trim() || null;
    if (effectiveDate && !ISO_DATE.test(effectiveDate)) {
      return NextResponse.json({ error: "시행일을 YYYY-MM-DD 형식으로 입력해 주세요." }, { status: 400 });
    }

    let created;
    try {
      created = await createInternalRule({
        meta,
        body: payload.body,
        warnings: payload.warnings,
        effectiveDate,
        revisionNote: payload.revisionNote ?? null,
        actorUserId: ctx.userId,
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "저장하지 못했습니다." }, { status: 400 });
    }
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "internal_rule_create",
      targetTable: "rule_documents",
      targetId: created.docId,
      after: { ...meta, versionId: created.versionId },
    });
    return NextResponse.json(created);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
