/**
 * 기안자별 추가 결재자·참조·열람 규칙(353) — 직원 요청을 받아 관리자가 "이 직원이 기안하면 OOO를 결재선에 넣는다/참조·열람에 넣는다"를 정한다.
 * 고정 결재선(335) 해석 결과에 끼우고(resolveFixedLine), 참조·열람은 모든 양식 고정 참조·열람(346)과 함께 넣는다(applyFixedWatchers).
 *
 * - 결재자 추가는 고정 결재선이 강제되는 양식에만 적용한다(자유 지정·초안 단계는 기안자가 직접 고른다).
 * - 기안자 본인·이미 결재선에 있는 사람·퇴사·계정 없는 사람은 건너뛴다 — 규칙 때문에 상신이 막히지 않게.
 * - 353 적용 전(표 없음)에는 아무것도 하지 않는다(to_regclass).
 */

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { parseExtraPosition, type DrafterRuleKind, type DrafterRuleLite, type ExtraPosition } from "@/lib/approval/fixed-line-rules";

export interface LineUserRuleRow extends DrafterRuleLite {
  ruleId: string;
  drafterUserId: string;
  drafterName: string | null;
  drafterActive: boolean;
  formName: string | null;
  targetName: string | null;
  targetActive: boolean;
  note: string | null;
  updatedAt: string | null;
}

