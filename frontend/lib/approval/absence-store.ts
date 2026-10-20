// 전자결재 부재·대결 설정 저장소(DA-1) — 본인 부재 기간(대결/건너뛰기)과 휴가 연동 기본 대결자.
// 설계: docs/e-approval-delegation-blueprint.md §4·§6-1. 판정·라우팅은 absence-routing.ts·docs.ts 가 맡는다.
// (absence.ts 는 결근사유서 모듈 — 별개)

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { kstToday } from "@/lib/approval/absence-routing";

export interface ApprovalAbsence {
  absenceId: string;
  startDate: string;
  endDate: string;
  mode: "delegate" | "skip";
  delegateUserId: string | null;
  delegateName: string | null;
  reason: string | null;
  allowSelfAct: boolean;
  createdBy: string;
  createdAt: string;
  canceledAt: string | null;
  /** 오늘 기준 상태 — active(진행 중) | upcoming(예정) | ended(종료) | canceled */
  state: "active" | "upcoming" | "ended" | "canceled";
}

export interface DefaultDelegate {
  delegateUserId: string | null;
  delegateName: string | null;
  enabled: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function userError(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

function stateOf(r: { startDate: string; endDate: string; canceledAt: string | null }, today: string): ApprovalAbsence["state"] {
  if (r.canceledAt) return "canceled";
  if (r.endDate < today) return "ended";
  if (r.startDate > today) return "upcoming";
  return "active";
}

/** 본인 부재 목록 — 진행 중·예정 전부 + 최근 종료·취소 10건. */
export async function listMyAbsences(userId: string): Promise<ApprovalAbsence[]> {
  const db = await getDb();
  const today = kstToday();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT a.*, COALESCE(ep.name, u.email) AS delegate_name
         FROM approval_absences a
         LEFT JOIN users u ON u.user_id = a.delegate_user_id
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
        WHERE a.user_id = $1
        ORDER BY (a.canceled_at IS NULL AND a.end_date >= $2) DESC, a.start_date DESC, a.created_at DESC
        LIMIT 60`,
      [userId, today]
    )
  );
  const list = rows.map((r) => {
    const base = {
      absenceId: String(r.absence_id),
      startDate: String(r.start_date),
      endDate: String(r.end_date),
      mode: (String(r.mode) === "skip" ? "skip" : "delegate") as ApprovalAbsence["mode"],
      delegateUserId: r.delegate_user_id != null ? String(r.delegate_user_id) : null,
      delegateName: r.delegate_name != null ? String(r.delegate_name) : null,
      reason: r.reason != null ? String(r.reason) : null,
      allowSelfAct: Number(r.allow_self_act) === 1,
      createdBy: String(r.created_by),
      createdAt: String(r.created_at),
      canceledAt: r.canceled_at != null ? String(r.canceled_at) : null,
    };
    return { ...base, state: stateOf(base, today) };
  });
  const open = list.filter((a) => a.state === "active" || a.state === "upcoming");
  const closed = list.filter((a) => a.state === "ended" || a.state === "canceled").slice(0, 10);
  return [...open, ...closed];
}

/** 대결자 검증 — 활성 계정, 본인 아님. */
async function assertDelegatable(userId: string, delegateUserId: string): Promise<void> {
  if (delegateUserId === userId) throw userError("본인을 대결자로 지정할 수 없습니다.");
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT status FROM users WHERE user_id = $1`, [delegateUserId]));
  if (!rows.length) throw userError("대결자 계정을 찾을 수 없습니다.");
  if (String(rows[0].status ?? "active") !== "active") throw userError("비활성 계정은 대결자로 지정할 수 없습니다.");
}

