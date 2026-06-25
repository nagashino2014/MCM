import { NextRequest, NextResponse } from "next/server";
import { withDbWrite } from "@/lib/db";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { syncReviewedFieldInline } from "@/lib/ieps/review-sync";
import { rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  reviewedValue?: string | null;
  needsReview?: boolean;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  let actor;
  try {
    actor = await requirePermission("data.review", { fallbackRoles: ["editor"] });
  } catch (err) {
    return authErrorToResponse(err);
  }
  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  try {
    const result = await withDbWrite(async (db) => {
      // 변경 전 row 조회 (sync 판단 + audit)
      const beforeR = await db.exec(
        "SELECT id, attachment_id, rule_id, raw_value, normalized_value, reviewed_value, needs_review FROM parsed_fields WHERE id = $1",
        [numId]
      );
      const beforeRows = rowsToObjects(beforeR);
      if (beforeRows.length === 0) {
        return { notFound: true } as const;
      }
      const before = beforeRows[0];

      const setClauses: string[] = [];
      const values: unknown[] = [];
      if (body.reviewedValue !== undefined) {
        setClauses.push(`reviewed_value = $${values.length + 1}`);
        values.push(body.reviewedValue);
      }
      if (body.needsReview !== undefined) {
        setClauses.push(`needs_review = $${values.length + 1}`);
        values.push(body.needsReview ? 1 : 0);
      }
      if (setClauses.length === 0) {
        return { ok: true, synced: null } as const;
      }
      values.push(numId);
      await db.run(
        `UPDATE parsed_fields SET ${setClauses.join(", ")} WHERE id = $${values.length}`,
        values as any[]
      );

      // 검수 확정 조건: reviewedValue 가 비어있지 않고 needs_review=false
      const finalReviewedValue =
        body.reviewedValue !== undefined ? body.reviewedValue : (before.reviewed_value as string | null);
      const finalNeedsReview =
        body.needsReview !== undefined
          ? body.needsReview
          : Number(before.needs_review ?? 0) === 1;

      let syncResult: { applied: boolean; reason: string } | null = null;
      if (finalReviewedValue && !finalNeedsReview) {
        const sync = await syncReviewedFieldInline(db, {
          attachmentId: String(before.attachment_id ?? ""),
          ruleId: String(before.rule_id ?? ""),
          reviewedValue: finalReviewedValue,
        });
        syncResult = { applied: sync.applied, reason: sync.reason };
        if (sync.applied) {
          await recordAuditLogInline(db, {
            actorUserId: actor.userId,
            action: "review_apply",
            targetTable: "parsed_fields",
            targetId: String(numId),
            before,
            after: {
              reviewedValue: finalReviewedValue,
              needsReview: finalNeedsReview,
              syncedFacilityId: sync.facilityId,
              syncedPermitId: sync.permitId,
              ruleId: before.rule_id,
            },
          });
        }
      }

      return { ok: true, synced: syncResult } as const;
    });

    if ("notFound" in result && result.notFound) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: "갱신 실패: " + (err as Error).message },
      { status: 500 }
    );
  }
}
