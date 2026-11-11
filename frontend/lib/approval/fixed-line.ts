/**
 * 양식별 고정 결재선(335) — 템플릿·역할 담당자 로드 + 기안자 기준 결재선 해석 + 관리 화면 저장.
 * 규칙(순수)은 lib/approval/fixed-line-rules.ts. 설계: docs/approval-fixed-line-plan-2026-11-03.md.
 *
 * - 저장(saveDoc)은 강제 양식이면 요청 결재선 대신 해석 결과를 쓰고, 상신(submitDoc)은 다시 해석해 대조한다.
 * - 335 적용 전(표 없음)에는 enforced:false(종전 자유 지정)로 동작한다(fixedLineReady, to_regclass).
 * - 부서장은 employee_dept_posts(300) 보직만 본다 — deptHeadUserIds 의 직급 근사는 총괄 부서에서 대표이사를
 *   부서장으로 잡으므로 고정 결재선에는 쓰지 않는다.
 */

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { postsTableExists } from "@/lib/org/posts";
import { activeRulesForDrafter, lineUserRulesReady, listLineUserRules, type LineUserRuleRow } from "@/lib/approval/line-user-rules";
import {
  insertDrafterExtras,
  isLineEnforced,
  parseEnforceWhen,
  parseHeadDrafterTo,
  parseTemplateSteps,
  pickDrafterRules,
  resolveLineSteps,
  type FixedLineFacts,
  type FixedLineStep,
  type FixedLineResult,
  type LineEnforceWhen,
  type LinePerson,
  type LineTemplate,
  type LineTemplateStep,
} from "@/lib/approval/fixed-line-rules";

export type FixedLineRole = "ceo" | "exec" | "manager" | "exec_member";
export const DEFAULT_DEPT = "*";

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function userError(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

let readySeen = false;

/** 335 적용 여부 — 트랜잭션 안에서 실패 쿼리를 catch 하지 않도록 to_regclass 로 확인(한 번 확인되면 캐시). */
export async function fixedLineReady(db?: PgDatabase): Promise<boolean> {
  if (readySeen) return true;
  const conn = db ?? (await getDb());
  const r = rowsToObjects(await conn.exec("SELECT to_regclass('approval_line_templates') IS NOT NULL AS ok"))[0];
  readySeen = r?.ok === true || r?.ok === "t" || r?.ok === 1;
  return readySeen;
}

function mapTemplate(r: Record<string, unknown>): LineTemplate {
  return {
    formId: String(r.form_id),
    steps: parseTemplateSteps(r.steps),
    enforceWhen: parseEnforceWhen(r.enforce_when),
    enabled: Number(r.enabled ?? 1) === 1,
    headDrafterTo: parseHeadDrafterTo(r.head_drafter_to),
  };
}

export async function getLineTemplate(formId: string, db?: PgDatabase): Promise<LineTemplate | null> {
  const conn = db ?? (await getDb());
  if (!(await fixedLineReady(conn))) return null;
  const rows = rowsToObjects(await conn.exec(`SELECT * FROM approval_line_templates WHERE form_id = $1`, [formId]));
  return rows.length ? mapTemplate(rows[0]) : null;
}

/** 재직·계정 연결된 사람 신원(이름·직급). */
async function loadPeople(conn: PgDatabase, userIds: string[]): Promise<Record<string, LinePerson>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return {};
  const rows = rowsToObjects(
    await conn.exec(
      `SELECT u.user_id, COALESCE(ep.name, u.email) AS name, p.position_name
         FROM users u
         JOIN employee_profiles ep ON ep.employee_id = u.employee_id AND ep.status = 'active'
         LEFT JOIN positions p ON p.position_id = ep.position_id
        WHERE u.user_id = ANY($1::text[]) AND COALESCE(u.status, 'active') = 'active'`,
      [ids]
    )
  );
  const out: Record<string, LinePerson> = {};
  for (const r of rows) {
    out[String(r.user_id)] = { userId: String(r.user_id), name: String(r.name ?? ""), position: r.position_name != null ? String(r.position_name) : null };
  }
  return out;
}

interface RoleRow {
  entryId: string;
  role: FixedLineRole;
  deptId: string;
  userId: string;
}

async function loadRoleRows(conn: PgDatabase): Promise<RoleRow[]> {
  const rows = rowsToObjects(await conn.exec(`SELECT entry_id, role, dept_id, user_id FROM approval_line_role_users`));
  return rows.map((r) => ({ entryId: String(r.entry_id), role: String(r.role) as FixedLineRole, deptId: String(r.dept_id), userId: String(r.user_id) }));
}

