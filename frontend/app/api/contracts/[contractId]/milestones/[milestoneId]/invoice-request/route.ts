import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { checkPermission, hasPermission, loadUserAccess } from "@/lib/auth/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string; milestoneId: string }>;
}

/**
 * 세션 사용자가 이 계약에 대해 발행 요청/취소를 할 수 있는지 판정한다.
 * - admin/editor: 허용(billing.edit 계열 폴백과 동일한 결).
 * - 그 외: 해당 계약 service_participants 참여자(본인)만 허용.
 * 반환: 사용자의 employee_id(없으면 null) — 요청자 기록·본인 판정에 사용.
 */
async function resolveRequester(
  userId: string,
  role: string,
  contractId: string
): Promise<{ allowed: boolean; employeeId: string | null }> {
  const access = await loadUserAccess(userId);
  const employeeId = access.employeeId ?? null;
  // role 대신 권한으로 — billing.edit 보유자는 참여 여부와 무관하게 요청할 수 있다.
  if (checkPermission(access, "billing.edit")) return { allowed: true, employeeId };
  if (!employeeId) return { allowed: false, employeeId: null };
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      "SELECT 1 FROM service_participants WHERE contract_id = $1 AND employee_id = $2 LIMIT 1",
      [contractId, employeeId]
    )
  );
  return { allowed: rows.length > 0, employeeId };
}

/** 발행 요청 — requested_at/by/note 기록 + 회계 대상 운영 알림 발행. */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId, milestoneId } = await ctx.params;
    const actor = await requireSession();
    const { allowed, employeeId } = await resolveRequester(actor.userId, actor.role, contractId);
    if (!allowed) throw new AuthError("이 계약의 발행 요청 권한이 없습니다.", 403);

    const body = await req.json().catch(() => ({}));
    const note = String(body?.note ?? "").trim() || null;
    const now = new Date().toISOString();

    const result = await withDbWrite(async (db) => {
      const rows = rowsToObjects(
        await db.exec(
          `SELECT m.stage_label, m.amount, m.invoice_issued, m.invoice_requested_at,
                  c.contract_title, f.company_name AS facility_name
             FROM contract_payment_milestones m
             JOIN contracts c ON c.contract_id = m.contract_id
             LEFT JOIN facilities f ON f.facility_id = c.counterparty_facility_id
            WHERE m.milestone_id = $1 AND m.contract_id = $2`,
          [milestoneId, contractId]
        )
      );
      if (rows.length === 0) throw new AuthError("대금 단계를 찾을 수 없습니다.", 404);
      const row = rows[0];
      if (Number(row.invoice_issued ?? 0) === 1) {
        throw new AuthError("이미 발행 완료된 단계입니다.", 409);
      }
      if (row.invoice_requested_at) {
        throw new AuthError("이미 발행 요청된 단계입니다.", 409);
      }

      await db.run(
        `UPDATE contract_payment_milestones
            SET invoice_requested_at = $1, invoice_requested_by = $2, invoice_request_note = $3, updated_at = $1
          WHERE milestone_id = $4 AND contract_id = $5`,
        [now, employeeId, note, milestoneId, contractId]
      );

      const stageLabel = row.stage_label != null ? String(row.stage_label) : "";
      const contractTitle = row.contract_title != null ? String(row.contract_title) : "";
      const facilityName = row.facility_name != null ? String(row.facility_name) : "";
      const requesterName = String(
        rowsToObjects(
          await db.exec("SELECT name FROM employee_profiles WHERE employee_id = $1", [employeeId])
        )[0]?.name ?? actor.email
      );
      const title = `세금계산서 발행 요청 · ${contractTitle || facilityName}`;
      const bodyText = `${requesterName} 님이 "${stageLabel}" 단계 발행을 요청했습니다.${
        note ? ` (${note})` : ""
      }`;
      await db.run(
        `INSERT INTO alerts (severity, source, code, title, body, payload_json, created_at)
         VALUES ('info', 'billing', 'invoice-request', $1, $2, $3::jsonb, $4)`,
        [
          title,
          bodyText,
          JSON.stringify({
            contractId,
            milestoneId,
            contractTitle,
            facilityName,
            stageLabel,
            amount: row.amount != null ? Number(row.amount) : null,
            requestedBy: employeeId,
            requestedByName: requesterName,
            note,
          }),
          now,
        ]
      );

      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "invoice_request",
        targetTable: "contract_payment_milestones",
        targetId: milestoneId,
        after: { contractId, note, requestedBy: employeeId },
      });
      return { requestedAt: now };
    });

    return NextResponse.json({ ok: true, requestedAt: result.requestedAt });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 발행 요청 취소 — 요청자 본인만. requested_at/by/note 를 비운다. */
export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const { contractId, milestoneId } = await ctx.params;
    const actor = await requireSession();
    const access = await loadUserAccess(actor.userId);
    const employeeId = access.employeeId ?? null;
    const now = new Date().toISOString();

    await withDbWrite(async (db) => {
      const rows = rowsToObjects(
        await db.exec(
          "SELECT invoice_requested_by, invoice_requested_at FROM contract_payment_milestones WHERE milestone_id = $1 AND contract_id = $2",
          [milestoneId, contractId]
        )
      );
      if (rows.length === 0) throw new AuthError("대금 단계를 찾을 수 없습니다.", 404);
      if (!rows[0].invoice_requested_at) throw new AuthError("요청 상태가 아닙니다.", 400);
      // 요청 취소는 요청자 본인만(admin 은 예외적으로 허용).
      const requestedBy = rows[0].invoice_requested_by != null ? String(rows[0].invoice_requested_by) : null;
      const canManage = await hasPermission(actor.userId, "billing.receivable.manage");
      if (!canManage && (!employeeId || requestedBy !== employeeId)) {
        throw new AuthError("요청자 본인만 취소할 수 있습니다.", 403);
      }
      await db.run(
        `UPDATE contract_payment_milestones
            SET invoice_requested_at = NULL, invoice_requested_by = NULL, invoice_request_note = NULL, updated_at = $1
          WHERE milestone_id = $2 AND contract_id = $3`,
        [now, milestoneId, contractId]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "invoice_request_cancel",
        targetTable: "contract_payment_milestones",
        targetId: milestoneId,
        before: { requestedBy },
        after: { contractId },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
