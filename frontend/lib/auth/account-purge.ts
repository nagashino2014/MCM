/*
 * 계정 영구 삭제(purge) — 테스트·오발급 계정 정리용(2026-10-19 사용자 요청).
 *   퇴사자는 삭제가 아니라 인사 이력의 퇴사 처리(hr-events resignation → 계정 비활성)를 쓴다.
 *   오삭제 방지 3단: ① 하드 차단(자기 자신·마지막 시스템 관리자) ② 업무 기록이 있으면 경고 목록 + "영향 확인" 체크(ack) 필수
 *   ③ 로그인 ID(없으면 이메일) 재입력 일치. 미리보기(preview)가 함께 삭제되는 것(cascades)과 남지만 참조가 끊기는 것(orphans)을 구분해 보여 준다.
 *   삭제 순서(한 트랜잭션): 보낸 메신저 메시지(sender_id NOT NULL·FK NO ACTION 이라 명시 삭제) → 메일함(mailboxes → 메시지·폴더 CASCADE)
 *   → 직원 프로필(선택, 부속 표 CASCADE) → users(권한 배정·할 일·메신저 멤버 CASCADE, 작성자 참조 …_by 는 FK ON DELETE SET NULL 로 보존)
 *   → 감사 로그 user_purge(before 에 계정·직원·건수).
 */
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "./audit";
import { countSystemAdmins, findUserById, isSystemAdminUser, type UserRow } from "./users";

export interface PurgeCount {
  key: string;
  label: string;
  count: number;
  /** 업무 기록(급여·근태·결재·보고·메시지·메일 등) — 1건이라도 있으면 경고 확인(ack) 필수 */
  record: boolean;
}

export interface PurgeEmployee {
  employeeId: string;
  employeeNo: string | null;
  name: string;
  deptId: string | null;
  status: string;
}

export interface AccountPurgePreview {
  user: Pick<UserRow, "userId" | "loginId" | "email" | "name" | "status" | "role">;
  employee: PurgeEmployee | null;
  /** 삭제를 막는 사유(있으면 canPurge=false) */
  blockers: string[];
  /** 함께 삭제되는 것 */
  cascades: PurgeCount[];
  /** 남지만 이 사용자/직원 참조가 비는 것 */
  orphans: PurgeCount[];
  /** 경고 확인(ack)이 필요한 업무 기록 — cascades∪orphans 중 record=true, count>0 */
  warnings: PurgeCount[];
  canPurge: boolean;
  /** 실행 확인에 입력해야 하는 문자열(로그인 ID, 없으면 이메일) */
  confirmText: string;
}

type Spec = [key: string, label: string, sql: string, record: boolean];

const fail = (message: string, status = 400): Error => Object.assign(new Error(message), { status });

async function count(db: PgDatabase, sql: string, params: unknown[]): Promise<number> {
  const rows = rowsToObjects(await db.exec(sql, params));
  return Number(rows[0]?.n ?? 0);
}

async function collect(db: PgDatabase, specs: Spec[], param: string): Promise<PurgeCount[]> {
  const out: PurgeCount[] = [];
  for (const [key, label, sql, record] of specs) out.push({ key, label, count: await count(db, sql, [param]), record });
  return out;
}

async function loadEmployee(db: PgDatabase, userId: string): Promise<PurgeEmployee | null> {
  const rows = rowsToObjects(
    await db.exec(`SELECT employee_id, employee_no, name, dept_id, status FROM employee_profiles WHERE user_id = $1 ORDER BY created_at LIMIT 1`, [userId])
  );
  const r = rows[0];
  if (!r) return null;
  return {
    employeeId: String(r.employee_id),
    employeeNo: r.employee_no != null ? String(r.employee_no) : null,
    name: String(r.name),
    deptId: r.dept_id != null ? String(r.dept_id) : null,
    status: String(r.status),
  };
}