/** 기안 부서 기준 역할 담당자 — 부서 행 우선, 없으면 '*'. */
function pickRoleUser(rows: RoleRow[], role: "ceo" | "exec" | "manager", deptId: string | null): string | null {
  const dept = deptId ? rows.find((r) => r.role === role && r.deptId === deptId) : undefined;
  return (dept ?? rows.find((r) => r.role === role && r.deptId === DEFAULT_DEPT))?.userId ?? null;
}

/** 부서장 보직(오늘 유효·재직·계정) — 직급 근사 없음. */
async function loadDeptHeads(conn: PgDatabase, deptId: string | null): Promise<LinePerson[]> {
  if (!deptId || !(await postsTableExists(conn))) return [];
  const today = kstToday();
  const rows = rowsToObjects(
    await conn.exec(
      `SELECT DISTINCT ep.user_id
         FROM employee_dept_posts p
         JOIN employee_profiles ep ON ep.employee_id = p.employee_id AND ep.status = 'active'
        WHERE p.dept_id = $1 AND p.post_kind = 'head' AND ep.user_id IS NOT NULL AND p.revoked_at IS NULL
          AND (p.effective_from IS NULL OR p.effective_from = '' OR left(p.effective_from, 10) <= $2)
          AND (p.effective_to IS NULL OR p.effective_to = '' OR left(p.effective_to, 10) >= $2)`,
      [deptId, today]
    )
  );
  const people = await loadPeople(conn, rows.map((r) => String(r.user_id)));
  return Object.values(people).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 해석 사실 수집 — 기안자 주 소속 부서 기준. */
async function loadFacts(
  conn: PgDatabase,
  tpls: LineTemplate[],
  drafter: { userId: string; deptId: string | null; deptName: string | null },
  roleRowsIn?: RoleRow[]
): Promise<FixedLineFacts> {
  const roleRows = roleRowsIn ?? (await loadRoleRows(conn));
  const ids = {
    exec: pickRoleUser(roleRows, "exec", drafter.deptId),
    ceo: pickRoleUser(roleRows, "ceo", drafter.deptId),
    manager: pickRoleUser(roleRows, "manager", drafter.deptId),
  };
  const proxyIds = tpls.flatMap((t) => t.steps.flatMap((s) => s.proxyUserIds ?? []));
  const people = await loadPeople(conn, [...Object.values(ids).filter((v): v is string => !!v), ...proxyIds]);
  return {
    drafter,
    deptHeads: await loadDeptHeads(conn, drafter.deptId),
    roleUsers: {
      exec: ids.exec ? people[ids.exec] ?? null : null,
      ceo: ids.ceo ? people[ids.ceo] ?? null : null,
      manager: ids.manager ? people[ids.manager] ?? null : null,
    },
    drafterIsExec: roleRows.some((r) => (r.role === "exec_member" || r.role === "exec") && r.userId === drafter.userId),
    drafterIsCeo: roleRows.some((r) => r.role === "ceo" && r.userId === drafter.userId),
    people,
  };
}

async function loadDrafter(conn: PgDatabase, userId: string): Promise<{ userId: string; deptId: string | null; deptName: string | null }> {
  const r = rowsToObjects(
    await conn.exec(
      `SELECT COALESCE(ep.dept_id, u.dept_id) AS dept_id, d.dept_name
         FROM users u
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
         LEFT JOIN departments d ON d.dept_id = COALESCE(ep.dept_id, u.dept_id)
        WHERE u.user_id = $1`,
      [userId]
    )
  )[0];
  return { userId, deptId: r?.dept_id != null ? String(r.dept_id) : null, deptName: r?.dept_name != null ? String(r.dept_name) : null };
}

/** 기안자별 추가 결재자(353)를 해석 결과에 끼운다 — 재직 중인 대상만, 이름·직급은 loadPeople 로. */
async function withDrafterExtras(
  conn: PgDatabase,
  steps: FixedLineStep[],
  formId: string,
  drafterUserId: string,
  rulesIn?: LineUserRuleRow[]
): Promise<FixedLineStep[]> {
  if (!steps.length) return steps;
  if (!rulesIn && !(await lineUserRulesReady(conn))) return steps;
  const rules = pickDrafterRules(
    (rulesIn ?? (await activeRulesForDrafter(conn, drafterUserId))).filter((r) => r.kind === "approve" && r.targetActive),
    formId
  );
  if (!rules.length) return steps;
  const people = await loadPeople(conn, rules.map((r) => r.targetUserId));
  const extras = rules
    .filter((r) => people[r.targetUserId])
    .map((r) => ({ person: people[r.targetUserId], position: r.position ?? "first" }));
  return insertDrafterExtras(steps, extras, drafterUserId);
}

/** 기안자·양식·필드 값 기준 고정 결재선. enforced:false 면 종전처럼 자유 지정. */
export async function resolveFixedLine(params: {
  formId: string;
  drafterUserId: string;
  fieldValues: Record<string, unknown>;
  db?: PgDatabase;
}): Promise<FixedLineResult> {
  const conn = params.db ?? (await getDb());
  if (!(await fixedLineReady(conn))) return { enforced: false, reason: "not_ready" };
  const tpl = await getLineTemplate(params.formId, conn);
  if (!tpl || !tpl.steps.length) return { enforced: false, reason: "no_template" };
  if (!tpl.enabled) return { enforced: false, reason: "disabled" };
  if (!isLineEnforced(tpl, params.fieldValues ?? {})) return { enforced: false, reason: "condition" };
  const drafter = await loadDrafter(conn, params.drafterUserId);
  const facts = await loadFacts(conn, [tpl], drafter);
  const { steps, errors } = resolveLineSteps(tpl, facts);
  const enforceField = tpl.enforceWhen?.field ?? null;
  if (errors.length) return { enforced: true, ok: false, steps, errors, enforceField };
  // 기안자별 추가 결재자(353) — 고정 결재선이 풀린 뒤에만 끼운다
  return { enforced: true, ok: true, steps: await withDrafterExtras(conn, steps, tpl.formId, drafter.userId), enforceField };
}

// ── 관리 화면(결재 운영 > 고정 결재선) ──────────────────────────────────────

export interface LineTemplateRow extends LineTemplate {
  formName: string;
  updatedAt: string | null;
}

export interface RoleUserRow {
  entryId: string;
  role: FixedLineRole;
  deptId: string;
  deptName: string | null;
  userId: string;
  userName: string | null;
  active: boolean;
}

/** 양식 목록(사용 중) + 템플릿 — 템플릿이 없는 양식은 steps [] (자유 지정). */
export async function listLineTemplates(): Promise<LineTemplateRow[]> {
  const db = await getDb();
  const ready = await fixedLineReady(db);
  const rows = rowsToObjects(
    await db.exec(
      ready
        ? `SELECT f.form_id, f.name AS form_name, t.steps, t.enforce_when, COALESCE(t.enabled, 1) AS enabled, t.updated_at,
                  to_jsonb(t)->>'head_drafter_to' AS head_drafter_to
             FROM approval_forms f
             LEFT JOIN approval_form_folders fo ON fo.folder_id = f.folder_id
             LEFT JOIN approval_line_templates t ON t.form_id = f.form_id
            WHERE f.use_yn = 1
            ORDER BY fo.sort_order NULLS LAST, f.sort_order, f.name`
        : `SELECT f.form_id, f.name AS form_name, NULL AS steps, NULL AS enforce_when, 1 AS enabled, NULL AS updated_at
             FROM approval_forms f
             LEFT JOIN approval_form_folders fo ON fo.folder_id = f.folder_id
            WHERE f.use_yn = 1
            ORDER BY fo.sort_order NULLS LAST, f.sort_order, f.name`
    )
  );
  return rows.map((r) => ({
    ...mapTemplate(r),
    formName: String(r.form_name ?? r.form_id),
    updatedAt: r.updated_at != null ? String(r.updated_at) : null,
  }));
}

export async function listRoleUsers(): Promise<RoleUserRow[]> {
  const db = await getDb();
  if (!(await fixedLineReady(db))) return [];
  const rows = rowsToObjects(
    await db.exec(
      `SELECT r.entry_id, r.role, r.dept_id, d.dept_name, r.user_id, COALESCE(ep.name, u.email) AS user_name,
              (ep.status = 'active' AND COALESCE(u.status, 'active') = 'active') AS active
         FROM approval_line_role_users r
         LEFT JOIN departments d ON d.dept_id = r.dept_id
         LEFT JOIN users u ON u.user_id = r.user_id
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
        ORDER BY r.role, (r.dept_id = '*') DESC, d.display_order NULLS LAST, user_name`
    )
  );
  return rows.map((r) => ({
    entryId: String(r.entry_id),
    role: String(r.role) as FixedLineRole,
    deptId: String(r.dept_id),
    deptName: r.dept_id === DEFAULT_DEPT ? null : r.dept_name != null ? String(r.dept_name) : String(r.dept_id),
    userId: String(r.user_id),
    userName: r.user_name != null ? String(r.user_name) : null,
    active: r.active === true || r.active === "t" || r.active === 1,
  }));
}

/** 템플릿 저장 — steps 가 비면 템플릿을 지운다(자유 지정으로 복귀). */
export async function saveLineTemplate(
  actorUserId: string,
  input: { formId: string; steps: LineTemplateStep[]; enforceWhen: LineEnforceWhen | null; enabled: boolean; headDrafterTo?: "exec" | "ceo" | null }
): Promise<void> {
  const formId = input.formId.trim();
  if (!formId) throw userError("양식을 선택하세요.");
  const steps = parseTemplateSteps(input.steps);
  if (steps.length !== (input.steps ?? []).length) throw userError("결재 단계의 역할이 올바르지 않습니다.");
  const enforceWhen = input.enforceWhen ? parseEnforceWhen(input.enforceWhen) : null;
  if (input.enforceWhen && !enforceWhen) throw userError("강제 조건의 필드 키를 입력하세요.");
  const headDrafterTo = parseHeadDrafterTo(input.headDrafterTo);
  const db = await getDb();
  if (!(await fixedLineReady(db))) throw userError("고정 결재선 표(335)가 아직 적용되지 않았습니다.", 409);
  const headColumn = rowsToObjects(
    await db.exec(`SELECT 1 FROM information_schema.columns WHERE table_name = 'approval_line_templates' AND column_name = 'head_drafter_to'`)
  ).length > 0;
  if (headDrafterTo && !headColumn) throw userError("부서장 기안 옵션 열(347)이 아직 적용되지 않았습니다.", 409);
  const f = rowsToObjects(await db.exec(`SELECT 1 FROM approval_forms WHERE form_id = $1`, [formId]));
  if (!f.length) throw userError("양식을 찾을 수 없습니다.", 404);
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    const before = rowsToObjects(await txn.exec(`SELECT * FROM approval_line_templates WHERE form_id = $1`, [formId]))[0] ?? null;
    if (!steps.length) {
      await txn.run(`DELETE FROM approval_line_templates WHERE form_id = $1`, [formId]);
    } else {
      await txn.run(
        `INSERT INTO approval_line_templates (form_id, steps, enforce_when, enabled, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6)
         ON CONFLICT (form_id) DO UPDATE SET
           steps = EXCLUDED.steps, enforce_when = EXCLUDED.enforce_when, enabled = EXCLUDED.enabled,
           updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
        [formId, JSON.stringify(steps), enforceWhen ? JSON.stringify(enforceWhen) : null, input.enabled ? 1 : 0, actorUserId, now]
      );
      if (headColumn) {
        await txn.run(`UPDATE approval_line_templates SET head_drafter_to = $2 WHERE form_id = $1`, [formId, headDrafterTo]);
      }
    }
    await recordAuditLogInline(txn, {
      actorUserId,
      action: "approval_line_template_save",
      targetTable: "approval_line_templates",
      targetId: formId,
      before,
      after: steps.length ? { steps, enforceWhen, enabled: input.enabled, headDrafterTo } : null,
    });
  });
}

/** 역할 담당자 지정 — ceo·exec·manager 는 (역할, 부서) 당 1명이라 같은 자리를 바꿔 끼운다. exec_member 는 사람 추가. */
export async function setRoleUser(actorUserId: string, input: { role: FixedLineRole; deptId?: string | null; userId: string }): Promise<void> {
  const role = input.role;
  if (!["ceo", "exec", "manager", "exec_member"].includes(role)) throw userError("역할이 올바르지 않습니다.");
  const deptId = role === "exec" ? input.deptId?.trim() || DEFAULT_DEPT : DEFAULT_DEPT;
  const userId = input.userId?.trim();
  if (!userId) throw userError("담당자를 선택하세요.");
  const db = await getDb();
  if (!(await fixedLineReady(db))) throw userError("고정 결재선 표(335)가 아직 적용되지 않았습니다.", 409);
  const people = await loadPeople(db, [userId]);
  if (!people[userId]) throw userError("재직 중이고 계정이 있는 직원만 지정할 수 있습니다.");
  if (deptId !== DEFAULT_DEPT) {
    const d = rowsToObjects(await db.exec(`SELECT 1 FROM departments WHERE dept_id = $1 AND is_active = 1`, [deptId]));
    if (!d.length) throw userError("사용 중인 부서가 아닙니다.");
  }
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    if (role === "exec_member") {
      await txn.run(
        `INSERT INTO approval_line_role_users (entry_id, role, dept_id, user_id, updated_by, updated_at)
         VALUES ($1, 'exec_member', '*', $2, $3, $4) ON CONFLICT DO NOTHING`,
        ["alr-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14), userId, actorUserId, now]
      );
    } else {
      const before = rowsToObjects(
        await txn.exec(`SELECT * FROM approval_line_role_users WHERE role = $1 AND dept_id = $2`, [role, deptId])
      )[0];
      if (before) {
        await txn.run(`UPDATE approval_line_role_users SET user_id = $2, updated_by = $3, updated_at = $4 WHERE entry_id = $1`, [
          String(before.entry_id), userId, actorUserId, now,
        ]);
      } else {
        await txn.run(
          `INSERT INTO approval_line_role_users (entry_id, role, dept_id, user_id, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          ["alr-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14), role, deptId, userId, actorUserId, now]
        );
      }
    }
    await recordAuditLogInline(txn, {
      actorUserId,
      action: "approval_line_role_set",
      targetTable: "approval_line_role_users",
      targetId: `${role}:${deptId}`,
      after: { role, deptId, userId },
    });
  });
}

