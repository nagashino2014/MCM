/**
 * 용역 유형별 계약 열람 부여(contract_type_view_grants, 377) — 계정·권한 관리 화면의 "용역 유형별 계약 열람" 칸.
 *
 * 특정 계정에게 특정 용역 대분류(선택하면 세분류까지)의 계약 전체 열람을 준다. 열람 전용이며 contract.view 를 가진
 * 계정에게만 효력이 있다 — 판정은 lib/auth/rbac.ts(loadTypeViewContractIds·checkPermission)와
 * lib/auth/contract-scope.ts(목록 범위)가 같은 계약 집합으로 한다.
 * 377 적용 전(표 없음)에는 목록이 비고 tableReady=false 를 돌려 화면이 안내를 띄운다.
 */

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export interface ContractTypeViewGrantRow {
  grantId: string;
  userId: string;
  serviceType: string;
  /** null = 그 대분류 전체 */
  serviceSubtype: string | null;
  note: string | null;
  createdAt: string | null;
  /** 지금 이 부여로 열리는 계약 수(삭제된 계약 제외) */
  contractCount: number;
}

export class ContractTypeViewGrantInputError extends Error {}

function isMissingTable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "42P01";
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 계정의 미회수 부여 목록. */
export async function listContractTypeViewGrants(
  userId: string
): Promise<{ tableReady: boolean; grants: ContractTypeViewGrantRow[] }> {
  const db = await getDb();
  try {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT g.grant_id, g.user_id, g.service_type, g.service_subtype, g.note, g.created_at,
                (SELECT COUNT(*)::int FROM contracts c
                  WHERE c.deleted_at IS NULL
                    AND c.service_type = g.service_type
                    AND (g.service_subtype IS NULL OR g.service_subtype = c.service_subtype)) AS contract_count
           FROM contract_type_view_grants g
          WHERE g.user_id = $1 AND g.revoked_at IS NULL
          ORDER BY g.created_at, g.grant_id`,
        [userId]
      )
    );
    return {
      tableReady: true,
      grants: rows.map((r) => ({
        grantId: String(r.grant_id),
        userId: String(r.user_id),
        serviceType: String(r.service_type),
        serviceSubtype: r.service_subtype != null ? String(r.service_subtype) : null,
        note: r.note != null ? String(r.note) : null,
        createdAt: r.created_at != null ? new Date(String(r.created_at)).toISOString() : null,
        contractCount: Number(r.contract_count ?? 0),
      })),
    };
  } catch (err) {
    if (isMissingTable(err)) return { tableReady: false, grants: [] };
    throw err;
  }
}

/** 부여 — 같은 계정·대분류·세분류의 미회수 부여가 있거나, 대분류 전체 부여가 이미 그 세분류를 덮으면 거절한다. */
export async function createContractTypeViewGrant(
  actorUserId: string,
  input: { userId?: unknown; serviceType?: unknown; serviceSubtype?: unknown; note?: unknown }
): Promise<string> {
  const userId = clean(input.userId);
  const serviceType = clean(input.serviceType);
  const serviceSubtype = clean(input.serviceSubtype) || null;
  const note = clean(input.note).slice(0, 200) || null;
  if (!userId) throw new ContractTypeViewGrantInputError("계정을 선택하세요.");
  if (!serviceType) throw new ContractTypeViewGrantInputError("용역 대분류를 선택하세요.");

  const grantId = `ctvg_${crypto.randomBytes(8).toString("hex")}`;
  try {
    await withDbWrite(async (db) => {
      const users = rowsToObjects(await db.exec("SELECT 1 AS ok FROM users WHERE user_id = $1", [userId]));
      if (!users.length) throw new ContractTypeViewGrantInputError("계정을 찾을 수 없습니다.");
      const existing = rowsToObjects(
        await db.exec(
          `SELECT service_subtype FROM contract_type_view_grants
            WHERE user_id = $1 AND service_type = $2 AND revoked_at IS NULL
              AND (service_subtype IS NULL OR service_subtype = $3)`,
          [userId, serviceType, serviceSubtype]
        )
      );
      if (existing.some((r) => r.service_subtype == null) && serviceSubtype) {
        throw new ContractTypeViewGrantInputError(`'${serviceType}' 전체 열람이 이미 부여되어 있어 세분류를 따로 넣을 필요가 없습니다.`);
      }
      if (existing.length) throw new ContractTypeViewGrantInputError("같은 유형의 열람이 이미 부여되어 있습니다.");
      await db.run(
        `INSERT INTO contract_type_view_grants (grant_id, user_id, service_type, service_subtype, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [grantId, userId, serviceType, serviceSubtype, note, actorUserId]
      );
      await recordAuditLogInline(db, {
        actorUserId,
        action: "permission_assignment_update",
        targetTable: "contract_type_view_grants",
        targetId: grantId,
        after: { userId, serviceType, serviceSubtype, note },
      });
    });
  } catch (err) {
    if (isMissingTable(err)) {
      throw new ContractTypeViewGrantInputError("용역 유형별 계약 열람 설정이 아직 설치되지 않았습니다(마이그레이션 377).");
    }
    throw err;
  }
  return grantId;
}

/** 회수 — 행을 지우지 않고 revoked_at 을 남긴다. */
export async function revokeContractTypeViewGrant(actorUserId: string, grantIdInput: unknown): Promise<void> {
  const grantId = clean(grantIdInput);
  if (!grantId) throw new ContractTypeViewGrantInputError("grantId가 필요합니다.");
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec(
        `UPDATE contract_type_view_grants SET revoked_at = now(), revoked_by = $2
          WHERE grant_id = $1 AND revoked_at IS NULL
        RETURNING user_id, service_type, service_subtype`,
        [grantId, actorUserId]
      )
    );
    if (!rows.length) throw new ContractTypeViewGrantInputError("이미 회수되었거나 없는 부여입니다.");
    await recordAuditLogInline(db, {
      actorUserId,
      action: "permission_assignment_update",
      targetTable: "contract_type_view_grants",
      targetId: grantId,
      before: {
        userId: rows[0].user_id,
        serviceType: rows[0].service_type,
        serviceSubtype: rows[0].service_subtype ?? null,
      },
      after: { revoked: true },
    });
  });
}
