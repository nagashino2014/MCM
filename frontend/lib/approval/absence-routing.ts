// 전자결재 부재 판정(대결·건너뛰기) — DA-0. 설계: docs/e-approval-delegation-blueprint.md §3·§5-1. (absence.ts 는 결근사유서 모듈 — 별개)
// 판정 순서: ① 직접 등록한 부재(approval_absences, 겹치면 최근 등록분) → ② 승인된 휴가신청서 + 기본 대결자(approval_delegates).
// 대결자도 부재(대결)면 최대 MAX_DELEGATE_HOPS 단계까지 따라가고, 순환·대결자 부재(건너뛰기)·자기 결재는 unresolved 로 돌려
// 원결재자를 유지한다(관리자 알림은 호출부). 최종 결재자 단계 제외(D-2)는 호출부(activateOrder, DA-1) 책임이다.

import { rowsToObjects, type PgDatabase } from "@/lib/db";

export const MAX_DELEGATE_HOPS = 3;

/** KST 기준 오늘(YYYY-MM-DD) — 기존 resolveDelegate 의 UTC 날짜(KST 00~09시 하루 어긋남) 수정용. */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 한 사람의 그날 부재 1건. source=absence 는 직접 등록, leave 는 휴가 연동(항상 delegate). */
export type AbsenceHit =
  | { mode: "delegate"; delegateUserId: string; absenceId: string | null; source: "absence" | "leave"; allowSelfAct: boolean }
  | { mode: "skip"; absenceId: string; source: "absence"; allowSelfAct: boolean };

export type AbsenceResolution =
  | { kind: "none" }
  | { kind: "skip"; absenceId: string; allowSelfAct: boolean }
  | {
      kind: "delegate";
      delegateUserId: string;
      /** 원결재자에게 직접 걸린 부재(단계에 absence_id 로 기록) — 휴가 연동이면 null */
      absenceId: string | null;
      allowSelfAct: boolean;
      /** 원결재자 → … → 최종 대결자 경로 */
      chain: string[];
    }
  | { kind: "unresolved"; reason: "cycle" | "too_deep" | "delegate_skip" | "self"; chain: string[] };

export interface AbsenceRow {
  absenceId: string;
  mode: string;
  delegateUserId: string | null;
  allowSelfAct: number | boolean;
  startDate: string;
  endDate: string;
  createdAt: string;
  canceledAt: string | null;
}

/** 그날 유효한 직접 등록 부재 중 최근 등록분 1건(겹침 규칙). */
export function pickAbsence(rows: AbsenceRow[], date: string): AbsenceHit | null {
  const active = rows
    .filter((r) => !r.canceledAt && r.startDate <= date && date <= r.endDate)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const r = active[0];
  if (!r) return null;
  const allowSelfAct = Boolean(Number(r.allowSelfAct));
  if (r.mode === "skip") return { mode: "skip", absenceId: r.absenceId, source: "absence", allowSelfAct };
  if (r.mode === "delegate" && r.delegateUserId) {
    return { mode: "delegate", delegateUserId: r.delegateUserId, absenceId: r.absenceId, source: "absence", allowSelfAct };
  }
  return null;
}

/**
 * 대결 연쇄 해석(순수) — lookup 은 사람별 그날 부재 조회.
 * excludeUserIds: 대결자가 될 수 없는 사람(기안자 등, 자기 결재 방지).
 */
export async function followAbsence(
  userId: string,
  lookup: (userId: string) => Promise<AbsenceHit | null>,
  opts: { excludeUserIds?: string[] } = {}
): Promise<AbsenceResolution> {
  const first = await lookup(userId);
  if (!first) return { kind: "none" };
  if (first.mode === "skip") return { kind: "skip", absenceId: first.absenceId, allowSelfAct: first.allowSelfAct };

  const exclude = new Set(opts.excludeUserIds ?? []);
  const chain = [userId];
  let current = first.delegateUserId;
  for (let hop = 1; ; hop++) {
    if (chain.includes(current)) return { kind: "unresolved", reason: "cycle", chain: [...chain, current] };
    chain.push(current);
    if (exclude.has(current)) return { kind: "unresolved", reason: "self", chain };
    const next = await lookup(current);
    if (!next) {
      return { kind: "delegate", delegateUserId: current, absenceId: first.absenceId, allowSelfAct: first.allowSelfAct, chain };
    }
    if (next.mode === "skip") return { kind: "unresolved", reason: "delegate_skip", chain };
    if (hop >= MAX_DELEGATE_HOPS) return { kind: "unresolved", reason: "too_deep", chain: [...chain, next.delegateUserId] };
    current = next.delegateUserId;
  }
}

/** DB 조회 — 한 사람의 그날 부재(직접 등록 우선, 없으면 승인 휴가 + 기본 대결자). */
export async function findAbsenceHit(db: PgDatabase, userId: string, date: string): Promise<AbsenceHit | null> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT absence_id, mode, delegate_user_id, allow_self_act, start_date, end_date, created_at, canceled_at
         FROM approval_absences
        WHERE user_id = $1 AND canceled_at IS NULL AND start_date <= $2 AND end_date >= $2`,
      [userId, date]
    )
  );
  const hit = pickAbsence(
    rows.map((r) => ({
      absenceId: String(r.absence_id),
      mode: String(r.mode),
      delegateUserId: r.delegate_user_id == null ? null : String(r.delegate_user_id),
      allowSelfAct: Number(r.allow_self_act),
      startDate: String(r.start_date),
      endDate: String(r.end_date),
      createdAt: String(r.created_at),
      canceledAt: r.canceled_at == null ? null : String(r.canceled_at),
    })),
    date
  );
  if (hit) return hit;

  // 휴가 연동(§8-4 기존 동작) — 기본 대결자가 지정·활성일 때만(D-1).
  const leave = rowsToObjects(
    await db.exec(
      `SELECT ad.delegate_user_id
         FROM approval_delegates ad
        WHERE ad.user_id = $1 AND ad.enabled = 1
          AND EXISTS (
            SELECT 1 FROM approval_docs ld
             WHERE ld.form_id = 'frm-leave-request' AND ld.status = 'approved'
               AND ld.drafter_user_id = $1
               AND ld.field_values->'leave_period'->>'from' <= $2
               AND ld.field_values->'leave_period'->>'to' >= $2
          )`,
      [userId, date]
    )
  );
  if (!leave.length) return null;
  const delegateUserId = String(leave[0].delegate_user_id);
  if (!delegateUserId || delegateUserId === userId) return null;
  return { mode: "delegate", delegateUserId, absenceId: null, source: "leave", allowSelfAct: true };
}

/** 결재자 부재 해석(DB) — 날짜 기본값은 KST 오늘. */
export async function resolveAbsence(
  db: PgDatabase,
  userId: string,
  opts: { date?: string; excludeUserIds?: string[] } = {}
): Promise<AbsenceResolution> {
  const date = opts.date ?? kstToday();
  return followAbsence(userId, (uid) => findAbsenceHit(db, uid, date), { excludeUserIds: opts.excludeUserIds });
}