export async function deleteRoleUser(actorUserId: string, entryId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    const before = rowsToObjects(await txn.exec(`SELECT * FROM approval_line_role_users WHERE entry_id = $1`, [entryId]))[0];
    if (!before) throw userError("담당자 행을 찾을 수 없습니다.", 404);
    await txn.run(`DELETE FROM approval_line_role_users WHERE entry_id = $1`, [entryId]);
    await recordAuditLogInline(txn, { actorUserId, action: "approval_line_role_delete", targetTable: "approval_line_role_users", targetId: entryId, before });
  });
}

/** 부서별 임원 지정용 — 사용 중인 부서. */
export async function listLineDepartments(): Promise<Array<{ deptId: string; deptName: string }>> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT dept_id, dept_name FROM departments WHERE is_active = 1 ORDER BY display_order, dept_name`));
  return rows.map((r) => ({ deptId: String(r.dept_id), deptName: String(r.dept_name ?? r.dept_id) }));
}

/** 미리보기 — 재직자 전원 × 강제 양식의 해석 결과(최종안 기준). */
export async function previewFixedLines(): Promise<
  Array<{ userId: string; name: string; deptName: string | null; lines: Record<string, { ok: boolean; text: string }> }>
> {
  const db = await getDb();
  if (!(await fixedLineReady(db))) return [];
  const tpls = rowsToObjects(await db.exec(`SELECT * FROM approval_line_templates WHERE enabled = 1`)).map(mapTemplate);
  const users = rowsToObjects(
    await db.exec(
      `SELECT u.user_id, ep.name, d.dept_name, d.display_order
         FROM employee_profiles ep
         JOIN users u ON u.user_id = ep.user_id AND COALESCE(u.status, 'active') = 'active'
         LEFT JOIN departments d ON d.dept_id = ep.dept_id
        WHERE ep.status = 'active'
        ORDER BY d.display_order NULLS LAST, ep.name`
    )
  );
  const roleRows = await loadRoleRows(db);
  // 기안자별 추가 결재자(353) — 한 번에 읽어 기안자별로 나눈다
  const userRules = (await listLineUserRules(db)).filter((r) => r.kind === "approve" && r.targetActive);
  const out = [];
  for (const u of users) {
    const drafter = await loadDrafter(db, String(u.user_id));
    const facts = await loadFacts(db, tpls, drafter, roleRows);
    const myRules = userRules.filter((r) => r.drafterUserId === drafter.userId);
    const lines: Record<string, { ok: boolean; text: string }> = {};
    for (const tpl of tpls) {
      if (!tpl.steps.length) continue;
      const { steps: base, errors } = resolveLineSteps(tpl, facts);
      const steps = errors.length || !myRules.length ? base : await withDrafterExtras(db, base, tpl.formId, drafter.userId, myRules);
      lines[tpl.formId] = errors.length
        ? { ok: false, text: errors.join(" / ") }
        : {
            ok: true,
            text: steps
              .map((s) => s.name + (s.role === "extra" ? "(추가)" : "") + (s.proxies.length ? `(대결 ${s.proxies.map((p) => p.name).join("·")})` : ""))
              .join(" → "),
          };
    }
    out.push({ userId: String(u.user_id), name: String(u.name ?? ""), deptName: u.dept_name != null ? String(u.dept_name) : null, lines });
  }
  return out;
}
