import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { fillNoticeBody, type NoticeTokenVars } from "@/lib/approval/leave-promotion-tokens";

/*
 * 연차사용촉진제도(088, LP) — 직원별 소진율·1/2차 고지 현황 집계 + 발송/회신.
 * 2차 고지 워크플로는 후속(LP-P3). 설계: docs/leave-promotion-blueprint.md.
 */

const nid = () => "lnt-" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

/** 1차 고지 기간(고정 7/1~7/20) */
export const PROMO_FIRST_START = "07-01";
export const PROMO_FIRST_END = "07-20";

export interface PromotionRow {
  employeeId: string;
  name: string;
  positionName: string | null;
  deptName: string | null;
  photoPath: string | null;
  granted: number;
  used: number;
  remaining: number;
  rate: number; // 소진율 %
  // 고지 현황
  round1: { noticeDate: string; status: string; paper: boolean } | null;
  round2: { noticeDate: string; status: string; paper: boolean } | null;
}

/**
 * 연차촉진 관리 대상 목록 — 재직자 전체(잔여 연차 집계 + 1/2차 고지 상태 조인).
 * usedAnnual = 연차 차감분(연차·반차). rate = 사용 ÷ 부여.
 */
export async function listPromotion(year: string): Promise<PromotionRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, e.photo_public_path, d.dept_name, p.position_name, p.rank_order, e.hired_at,
              COALESCE(SUM(CASE WHEN l.entry_type IN ('grant','adjust') THEN l.days END), 0) AS granted,
              COALESCE(SUM(CASE WHEN l.entry_type = 'use' AND (lt.deduct IS NOT NULL OR l.leave_type_key IS NULL) THEN l.days END), 0) AS used
         FROM employee_profiles e
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
         LEFT JOIN annual_leave_ledger l ON l.employee_id = e.employee_id AND l.year = $1
         LEFT JOIN leave_types lt ON lt.key = l.leave_type_key
        WHERE e.status = 'active'
        GROUP BY e.employee_id, e.name, e.photo_public_path, d.dept_name, p.position_name, p.rank_order, e.hired_at
        ORDER BY p.rank_order DESC NULLS LAST, e.hired_at ASC NULLS LAST, e.name`,
      [year]
    )
  );
  const notices = rowsToObjects(
    await db.exec(`SELECT employee_id, round, notice_date, status, paper FROM leave_notices WHERE year = $1`, [year])
  );
  const noticeMap = new Map<string, { round: number; noticeDate: string; status: string; paper: boolean }[]>();
  for (const n of notices) {
    const eid = String(n.employee_id);
    noticeMap.set(eid, [
      ...(noticeMap.get(eid) ?? []),
      { round: Number(n.round), noticeDate: String(n.notice_date ?? ""), status: String(n.status ?? ""), paper: Boolean(n.paper) },
    ]);
  }
  return rows.map((r) => {
    const granted = Number(r.granted ?? 0);
    const used = Number(r.used ?? 0);
    const remaining = Math.round((granted - used) * 100) / 100;
    const ns = noticeMap.get(String(r.employee_id)) ?? [];
    const r1 = ns.find((x) => x.round === 1);
    const r2 = ns.find((x) => x.round === 2);
    return {
      employeeId: String(r.employee_id ?? ""),
      name: String(r.name ?? ""),
      positionName: r.position_name != null ? String(r.position_name) : null,
      deptName: r.dept_name != null ? String(r.dept_name) : null,
      photoPath: r.photo_public_path != null ? String(r.photo_public_path) : null,
      granted,
      used,
      remaining,
      rate: granted > 0 ? Math.round((used / granted) * 1000) / 10 : 0,
      round1: r1 ? { noticeDate: r1.noticeDate, status: r1.status, paper: r1.paper } : null,
      round2: r2 ? { noticeDate: r2.noticeDate, status: r2.status, paper: r2.paper } : null,
    };
  });
}

/** 발송 게이팅 상태 — 오늘 날짜 기준 1차/2차 발송 가능 여부. */
export function promotionGate(today: Date): { canFirst: boolean; canSecond: boolean; phase: string } {
  const mmdd = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const inFirst = mmdd >= PROMO_FIRST_START && mmdd <= PROMO_FIRST_END;
  const afterFirst = mmdd > PROMO_FIRST_END;
  return {
    canFirst: inFirst,
    canSecond: afterFirst,
    phase: mmdd < PROMO_FIRST_START ? "before" : inFirst ? "first" : "second",
  };
}

// ── 양식(문구 템플릿) ─────────────────────────────────────────
export interface NoticeTemplate {
  round: number;
  title: string;
  body: string[]; // 문단 배열(치환 토큰 포함)
  updatedAt: string;
}

/** 1·2차 고지 문구 템플릿 조회. */
export async function listNoticeTemplates(): Promise<NoticeTemplate[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT round, title, body, updated_at FROM leave_notice_templates ORDER BY round`)
  );
  return rows.map((r) => ({
    round: Number(r.round),
    title: String(r.title ?? ""),
    body: Array.isArray(r.body) ? (r.body as string[]) : [],
    updatedAt: String(r.updated_at ?? ""),
  }));
}

