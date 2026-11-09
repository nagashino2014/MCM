/**
 * 고정 참조·열람자(346) — 결재선(335)과 같이 관리자가 정해 두면 모든 양식(form_id '*') 또는 특정 양식 문서에
 * 서버가 참조·열람자로 넣는다. 저장(saveDoc)·상신(submitDoc) 둘 다 적용해 모바일·자동 기안·이전 임시저장도 빠지지 않는다.
 *
 * - 기안자 본인과 결재선에 이미 있는 사람(원결재자 포함)은 넣지 않는다 — 결재함에서 이미 본다.
 * - 같은 사람을 기안자가 직접 지정했으면 그 행을 그대로 둔다. 고정으로 넣은 행은 approval_watchers.fixed=1 —
 *   공문·계약서 발송 메일의 내부 Cc 는 fixed=0(직접 지정)만 받는다.
 * - 346 적용 전(표 없음)에는 아무것도 하지 않는다(to_regclass).
 */

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export type FixedWatcherKind = "ref" | "view";
export const ALL_FORMS = "*";

export interface FixedWatcherRow {
  entryId: string;
  formId: string;
  userId: string;
  userName: string | null;
  kind: FixedWatcherKind;
  active: boolean;
}

function userError(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

let readySeen = false;

/** 346 적용 여부 — 트랜잭션 안에서 실패 쿼리를 catch 하지 않도록 to_regclass 로 확인(한 번 확인되면 캐시). */
export async function fixedWatchersReady(db?: PgDatabase): Promise<boolean> {
  if (readySeen) return true;
  const conn = db ?? (await getDb());
  const r = rowsToObjects(await conn.exec("SELECT to_regclass('approval_line_watchers') IS NOT NULL AS ok"))[0];
  readySeen = r?.ok === true || r?.ok === "t" || r?.ok === 1;
  return readySeen;
}

export async function listFixedWatchers(db?: PgDatabase): Promise<FixedWatcherRow[]> {
  const conn = db ?? (await getDb());
  if (!(await fixedWatchersReady(conn))) return [];
  const rows = rowsToObjects(
    await conn.exec(
      `SELECT w.entry_id, w.form_id, w.user_id, w.kind, COALESCE(ep.name, u.email) AS user_name,
              (ep.status = 'active' AND COALESCE(u.status, 'active') = 'active') AS active
         FROM approval_line_watchers w
         LEFT JOIN users u ON u.user_id = w.user_id
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
        ORDER BY w.kind, (w.form_id = '*') DESC, user_name`
    )
  );
  return rows.map((r) => ({
    entryId: String(r.entry_id),
    formId: String(r.form_id),
    userId: String(r.user_id),
    userName: r.user_name != null ? String(r.user_name) : null,
    kind: String(r.kind) === "view" ? "view" : "ref",
    active: r.active === true || r.active === "t" || r.active === 1,
  }));
}

/** 양식에 적용할 고정 참조·열람자 — 양식 행이 같은 사람의 '*' 행을 덮어쓴다. 재직·계정 연결된 사람만. */
export function pickFormWatchers(rows: FixedWatcherRow[], formId: string): Array<{ userId: string; kind: FixedWatcherKind }> {
  const byUser = new Map<string, { userId: string; kind: FixedWatcherKind }>();
  for (const r of rows) if (r.active && r.formId === ALL_FORMS) byUser.set(r.userId, { userId: r.userId, kind: r.kind });
  for (const r of rows) if (r.active && r.formId === formId) byUser.set(r.userId, { userId: r.userId, kind: r.kind });
  return [...byUser.values()];
}

/** 기안 화면 표시용 — 기안자 본인은 뺀다(결재선 중복은 상신 시 서버가 뺀다). */
export async function fixedWatchersForForm(formId: string, drafterUserId: string): Promise<Array<{ userId: string; name: string; kind: FixedWatcherKind }>> {
  const rows = await listFixedWatchers();
  const names = new Map(rows.map((r) => [r.userId, r.userName ?? r.userId]));
  return pickFormWatchers(rows, formId)
    .filter((w) => w.userId !== drafterUserId)
    .map((w) => ({ ...w, name: names.get(w.userId) ?? w.userId }));
}

/** 문서에 고정 규칙으로 들어가 있는 참조·열람자(fixed=1) — saveDoc 이 화면에서 되돌아온 행을 자유 지정으로 오인하지 않게 쓴다. */
export async function docFixedWatcherIds(txn: PgDatabase, docId: string): Promise<Set<string>> {
  if (!(await fixedWatchersReady(txn))) return new Set();
  const rows = rowsToObjects(await txn.exec(`SELECT user_id FROM approval_watchers WHERE doc_id = $1 AND fixed = 1`, [docId]));
  return new Set(rows.map((r) => String(r.user_id)));
}

/**
 * 문서에 고정 참조·열람자를 넣는다(트랜잭션 내부). 결재선이 저장된 뒤에 부른다.
 * 기안자·결재선(원결재자 포함) 인원은 빼고, 기안자가 직접 지정한 행(fixed=0)이 있으면 그대로 둔다
 * (공문·계약서는 직접 지정한 사람만 발송 메일 Cc 를 받는다). 고정 행은 fixed=1 로 넣는다.
 */
export async function applyFixedWatchers(txn: PgDatabase, docId: string, formId: string, drafterUserId: string): Promise<void> {
  if (!(await fixedWatchersReady(txn))) return;
  const fixed = pickFormWatchers(await listFixedWatchers(txn), formId);
  const lineIds = new Set(
    rowsToObjects(
      await txn.exec(`SELECT assignee_user_id, delegated_from FROM approval_steps WHERE doc_id = $1`, [docId])
    ).flatMap((r) => [String(r.assignee_user_id ?? ""), String(r.delegated_from ?? "")])
  );
  const want = new Map(fixed.filter((w) => w.userId !== drafterUserId && !lineIds.has(w.userId)).map((w) => [w.userId, w.kind]));
  // 규칙에서 빠졌거나 결재선에 들어간 사람의 고정 행은 지운다(재상신·담당자 변경 대비)
  const existing = rowsToObjects(await txn.exec(`SELECT watcher_id, user_id, kind, fixed FROM approval_watchers WHERE doc_id = $1`, [docId]));
  for (const r of existing) {
    if (Number(r.fixed ?? 0) !== 1) continue;
    const kind = want.get(String(r.user_id));
    if (kind !== String(r.kind)) await txn.run(`DELETE FROM approval_watchers WHERE watcher_id = $1`, [String(r.watcher_id)]);
  }
  const now = new Date().toISOString();
  for (const [userId, kind] of want) {
    await txn.run(
      `INSERT INTO approval_watchers (watcher_id, doc_id, user_id, kind, created_at, fixed)
       SELECT $1, $2, $3, $4, $5, 1
        WHERE NOT EXISTS (SELECT 1 FROM approval_watchers WHERE doc_id = $2 AND user_id = $3)`,
      ["awch-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14), docId, userId, kind, now]
    );
  }
}

// ── 관리 화면(결재 운영 > 고정 결재선) ──────────────────────────────────────

/** 모든 양식 고정 참조·열람자 지정 — 같은 사람이 있으면 구분만 바꾼다. */
export async function setFixedWatcher(actorUserId: string, input: { userId: string; kind: FixedWatcherKind; formId?: string | null }): Promise<void> {
  const userId = input.userId?.trim();
  if (!userId) throw userError("담당자를 선택하세요.");
  if (input.kind !== "ref" && input.kind !== "view") throw userError("참조·열람 구분이 올바르지 않습니다.");
  const formId = input.formId?.trim() || ALL_FORMS;
  const db = await getDb();
  if (!(await fixedWatchersReady(db))) throw userError("고정 참조·열람자 표(346)가 아직 적용되지 않았습니다.", 409);
  const ok = rowsToObjects(
    await db.exec(
      `SELECT 1 FROM users u JOIN employee_profiles ep ON ep.employee_id = u.employee_id AND ep.status = 'active'
        WHERE u.user_id = $1 AND COALESCE(u.status, 'active') = 'active'`,
      [userId]
    )
  );
  if (!ok.length) throw userError("재직 중이고 계정이 있는 직원만 지정할 수 있습니다.");
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO approval_line_watchers (entry_id, form_id, user_id, kind, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (form_id, user_id) DO UPDATE SET kind = EXCLUDED.kind, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      ["alw-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14), formId, userId, input.kind, actorUserId, now]
    );
    await recordAuditLogInline(txn, {
      actorUserId,
      action: "approval_line_watcher_set",
      targetTable: "approval_line_watchers",
      targetId: `${formId}:${userId}`,
      after: { formId, userId, kind: input.kind },
    });
  });
}

export async function deleteFixedWatcher(actorUserId: string, entryId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    const before = rowsToObjects(await txn.exec(`SELECT * FROM approval_line_watchers WHERE entry_id = $1`, [entryId]))[0];
    if (!before) throw userError("고정 참조·열람자 행을 찾을 수 없습니다.", 404);
    await txn.run(`DELETE FROM approval_line_watchers WHERE entry_id = $1`, [entryId]);
    await recordAuditLogInline(txn, { actorUserId, action: "approval_line_watcher_delete", targetTable: "approval_line_watchers", targetId: entryId, before });
  });
}