// ── 함께 삭제(users 키) ──
const CASCADE_BY_USER: Spec[] = [
  ["chat_messages", "보낸 메신저 메시지", `SELECT COUNT(*)::int AS n FROM chat_messages WHERE sender_id = $1`, true],
  ["mail_messages", "메일함 메시지", `SELECT COUNT(*)::int AS n FROM mail_messages m JOIN mailboxes b ON b.mailbox_id = m.mailbox_id WHERE b.user_id = $1`, true],
  ["mailboxes", "메일함(주소·폴더·서명)", `SELECT COUNT(*)::int AS n FROM mailboxes WHERE user_id = $1`, false],
  ["user_permission_assignments", "권한 템플릿 배정", `SELECT COUNT(*)::int AS n FROM user_permission_assignments WHERE user_id = $1`, false],
  ["todo_items", "할 일(작성)", `SELECT COUNT(*)::int AS n FROM todo_items WHERE owner_user_id = $1`, false],
  ["todo_boards", "할 일 보드", `SELECT COUNT(*)::int AS n FROM todo_boards WHERE owner_user_id = $1`, false],
  ["chat_room_members", "메신저 방 참여", `SELECT COUNT(*)::int AS n FROM chat_room_members WHERE user_id = $1`, false],
  ["personal_documents", "개인 문서함", `SELECT COUNT(*)::int AS n FROM personal_documents WHERE user_id = $1`, false],
  ["mobile_push_tokens", "모바일 푸시 등록", `SELECT COUNT(*)::int AS n FROM mobile_push_tokens WHERE user_id = $1`, false],
];
// ── 함께 삭제(employee 키, 직원 프로필 동반 삭제 시) ──
const CASCADE_BY_EMPLOYEE: Spec[] = [
  ["labor_contracts", "근로계약", `SELECT COUNT(*)::int AS n FROM labor_contracts WHERE employee_id = $1`, true],
  ["bonus_statements", "성과급 명세", `SELECT COUNT(*)::int AS n FROM bonus_statements WHERE employee_id = $1`, true],
  ["service_participants", "용역 참여 이력", `SELECT (SELECT COUNT(*) FROM service_participants WHERE employee_id = $1) + (SELECT COUNT(*) FROM service_participation_spans WHERE employee_id = $1) AS n`, true],
  ["yearend_settlements", "연말정산", `SELECT COUNT(*)::int AS n FROM yearend_settlements WHERE employee_id = $1`, true],
  ["employee_documents", "인사 문서", `SELECT COUNT(*)::int AS n FROM employee_documents WHERE employee_id = $1`, false],
  ["employee_hr_events", "인사 이력", `SELECT COUNT(*)::int AS n FROM employee_hr_events WHERE employee_id = $1`, false],
  ["employee_educations", "학력·경력·자격", `SELECT (SELECT COUNT(*) FROM employee_educations WHERE employee_id = $1) + (SELECT COUNT(*) FROM employee_careers WHERE employee_id = $1) + (SELECT COUNT(*) FROM employee_certifications WHERE employee_id = $1) AS n`, false],
  ["work_task_participants", "업무추진계획 참여", `SELECT COUNT(*)::int AS n FROM work_task_participants WHERE employee_id = $1`, false],
];
// ── 남지만 참조가 비는 것(users 키 — FK SET NULL 또는 FK 없는 느슨한 참조) ──
const ORPHAN_BY_USER: Spec[] = [
  ["approval_docs", "결재 문서(기안자 표시)", `SELECT COUNT(*)::int AS n FROM approval_docs WHERE drafter_user_id = $1`, true],
  ["work_plan_reports", "업무 보고(작성자 표시)", `SELECT COUNT(*)::int AS n FROM work_plan_reports WHERE author_user_id = $1`, true],
  ["sales_projects", "영업 건(작성자 표시)", `SELECT COUNT(*)::int AS n FROM sales_projects WHERE created_by = $1`, false],
  ["board_posts", "게시글(작성자 표시)", `SELECT COUNT(*)::int AS n FROM board_posts WHERE author_user_id = $1`, false],
];
// ── 남지만 직원 참조가 비는 것(employee 키) ──
const ORPHAN_BY_EMPLOYEE: Spec[] = [
  ["payroll_entries", "급여 대장 항목(직원 표시)", `SELECT COUNT(*)::int AS n FROM payroll_entries WHERE employee_id = $1`, true],
  ["attendance_daily", "근태 기록(직원 표시)", `SELECT COUNT(*)::int AS n FROM attendance_daily WHERE employee_id = $1`, true],
  ["work_plan_items", "업무 보고 담당 표시", `SELECT COUNT(*)::int AS n FROM work_plan_items WHERE manager_employee_id = $1 OR primary_employee_id = $1 OR secondary_employee_id = $1`, false],
];