/** 고지 문구 템플릿 저장(admin) — title·body 문단 배열. */
export async function saveNoticeTemplate(round: number, title: string, body: string[]): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `UPDATE leave_notice_templates SET title = $2, body = $3::jsonb, updated_at = $4 WHERE round = $1`,
      [round, title, JSON.stringify(body), now]
    );
  });
}

// ── 1차 고지 발송 ─────────────────────────────────────────────
export interface SendResult {
  created: number;
  skipped: number;
}

/**
 * 1차 고지 일괄 발송(admin) — 잔여 연차>0 이면서 아직 1차 고지가 없는 직원 전원.
 * 발송 시점 granted/used/remaining 스냅샷과 함께 leave_notices(round=1, status='sent') INSERT.
 * 기간 게이팅(7/1~7/20)은 라우트에서 강제하되, 여기서도 today 를 받아 notice_date 로 기록한다.
 */
export async function sendFirstNotices(year: string, today: Date, sentBy: string): Promise<SendResult> {
  const targets = (await listPromotion(year)).filter((r) => r.remaining > 0 && !r.round1);
  if (!targets.length) return { created: 0, skipped: 0 };
  const noticeDate = today.toISOString().slice(0, 10);
  const deadline = `${year}-12-31`;
  const now = new Date().toISOString();
  let created = 0;
  let skipped = 0;
  await withDbWrite(async (txn) => {
    for (const t of targets) {
      const res = await txn.exec(
        `INSERT INTO leave_notices
           (notice_id, year, round, employee_id, granted, used, remaining, notice_date, deadline, status, sent_by, sent_at, created_at)
         VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,'sent',$9,$10,$10)
         ON CONFLICT (year, round, employee_id) DO NOTHING
         RETURNING notice_id`,
        [nid(), year, t.employeeId, t.granted, t.used, t.remaining, noticeDate, deadline, sentBy, now]
      );
      if (rowsToObjects(res).length > 0) created += 1;
      else skipped += 1;
    }
  });
  return { created, skipped };
}

// ── 수신 문서함(직원 본인) ────────────────────────────────────
export interface MyNotice {
  noticeId: string;
  year: string;
  round: number;
  name: string;
  title: string;
  paragraphs: string[]; // 토큰 치환 완료 본문
  granted: number;
  used: number;
  remaining: number;
  noticeDate: string;
  deadline: string;
  status: string; // sent | submitted | assigned
  plan: string[]; // 직원 사용예정일(1차 회신)
  assigned: string[]; // 회사 지정일(2차)
  planTotal: number;
  submittedAt: string | null;
}

/** 세션 직원의 수신 고지 목록(수신 문서함). userId → employee_id 매핑 후 조회. */
export async function listMyNotices(userId: string): Promise<MyNotice[]> {
  const db = await getDb();
  const emp = rowsToObjects(
    await db.exec(`SELECT employee_id, name FROM users WHERE user_id = $1`, [userId])
  );
  const employeeId = emp.length ? String(emp[0].employee_id ?? "") : "";
  if (!employeeId) return [];
  const name = String(emp[0].name ?? "");
  const templates = await listNoticeTemplates();
  const tplMap = new Map(templates.map((t) => [t.round, t]));
  const rows = rowsToObjects(
    await db.exec(
      `SELECT notice_id, year, round, granted, used, remaining, notice_date, deadline, status, plan, assigned, submitted_at
         FROM leave_notices WHERE employee_id = $1 ORDER BY year DESC, round ASC`,
      [employeeId]
    )
  );
  return rows.map((r) => {
    const round = Number(r.round);
    const tpl = tplMap.get(round);
    const granted = Number(r.granted ?? 0);
    const used = Number(r.used ?? 0);
    const remaining = Number(r.remaining ?? 0);
    const vars: NoticeTokenVars = {
      name,
      granted,
      used,
      remaining,
      deadline: String(r.deadline ?? ""),
      noticeDate: String(r.notice_date ?? ""),
      planTotal: remaining,
    };
    return {
      noticeId: String(r.notice_id ?? ""),
      year: String(r.year ?? ""),
      round,
      name,
      title: tpl?.title ?? "연차휴가 사용 촉구",
      paragraphs: tpl ? fillNoticeBody(tpl.body, vars) : [],
      granted,
      used,
      remaining,
      noticeDate: String(r.notice_date ?? ""),
      deadline: String(r.deadline ?? ""),
      status: String(r.status ?? "sent"),
      plan: Array.isArray(r.plan) ? (r.plan as string[]) : [],
      assigned: Array.isArray(r.assigned) ? (r.assigned as string[]) : [],
      planTotal: remaining,
      submittedAt: r.submitted_at != null ? String(r.submitted_at) : null,
    };
  });
}

