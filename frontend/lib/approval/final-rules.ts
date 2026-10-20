// 전결 규칙(DA-3) — 양식별로 [전결] 버튼을 쓸 수 있는 사람(지정 인원·기안 부서장)을 정한다(D-3).
// 설계: docs/e-approval-delegation-blueprint.md §3·§5-4. 표: approval_final_rules(301). 금액 상한(max_amount)은 DA-4.

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { deptHeadUserIds } from "@/lib/org/posts";

export const ALL_FORMS = "*";

export interface FinalRule {
  ruleId: string;
  formId: string;
  /** '*' 이면 '전 양식' */
  formName: string | null;
  userId: string | null;
  userName: string | null;
  deptHead: boolean;
  createdAt: string;
}

function userError(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

export async function listFinalRules(): Promise<FinalRule[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT r.*, f.name AS form_name, COALESCE(ep.name, u.email) AS user_name
         FROM approval_final_rules r
         LEFT JOIN approval_forms f ON f.form_id = r.form_id
         LEFT JOIN users u ON u.user_id = r.user_id
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
        ORDER BY (r.form_id = '*') DESC, f.name, r.dept_head DESC, user_name`
    )
  );
  return rows.map((r) => ({
    ruleId: String(r.rule_id),
    formId: String(r.form_id),
    formName: r.form_id === ALL_FORMS ? null : r.form_name != null ? String(r.form_name) : String(r.form_id),
    userId: r.user_id != null ? String(r.user_id) : null,
    userName: r.user_name != null ? String(r.user_name) : null,
    deptHead: Number(r.dept_head) === 1,
    createdAt: String(r.created_at),
  }));
}

/** 규칙 추가 — 대상은 지정 인원(userId) 또는 기안 부서장(deptHead) 중 하나. 같은 규칙이 있으면 거절. */
export async function addFinalRule(params: { formId: string; userId: string | null; deptHead: boolean }): Promise<string> {
  const formId = params.formId.trim() || ALL_FORMS;
  const userId = params.deptHead ? null : params.userId?.trim() || null;
  if (!params.deptHead && !userId) throw userError("전결할 수 있는 사람을 지정하거나 '기안 부서장'을 선택하세요.");
  const db = await getDb();
  if (formId !== ALL_FORMS) {
    const f = rowsToObjects(await db.exec(`SELECT 1 FROM approval_forms WHERE form_id = $1`, [formId]));
    if (!f.length) throw userError("양식을 찾을 수 없습니다.");
  }
  if (userId) {
    const u = rowsToObjects(await db.exec(`SELECT status FROM users WHERE user_id = $1`, [userId]));
    if (!u.length || String(u[0].status ?? "active") !== "active") throw userError("활성 계정만 지정할 수 있습니다.");
  }
  const ruleId = "afr-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  let inserted = false;
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(
        `INSERT INTO approval_final_rules (rule_id, form_id, user_id, dept_head, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING
         RETURNING rule_id`,
        [ruleId, formId, userId, params.deptHead ? 1 : 0, new Date().toISOString()]
      )
    );
    inserted = rows.length > 0;
  });
  if (!inserted) throw userError("이미 같은 전결 규칙이 있습니다.", 409);
  return ruleId;
}

export async function deleteFinalRule(ruleId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(`DELETE FROM approval_final_rules WHERE rule_id = $1`, [ruleId]);
  });
}

/**
 * 전결 권한 판정 — 양식(또는 전 양식) 규칙 중 actor 가 지정 인원이거나, 부서장 규칙이 있고 actor 가 문서 부서의 부서장.
 * 부서장 판정은 deptHeadUserIds(보직 표 우선, 없으면 직급 최상위 — 300 미적용 환경 포함).
 */
export async function canFinalApprove(
  db: PgDatabase,
  params: { formId: string; deptId: string | null; actorUserId: string }
): Promise<boolean> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT user_id, dept_head FROM approval_final_rules WHERE form_id = $1 OR form_id = '*'`,
      [params.formId]
    )
  );
  if (rows.some((r) => r.user_id != null && String(r.user_id) === params.actorUserId)) return true;
  if (!rows.some((r) => Number(r.dept_head) === 1) || !params.deptId) return false;
  const heads = await deptHeadUserIds(params.deptId, null, db);
  return heads.includes(params.actorUserId);
}

/** 문서 부서 — approval_docs.dept_id, 없으면 기안자 소속(employee_profiles → users). */
export async function docDeptId(db: PgDatabase, docId: string): Promise<{ formId: string; deptId: string | null } | null> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.form_id, COALESCE(d.dept_id, ep.dept_id, u.dept_id) AS dept_id
         FROM approval_docs d
         LEFT JOIN users u ON u.user_id = d.drafter_user_id
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
        WHERE d.doc_id = $1`,
      [docId]
    )
  );
  if (!rows.length) return null;
  return { formId: String(rows[0].form_id), deptId: rows[0].dept_id != null ? String(rows[0].dept_id) : null };
}
