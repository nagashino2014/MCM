/**
 * 부서 보직(employee_dept_posts, 300) — 겸직·부서장 지정의 진실원(2026-10-20 겸직 설계, docs/concurrent-dept-post-design-2026-10-20.md).
 *
 * - 소속은 하나(employee_profiles.dept_id = 주 소속), 보직은 여럿. 권한의 self_dept 범위 = 활성 보직 부서 전체
 *   (lib/auth/rbac.ts loadUserAccess.postDeptIds).
 * - "부서장" = post_kind='head' 행. 주 소속 부서의 부서장도 is_primary=1 로 같은 표에 둔다.
 *   업무보고 알림·성과급 본부장 fallback·To-do 부서 보드가 deptHeadUserIds / isDeptHeadOf 로 같은 규칙을 쓴다.
 * - 부서장 보직이 있으면 tpl-dept-lead 를 보장한다(D-3): 자동 배정 id 'post-<userId>-tpl-dept-lead' 하나만 만들고
 *   보직이 모두 끝나면 이 배정만 회수한다(직급 자동 'auto-…'·수동 배정은 건드리지 않음).
 * - 300 적용 전(표 없음)에는 읽기 함수가 빈 결과/기존 규칙으로 동작한다(postsTableExists).
 */

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { normalizeDateField } from "@/lib/contracts/date-field";

export type PostKind = "head" | "member";

export interface DeptPostRow {
  postId: string;
  employeeId: string;
  employeeName: string | null;
  deptId: string;
  deptName: string | null;
  postKind: PostKind;
  title: string | null;
  isPrimary: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  note: string | null;
}

export interface SaveDeptPostInput {
  employeeId: string;
  deptId: string;
  postKind: PostKind;
  title?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  note?: string | null;
}

const LEAD_TEMPLATE = "tpl-dept-lead";

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

let postsTableSeen = false;

/**
 * employee_dept_posts(300) 존재 여부 — 적용 전 환경에서 쿼리를 건너뛰기 위해 쓴다. 트랜잭션 안에서 실패 쿼리를 catch 하면
 * 트랜잭션 전체가 중단되므로(25P02) 오류 대신 to_regclass 로 미리 확인한다. 한 번 확인되면 프로세스 동안 캐시.
 */
export async function postsTableExists(db?: PgDatabase): Promise<boolean> {
  if (postsTableSeen) return true;
  const conn = db ?? (await getDb());
  const r = rowsToObjects(await conn.exec("SELECT to_regclass('employee_dept_posts') IS NOT NULL AS ok"))[0];
  postsTableSeen = r?.ok === true || r?.ok === "t" || r?.ok === 1;
  return postsTableSeen;
}

function nullable(v: unknown): string | null {
  return v != null && v !== "" ? String(v) : null;
}

function mapPost(r: Record<string, unknown>): DeptPostRow {
  return {
    postId: String(r.post_id),
    employeeId: String(r.employee_id),
    employeeName: nullable(r.employee_name),
    deptId: String(r.dept_id),
    deptName: nullable(r.dept_name),
    postKind: r.post_kind === "head" ? "head" : "member",
    title: nullable(r.title),
    isPrimary: Number(r.is_primary ?? 0) === 1,
    effectiveFrom: nullable(r.effective_from),
    effectiveTo: nullable(r.effective_to),
    note: nullable(r.note),
  };
}

const ACTIVE_ON = `p.revoked_at IS NULL
  AND (p.effective_from IS NULL OR p.effective_from = '' OR left(p.effective_from, 10) <= $DATE)
  AND (p.effective_to IS NULL OR p.effective_to = '' OR left(p.effective_to, 10) >= $DATE)`;