async function buildPreview(db: PgDatabase, actorUserId: string, user: UserRow, withEmployee: boolean): Promise<AccountPurgePreview> {
  const employee = await loadEmployee(db, user.userId);
  const blockers: string[] = [];
  if (user.userId === actorUserId) blockers.push("자기 자신의 계정은 삭제할 수 없습니다.");
  if (await isSystemAdminUser(user.userId)) {
    if ((await countSystemAdmins()) <= 1) blockers.push("마지막 시스템 관리자(tpl-system-admin 보유자)는 삭제할 수 없습니다.");
  }
  const cascades = await collect(db, CASCADE_BY_USER, user.userId);
  const orphans = await collect(db, ORPHAN_BY_USER, user.userId);
  if (employee && withEmployee) {
    cascades.push(...(await collect(db, CASCADE_BY_EMPLOYEE, employee.employeeId)));
    orphans.push(...(await collect(db, ORPHAN_BY_EMPLOYEE, employee.employeeId)));
  }
  const nz = (xs: PurgeCount[]) => xs.filter((x) => x.count > 0);
  const c = nz(cascades);
  const o = nz(orphans);
  return {
    user: { userId: user.userId, loginId: user.loginId, email: user.email, name: user.name, status: user.status, role: user.role },
    employee,
    blockers,
    cascades: c,
    orphans: o,
    warnings: [...c, ...o].filter((x) => x.record),
    canPurge: blockers.length === 0,
    confirmText: user.loginId ?? user.email,
  };
}

/** 미리보기 — withEmployee 는 직원 프로필 동반 삭제 가정(기본 true). */
export async function previewAccountPurge(actorUserId: string, userId: string, withEmployee = true): Promise<AccountPurgePreview> {
  const user = await findUserById(userId);
  if (!user) throw fail("계정을 찾을 수 없습니다.", 404);
  const db = await getDb();
  return buildPreview(db, actorUserId, user, withEmployee);
}

/**
 * 영구 삭제. confirm 은 preview.confirmText 와 정확히 일치해야 하고, warnings 가 있으면 ack=true 가 필요하다.
 * withEmployee=true 면 연결된 직원 프로필(조직 인원)도 함께 지운다(false 면 employee_profiles.user_id 만 NULL 이 되어 인원은 남는다).
 */
export async function purgeAccount(
  actorUserId: string,
  userId: string,
  opts: { confirm: string; withEmployee: boolean; ack: boolean }
): Promise<{ preview: AccountPurgePreview; employeeDeleted: boolean }> {
  const user = await findUserById(userId);
  if (!user) throw fail("계정을 찾을 수 없습니다.", 404);
  let preview!: AccountPurgePreview;
  let employeeDeleted = false;
  await withDbWrite(async (db) => {
    preview = await buildPreview(db, actorUserId, user, opts.withEmployee);
    if (!preview.canPurge) throw fail(preview.blockers[0], 409);
    if (preview.warnings.length && !opts.ack) throw fail("업무 기록이 영향을 받습니다. 영향 확인(ack)에 동의해야 삭제할 수 있습니다.", 409);
    if ((opts.confirm ?? "").trim() !== preview.confirmText) throw fail("확인 문자열이 일치하지 않습니다. 로그인 ID(또는 이메일)를 정확히 입력하세요.");
    await db.run(`DELETE FROM chat_messages WHERE sender_id = $1`, [userId]);
    await db.run(`DELETE FROM mailboxes WHERE user_id = $1`, [userId]);
    if (opts.withEmployee && preview.employee) {
      await db.run(`DELETE FROM employee_profiles WHERE employee_id = $1`, [preview.employee.employeeId]);
      employeeDeleted = true;
    }
    await db.run(`DELETE FROM users WHERE user_id = $1`, [userId]);
    await recordAuditLogInline(db, {
      actorUserId,
      action: "user_purge",
      targetTable: "users",
      targetId: userId,
      before: { user: preview.user, employee: preview.employee, employeeDeleted, cascades: preview.cascades, orphans: preview.orphans },
    });
  });
  return { preview, employeeDeleted };
}