export async function createAbsence(params: {
  userId: string;
  startDate: string;
  endDate: string;
  mode: string;
  delegateUserId: string | null;
  reason: string | null;
  allowSelfAct: boolean;
  createdBy: string;
}): Promise<string> {
  const { startDate, endDate } = params;
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) throw userError("부재 기간을 YYYY-MM-DD 형식으로 입력하세요.");
  if (startDate > endDate) throw userError("부재 종료일이 시작일보다 앞설 수 없습니다.");
  if (endDate < kstToday()) throw userError("이미 지난 기간은 등록할 수 없습니다.");
  if (params.mode !== "delegate" && params.mode !== "skip") throw userError("처리 방식을 선택하세요.");
  const delegateUserId = params.mode === "delegate" ? params.delegateUserId?.trim() || null : null;
  if (params.mode === "delegate") {
    if (!delegateUserId) throw userError("대결자를 지정하세요.");
    await assertDelegatable(params.userId, delegateUserId);
  }
  const absenceId = "abs-" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO approval_absences
         (absence_id, user_id, start_date, end_date, mode, delegate_user_id, reason, allow_self_act, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [
        absenceId,
        params.userId,
        startDate,
        endDate,
        params.mode,
        delegateUserId,
        params.reason?.trim() || null,
        params.allowSelfAct ? 1 : 0,
        params.createdBy,
        now,
      ]
    );
  });
  return absenceId;
}

/** 부재 취소 — 본인 것만. 이미 대결자에게 넘어간 단계는 되돌리지 않는다(설계 §5-5, 원결재자는 D-4 로 직접 처리 가능). */
export async function cancelAbsence(userId: string, absenceId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(`SELECT user_id, canceled_at FROM approval_absences WHERE absence_id = $1 FOR UPDATE`, [absenceId])
    );
    if (!rows.length || String(rows[0].user_id) !== userId) throw userError("부재 설정을 찾을 수 없습니다.", 404);
    if (rows[0].canceled_at != null) return;
    const now = new Date().toISOString();
    await txn.run(`UPDATE approval_absences SET canceled_at = $2, updated_at = $2 WHERE absence_id = $1`, [absenceId, now]);
  });
}

/** 휴가 연동 기본 대결자(approval_delegates) — 승인된 휴가 기간에만 적용(D-1). */
export async function getDefaultDelegate(userId: string): Promise<DefaultDelegate> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ad.delegate_user_id, ad.enabled, COALESCE(ep.name, u.email) AS delegate_name
         FROM approval_delegates ad
         LEFT JOIN users u ON u.user_id = ad.delegate_user_id
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
        WHERE ad.user_id = $1`,
      [userId]
    )
  );
  if (!rows.length) return { delegateUserId: null, delegateName: null, enabled: false };
  return {
    delegateUserId: String(rows[0].delegate_user_id),
    delegateName: rows[0].delegate_name != null ? String(rows[0].delegate_name) : null,
    enabled: Number(rows[0].enabled) === 1,
  };
}

/** 기본 대결자 저장 — delegateUserId=null 이면 해제(행 삭제). */
export async function setDefaultDelegate(userId: string, delegateUserId: string | null): Promise<void> {
  const target = delegateUserId?.trim() || null;
  if (target) await assertDelegatable(userId, target);
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    if (!target) {
      await txn.run(`DELETE FROM approval_delegates WHERE user_id = $1`, [userId]);
      return;
    }
    await txn.run(
      `INSERT INTO approval_delegates (user_id, delegate_user_id, enabled, updated_at) VALUES ($1, $2, 1, $3)
       ON CONFLICT (user_id) DO UPDATE SET delegate_user_id = EXCLUDED.delegate_user_id, enabled = 1, updated_at = EXCLUDED.updated_at`,
      [userId, target, now]
    );
  });
}

/** 지금 내 차례로 대기 중인 결재 — 중간 단계(부재 적용 대상)와 최종 단계(본인 결재 필요, D-2) 건수. */
export async function myPendingSplit(userId: string): Promise<{ middle: number; final: number }> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT count(*) FILTER (WHERE s.step_order < m.final_order) AS middle,
              count(*) FILTER (WHERE s.step_order >= m.final_order) AS final
         FROM approval_steps s
         JOIN approval_docs d ON d.doc_id = s.doc_id
         JOIN (SELECT doc_id, max(step_order) AS final_order FROM approval_steps GROUP BY doc_id) m ON m.doc_id = s.doc_id
        WHERE s.assignee_user_id = $1 AND s.status = 'pending' AND d.status = 'in_progress'`,
      [userId]
    )
  );
  return { middle: Number(rows[0]?.middle ?? 0), final: Number(rows[0]?.final ?? 0) };
}