/** 미해제 보직 목록(기간 미도래·경과 포함 — 관리 화면용). employeeId 를 주면 그 직원만. */
export async function listDeptPosts(employeeId?: string | null): Promise<DeptPostRow[]> {
  const db = await getDb();
  if (!(await postsTableExists(db))) return [];
  {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT p.*, ep.name AS employee_name, d.dept_name
           FROM employee_dept_posts p
           JOIN employee_profiles ep ON ep.employee_id = p.employee_id
           LEFT JOIN departments d ON d.dept_id = p.dept_id
          WHERE p.revoked_at IS NULL AND ($1::text IS NULL OR p.employee_id = $1)
          ORDER BY d.display_order NULLS LAST, p.post_kind, ep.name`,
        [employeeId ?? null]
      )
    );
    return rows.map(mapPost);
  }
}

/**
 * 부서장 로그인 계정 — 오늘 유효한 head 보직(재직자·계정 연결). 보직 기록이 없으면 종전 규칙
 * (부서 주 소속 재직자 중 직급 rank_order 최상위 1인)으로 근사한다. excludeUserId(작성자 본인)는 뺀다.
 */
export async function deptHeadUserIds(deptId: string | null, excludeUserId?: string | null, db?: PgDatabase): Promise<string[]> {
  if (!deptId) return [];
  const conn = db ?? (await getDb());
  let ids: string[] = [];
  if (await postsTableExists(conn)) {
    const rows = rowsToObjects(
      await conn.exec(
        `SELECT DISTINCT ep.user_id
           FROM employee_dept_posts p
           JOIN employee_profiles ep ON ep.employee_id = p.employee_id AND ep.status = 'active'
          WHERE p.dept_id = $1 AND p.post_kind = 'head' AND ep.user_id IS NOT NULL
            AND ${ACTIVE_ON.replace(/\$DATE/g, "$2")}`,
        [deptId, kstToday()]
      )
    );
    ids = rows.map((r) => String(r.user_id));
  }
  if (!ids.length) {
    const rows = rowsToObjects(
      await conn.exec(
        `SELECT e.user_id
           FROM employee_profiles e
           LEFT JOIN positions p ON p.position_id = e.position_id
          WHERE e.dept_id = $1 AND e.user_id IS NOT NULL AND e.status = 'active'
          ORDER BY COALESCE(p.rank_order, 0) DESC
          LIMIT 1`,
        [deptId]
      )
    );
    ids = rows.map((r) => String(r.user_id));
  }
  return ids.filter((id) => id && id !== excludeUserId);
}

/** 부서장 직원 id — 보직 기록 우선, 없으면 직급 최상위(성과급 본부장 몫 fallback 용). */
export async function deptHeadEmployeeIds(deptId: string, db?: PgDatabase): Promise<string[]> {
  const conn = db ?? (await getDb());
  if (!(await postsTableExists(conn))) return [];
  {
    const rows = rowsToObjects(
      await conn.exec(
        `SELECT DISTINCT p.employee_id
           FROM employee_dept_posts p
           JOIN employee_profiles ep ON ep.employee_id = p.employee_id AND ep.status = 'active'
          WHERE p.dept_id = $1 AND p.post_kind = 'head' AND ${ACTIVE_ON.replace(/\$DATE/g, "$2")}`,
        [deptId, kstToday()]
      )
    );
    return rows.map((r) => String(r.employee_id));
  }
}

/** 사용자가 (특정 부서 또는 어느 부서든) 오늘 유효한 부서장 보직을 가졌는가. */
export async function isDeptHeadOf(userId: string, deptId?: string | null, db?: PgDatabase): Promise<boolean> {
  const conn = db ?? (await getDb());
  if (!(await postsTableExists(conn))) return false;
  {
    const rows = rowsToObjects(
      await conn.exec(
        `SELECT 1
           FROM employee_dept_posts p
           JOIN employee_profiles ep ON ep.employee_id = p.employee_id AND ep.status = 'active'
          WHERE ep.user_id = $1 AND p.post_kind = 'head' AND ($3::text IS NULL OR p.dept_id = $3)
            AND ${ACTIVE_ON.replace(/\$DATE/g, "$2")}
          LIMIT 1`,
        [userId, kstToday(), deptId ?? null]
      )
    );
    return rows.length > 0;
  }
}

/** 오늘 유효한 보직 부서(주 소속 + 겸직) — 결재 부서 문서함 등 grant 밖 부서 판정용. */
export async function userPostDeptIds(userId: string): Promise<string[]> {
  const db = await getDb();
  const base = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(ep.dept_id, u.dept_id) AS dept_id, u.employee_id
         FROM users u LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
        WHERE u.user_id = $1 LIMIT 1`,
      [userId]
    )
  )[0];
  const out: string[] = base?.dept_id != null ? [String(base.dept_id)] : [];
  if (base?.employee_id == null || !(await postsTableExists(db))) return out;
  {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT p.dept_id FROM employee_dept_posts p
           JOIN departments d ON d.dept_id = p.dept_id AND d.is_active = 1
          WHERE p.employee_id = $1 AND ${ACTIVE_ON.replace(/\$DATE/g, "$2")}
          ORDER BY p.is_primary DESC, p.created_at`,
        [String(base.employee_id), kstToday()]
      )
    );
    for (const r of rows) if (!out.includes(String(r.dept_id))) out.push(String(r.dept_id));
  }
  return out;
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { status: 400 });
}

function normalizeDate(label: string, v: string | null | undefined): string | null {
  if (v == null || String(v).trim() === "") return null;
  const r = normalizeDateField(String(v));
  if (r.invalid || !/^\d{4}-\d{2}-\d{2}$/.test(r.value ?? "")) throw badRequest(`${label}을 8자리(YYYYMMDD)로 정확히 입력하세요.`);
  return r.value as string;
}

/**
 * 부서장 보직 ↔ tpl-dept-lead 자동 배정 동기화(D-3). 미해제 head 보직이 있으면 'post-<userId>-tpl-dept-lead' 를
 * 보직 기간(가장 이른 시작 ~ 가장 늦은 종료, 열린 보직이 있으면 무기한)으로 맞추고, 없으면 그 배정만 회수한다.
 * 다른 경로(직급 자동·수동)로 tpl-dept-lead 를 이미 가졌으면 자동 배정을 새로 만들지 않는다.
 */
async function syncPostLeadAssignment(db: PgDatabase, employeeId: string, actorUserId: string, now: string): Promise<void> {
  const u = rowsToObjects(await db.exec("SELECT user_id FROM users WHERE employee_id = $1 LIMIT 1", [employeeId]))[0];
  if (!u?.user_id) return; // 계정 미발급 — 발급 시 직급 기본 템플릿 경로가 처리
  const userId = String(u.user_id);
  const assignmentId = `post-${userId}-${LEAD_TEMPLATE}`;
  const heads = rowsToObjects(
    await db.exec(
      "SELECT effective_from, effective_to FROM employee_dept_posts WHERE employee_id = $1 AND post_kind = 'head' AND revoked_at IS NULL",
      [employeeId]
    )
  );
  if (!heads.length) {
    await db.run(
      "UPDATE user_permission_assignments SET revoked_at = $2, revoked_by = $3 WHERE assignment_id = $1 AND revoked_at IS NULL",
      [assignmentId, now, actorUserId]
    );
    return;
  }
  const other = rowsToObjects(
    await db.exec(
      `SELECT 1 FROM user_permission_assignments
        WHERE user_id = $1 AND template_id = $2 AND assignment_id <> $3 AND revoked_at IS NULL
          AND (effective_to IS NULL OR effective_to = '' OR left(effective_to, 10) >= $4)
        LIMIT 1`,
      [userId, LEAD_TEMPLATE, assignmentId, now.slice(0, 10)]
    )
  );
  if (other.length) return;
  const froms = heads.map((h) => nullable(h.effective_from)).filter((v): v is string => !!v).map((v) => v.slice(0, 10));
  const from = heads.some((h) => !nullable(h.effective_from)) || !froms.length ? now.slice(0, 10) : froms.sort()[0];
  const tos = heads.map((h) => nullable(h.effective_to));
  const to = tos.some((v) => !v) ? null : (tos as string[]).map((v) => v.slice(0, 10)).sort().reverse()[0];
  await db.run(
    `INSERT INTO user_permission_assignments
       (assignment_id, user_id, template_id, scope_override_kind, scope_override_dept_id,
        effective_from, effective_to, reason, assigned_by, assigned_at)
     VALUES ($1, $2, $3, NULL, NULL, $4, $5, $6, $7, $8)
     ON CONFLICT (assignment_id) DO UPDATE SET
       effective_from = EXCLUDED.effective_from, effective_to = EXCLUDED.effective_to,
       revoked_at = NULL, revoked_by = NULL, assigned_by = EXCLUDED.assigned_by, assigned_at = EXCLUDED.assigned_at`,
    [assignmentId, userId, LEAD_TEMPLATE, from, to, "부서장 보직 자동 부여(300)", actorUserId, now]
  );
}

async function deptName(db: PgDatabase, deptId: string | null): Promise<string | null> {
  if (!deptId) return null;
  const r = rowsToObjects(await db.exec("SELECT dept_name FROM departments WHERE dept_id = $1 LIMIT 1", [deptId]))[0];
  return r ? nullable(r.dept_name) : null;
}

/** 보직 등록 — 겸직(주 소속 외 부서) 또는 주 소속 부서의 부서장 지정. 겸직이면 인사 이력(concurrent_start)도 남긴다. */
export async function createDeptPost(actorUserId: string, input: SaveDeptPostInput): Promise<DeptPostRow> {
  if (!input.employeeId) throw badRequest("직원을 선택하세요.");
  if (!input.deptId) throw badRequest("부서를 선택하세요.");
  if (input.postKind !== "head" && input.postKind !== "member") throw badRequest("보직 구분이 올바르지 않습니다.");
  const from = normalizeDate("발령일", input.effectiveFrom) ?? kstToday();
  const to = normalizeDate("해제일", input.effectiveTo);
  if (to && to < from) throw badRequest("해제일이 발령일보다 빠릅니다.");
  const title = input.title?.trim() || null;
  const now = new Date().toISOString();

  return withDbWrite(async (db) => {
    const emp = rowsToObjects(
      await db.exec("SELECT employee_id, dept_id, status FROM employee_profiles WHERE employee_id = $1 LIMIT 1", [input.employeeId])
    )[0];
    if (!emp || emp.status !== "active") throw badRequest("재직 중인 직원이 아닙니다.");
    const dept = rowsToObjects(
      await db.exec("SELECT dept_id FROM departments WHERE dept_id = $1 AND is_active = 1 LIMIT 1", [input.deptId])
    )[0];
    if (!dept) throw badRequest("사용 중인 부서가 아닙니다.");
    const isPrimary = emp.dept_id != null && String(emp.dept_id) === input.deptId;
    if (isPrimary && input.postKind === "member") throw badRequest("주 소속 부서는 겸직 부서원으로 등록할 수 없습니다.");
    const dup = rowsToObjects(
      await db.exec(
        "SELECT 1 FROM employee_dept_posts WHERE employee_id = $1 AND dept_id = $2 AND revoked_at IS NULL LIMIT 1",
        [input.employeeId, input.deptId]
      )
    );
    if (dup.length) throw badRequest("이미 등록된 보직입니다. 기존 보직을 해제한 뒤 다시 등록하세요.");

    const postId = "post_" + crypto.randomBytes(8).toString("hex");
    await db.run(
      `INSERT INTO employee_dept_posts
         (post_id, employee_id, dept_id, post_kind, title, is_primary, effective_from, effective_to, note, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [postId, input.employeeId, input.deptId, input.postKind, title, isPrimary ? 1 : 0, from, to, input.note?.trim() || null, actorUserId, now]
    );
    if (!isPrimary) {
      await db.run(
        `INSERT INTO employee_hr_events
           (event_id, employee_id, event_type, event_date, from_dept_id, to_dept_id, from_dept_name, to_dept_name, note, created_by, created_at, updated_at)
         VALUES ($1, $2, 'concurrent_start', $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
        [
          "hrev_" + crypto.randomBytes(8).toString("hex"),
          input.employeeId, from,
          emp.dept_id != null ? String(emp.dept_id) : null, input.deptId,
          await deptName(db, emp.dept_id != null ? String(emp.dept_id) : null), await deptName(db, input.deptId),
          `겸직 발령(${input.postKind === "head" ? "부서장" : "부서원"}${title ? ` · ${title}` : ""})`,
          actorUserId, now,
        ]
      );
    }
    await syncPostLeadAssignment(db, input.employeeId, actorUserId, now);
    const row = rowsToObjects(
      await db.exec(
        `SELECT p.*, ep.name AS employee_name, d.dept_name FROM employee_dept_posts p
           JOIN employee_profiles ep ON ep.employee_id = p.employee_id
           LEFT JOIN departments d ON d.dept_id = p.dept_id WHERE p.post_id = $1`,
        [postId]
      )
    )[0];
    const saved = mapPost(row);
    await recordAuditLogInline(db, { actorUserId, action: "dept_post_create", targetTable: "employee_dept_posts", targetId: postId, after: saved });
    return saved;
  });
}

/** 보직 해제 — 즉시 해제(revoked_at). 겸직이면 인사 이력(concurrent_end)을 남기고, 부서장 자동 배정을 다시 맞춘다. */
export async function revokeDeptPost(actorUserId: string, postId: string, endDate?: string | null): Promise<void> {
  if (!postId) throw badRequest("postId가 필요합니다.");
  const date = normalizeDate("해제일", endDate) ?? kstToday();
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    const row = rowsToObjects(
      await db.exec(
        `SELECT p.*, ep.name AS employee_name, ep.dept_id AS primary_dept_id, d.dept_name FROM employee_dept_posts p
           JOIN employee_profiles ep ON ep.employee_id = p.employee_id
           LEFT JOIN departments d ON d.dept_id = p.dept_id
          WHERE p.post_id = $1 AND p.revoked_at IS NULL LIMIT 1`,
        [postId]
      )
    )[0];
    if (!row) throw Object.assign(new Error("보직을 찾을 수 없습니다."), { status: 404 });
    await db.run(
      "UPDATE employee_dept_posts SET revoked_at = $2, revoked_by = $3, effective_to = COALESCE(effective_to, $4), updated_at = $2 WHERE post_id = $1",
      [postId, now, actorUserId, date]
    );
    if (Number(row.is_primary ?? 0) !== 1) {
      const primary = row.primary_dept_id != null ? String(row.primary_dept_id) : null;
      await db.run(
        `INSERT INTO employee_hr_events
           (event_id, employee_id, event_type, event_date, from_dept_id, to_dept_id, from_dept_name, to_dept_name, note, created_by, created_at, updated_at)
         VALUES ($1, $2, 'concurrent_end', $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
        [
          "hrev_" + crypto.randomBytes(8).toString("hex"),
          String(row.employee_id), date, primary, String(row.dept_id),
          await deptName(db, primary), nullable(row.dept_name),
          `겸직 해제(${row.post_kind === "head" ? "부서장" : "부서원"})`, actorUserId, now,
        ]
      );
    }
    await syncPostLeadAssignment(db, String(row.employee_id), actorUserId, now);
    await recordAuditLogInline(db, { actorUserId, action: "dept_post_revoke", targetTable: "employee_dept_posts", targetId: postId, before: mapPost(row) });
  });
}