/**
 * 1차 고지 회신(직원 본인) — 사용예정일 배열 + 클릭 전자서명.
 * 서명은 성명·사번·타임스탬프로 서버에서 구성한다. 본인 고지·round=1·미제출만 허용.
 */
export async function submitNoticePlan(
  userId: string,
  noticeId: string,
  plan: string[]
): Promise<{ ok: boolean; error?: string }> {
  const dates = plan.map((d) => d.trim()).filter(Boolean);
  return withDbWrite(async (txn) => {
    const emp = rowsToObjects(
      await txn.exec(`SELECT employee_id, name FROM users WHERE user_id = $1`, [userId])
    );
    const employeeId = emp.length ? String(emp[0].employee_id ?? "") : "";
    if (!employeeId) return { ok: false, error: "직원 정보를 찾을 수 없습니다." };
    const name = String(emp[0].name ?? "");
    const found = rowsToObjects(
      await txn.exec(
        `SELECT employee_id, round, status FROM leave_notices WHERE notice_id = $1`,
        [noticeId]
      )
    );
    if (!found.length) return { ok: false, error: "고지를 찾을 수 없습니다." };
    if (String(found[0].employee_id) !== employeeId) return { ok: false, error: "본인 고지만 회신할 수 있습니다." };
    if (Number(found[0].round) !== 1) return { ok: false, error: "1차 고지만 회신 대상입니다." };
    const now = new Date().toISOString();
    const signature = `${name}(${employeeId}) · ${now}`;
    await txn.run(
      `UPDATE leave_notices SET plan = $2::jsonb, signature = $3, status = 'submitted', submitted_at = $4 WHERE notice_id = $1`,
      [noticeId, JSON.stringify(dates), signature, now]
    );
    return { ok: true };
  });
}

// ── 서면 통지 사후 등록(admin) ────────────────────────────────
export interface NoticeAttachmentMeta {
  key: string;
  name: string;
  size: number;
  contentType: string;
}

/** 첨부 키가 실제 고지에 등록된 것인지 검증(다운로드 가드) — 소유 직원 + 메타 반환. */
export async function findNoticeAttachment(
  key: string
): Promise<{ employeeId: string; name: string; contentType: string } | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT employee_id, a->>'name' AS name, a->>'contentType' AS content_type
         FROM leave_notices, jsonb_array_elements(attachments) a
        WHERE a->>'key' = $1 LIMIT 1`,
      [key]
    )
  );
  if (!rows.length) return null;
  return {
    employeeId: String(rows[0].employee_id ?? ""),
    name: String(rows[0].name ?? "첨부"),
    contentType: String(rows[0].content_type ?? "application/octet-stream"),
  };
}

/**
 * 서면으로 진행한 1차 고지의 사후 등록(admin) — 받은 사용계획서 스캔본 + 사용예정일을
 * 인원별로 제출 처리한다. 기존 온라인 발송 건이 있으면 제출로 승격, 없으면 신규 생성.
 * granted/used/remaining 은 현재 집계값으로 스냅샷한다.
 */
export async function backfillPaperNotice(params: {
  year: string;
  employeeId: string;
  round: number;
  noticeDate: string;
  plan: string[];
  attachments: NoticeAttachmentMeta[];
  actorUserId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { year, employeeId, round, noticeDate, actorUserId } = params;
  if (round !== 1) return { ok: false, error: "현재 1차 고지만 사후 등록할 수 있습니다." };
  const dates = params.plan.map((d) => d.trim()).filter(Boolean);
  const snap = (await listPromotion(year)).find((r) => r.employeeId === employeeId);
  if (!snap) return { ok: false, error: "직원을 찾을 수 없습니다." };
  const deadline = `${year}-12-31`;
  const now = new Date().toISOString();
  const signature = `서면 통지 · 사후등록 (${actorUserId}) · ${now}`;
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO leave_notices
         (notice_id, year, round, employee_id, granted, used, remaining, notice_date, deadline,
          status, paper, plan, attachments, signature, submitted_at, sent_by, sent_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'submitted',true,$10::jsonb,$11::jsonb,$12,$13,$14,$13,$13)
       ON CONFLICT (year, round, employee_id) DO UPDATE SET
         status = 'submitted', paper = true, notice_date = EXCLUDED.notice_date,
         plan = EXCLUDED.plan, attachments = EXCLUDED.attachments,
         signature = EXCLUDED.signature, submitted_at = EXCLUDED.submitted_at`,
      [
        nid(),
        year,
        round,
        employeeId,
        snap.granted,
        snap.used,
        snap.remaining,
        noticeDate,
        deadline,
        JSON.stringify(dates),
        JSON.stringify(params.attachments),
        signature,
        now,
        actorUserId,
      ]
    );
  });
  return { ok: true };
}