function userError(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

const truthy = (v: unknown) => v === true || v === "t" || v === 1;

let readySeen = false;

/** 353 적용 여부 — 트랜잭션 안에서 실패 쿼리를 catch 하지 않도록 to_regclass 로 확인(한 번 확인되면 캐시). */
export async function lineUserRulesReady(db?: PgDatabase): Promise<boolean> {
  if (readySeen) return true;
  const conn = db ?? (await getDb());
  const r = rowsToObjects(await conn.exec("SELECT to_regclass('approval_line_user_rules') IS NOT NULL AS ok"))[0];
  readySeen = truthy(r?.ok);
  return readySeen;
}

function mapRule(r: Record<string, unknown>): LineUserRuleRow {
  const kind = String(r.kind);
  return {
    ruleId: String(r.rule_id),
    drafterUserId: String(r.drafter_user_id),
    drafterName: r.drafter_name != null ? String(r.drafter_name) : null,
    drafterActive: truthy(r.drafter_active),
    formId: String(r.form_id),
    formName: r.form_id === "*" ? null : r.form_name != null ? String(r.form_name) : String(r.form_id),
    kind: kind === "ref" || kind === "view" ? kind : "approve",
    targetUserId: String(r.target_user_id),
    targetName: r.target_name != null ? String(r.target_name) : null,
    targetActive: truthy(r.target_active),
    position: kind === "approve" ? parseExtraPosition(r.position) : null,
    note: r.note != null && String(r.note).trim() ? String(r.note) : null,
    updatedAt: r.updated_at != null ? String(r.updated_at) : null,
  };
}

/** 규칙 목록(이름·재직 여부 포함). drafterUserId 를 주면 그 기안자 것만. 기안자 이름순 · 등록 순. */
export async function listLineUserRules(db?: PgDatabase, drafterUserId?: string): Promise<LineUserRuleRow[]> {
  const conn = db ?? (await getDb());
  if (!(await lineUserRulesReady(conn))) return [];
  const rows = rowsToObjects(
    await conn.exec(
      `SELECT r.*, f.name AS form_name,
              COALESCE(dep.name, du.email) AS drafter_name,
              (dep.status = 'active' AND COALESCE(du.status, 'active') = 'active') AS drafter_active,
              COALESCE(tep.name, tu.email) AS target_name,
              (tep.status = 'active' AND COALESCE(tu.status, 'active') = 'active') AS target_active
         FROM approval_line_user_rules r
         LEFT JOIN approval_forms f ON f.form_id = r.form_id
         LEFT JOIN users du ON du.user_id = r.drafter_user_id
         LEFT JOIN employee_profiles dep ON dep.employee_id = du.employee_id
         LEFT JOIN users tu ON tu.user_id = r.target_user_id
         LEFT JOIN employee_profiles tep ON tep.employee_id = tu.employee_id
        WHERE ($1::text IS NULL OR r.drafter_user_id = $1::text)
        ORDER BY drafter_name NULLS LAST, r.drafter_user_id, r.updated_at, r.rule_id`,
      [drafterUserId ?? null]
    )
  );
  return rows.map(mapRule);
}

/** 기안자 한 명의 규칙 중 재직 중인 대상만(결재선 해석·참조 적용용). */
export async function activeRulesForDrafter(conn: PgDatabase, drafterUserId: string): Promise<LineUserRuleRow[]> {
  return (await listLineUserRules(conn, drafterUserId)).filter((r) => r.targetActive);
}

const KINDS: DrafterRuleKind[] = ["approve", "ref", "view"];

/** 규칙 저장 — (기안자, 양식, 대상) 당 1행이라 같은 자리면 구분·위치·메모를 바꾼다. */
export async function setLineUserRule(
  actorUserId: string,
  input: {
    drafterUserId: string;
    formId?: string | null;
    kind: DrafterRuleKind;
    targetUserId: string;
    position?: ExtraPosition | null;
    note?: string | null;
  }
): Promise<void> {
  const drafterUserId = input.drafterUserId?.trim();
  const targetUserId = input.targetUserId?.trim();
  const formId = input.formId?.trim() || "*";
  if (!drafterUserId) throw userError("기안자(직원)를 선택하세요.");
  if (!targetUserId) throw userError("넣을 사람을 선택하세요.");
  if (drafterUserId === targetUserId) throw userError("기안자 본인은 넣을 수 없습니다.");
  if (!KINDS.includes(input.kind)) throw userError("구분이 올바르지 않습니다.");
  const position = input.kind === "approve" ? parseExtraPosition(input.position) : null;
  const note = (input.note ?? "").trim().slice(0, 200) || null;
  const db = await getDb();
  if (!(await lineUserRulesReady(db))) throw userError("기안자별 결재선 표(마이그레이션 353)가 아직 적용되지 않았습니다.", 409);
  const people = rowsToObjects(
    await db.exec(
      `SELECT u.user_id FROM users u JOIN employee_profiles ep ON ep.employee_id = u.employee_id AND ep.status = 'active'
        WHERE u.user_id = ANY($1::text[]) AND COALESCE(u.status, 'active') = 'active'`,
      [[drafterUserId, targetUserId]]
    )
  ).map((r) => String(r.user_id));
  if (!people.includes(drafterUserId) || !people.includes(targetUserId)) {
    throw userError("재직 중이고 계정이 있는 직원만 지정할 수 있습니다.");
  }
  if (formId !== "*") {
    const f = rowsToObjects(await db.exec(`SELECT 1 FROM approval_forms WHERE form_id = $1`, [formId]));
    if (!f.length) throw userError("양식을 찾을 수 없습니다.", 404);
  }
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    const before =
      rowsToObjects(
        await txn.exec(
          `SELECT * FROM approval_line_user_rules WHERE drafter_user_id = $1 AND form_id = $2 AND target_user_id = $3`,
          [drafterUserId, formId, targetUserId]
        )
      )[0] ?? null;
    await txn.run(
      `INSERT INTO approval_line_user_rules (rule_id, drafter_user_id, form_id, kind, target_user_id, position, note, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (drafter_user_id, form_id, target_user_id) DO UPDATE SET
         kind = EXCLUDED.kind, position = EXCLUDED.position, note = EXCLUDED.note,
         updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      [
        "alu-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14),
        drafterUserId,
        formId,
        input.kind,
        targetUserId,
        position,
        note,
        actorUserId,
        now,
      ]
    );
    await recordAuditLogInline(txn, {
      actorUserId,
      action: "approval_line_user_rule_set",
      targetTable: "approval_line_user_rules",
      targetId: `${drafterUserId}:${formId}:${targetUserId}`,
      before,
      after: { drafterUserId, formId, kind: input.kind, targetUserId, position, note },
    });
  });
}

export async function deleteLineUserRule(actorUserId: string, ruleId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    const before = rowsToObjects(await txn.exec(`SELECT * FROM approval_line_user_rules WHERE rule_id = $1`, [ruleId]))[0];
    if (!before) throw userError("기안자별 규칙을 찾을 수 없습니다.", 404);
    await txn.run(`DELETE FROM approval_line_user_rules WHERE rule_id = $1`, [ruleId]);
    await recordAuditLogInline(txn, {
      actorUserId,
      action: "approval_line_user_rule_delete",
      targetTable: "approval_line_user_rules",
      targetId: ruleId,
      before,
    });
  });
}
