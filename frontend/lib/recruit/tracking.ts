/**
 * 채용공고 지원 현황 수동 기록(마이그 273) — 날짜별 지원자 수 + 면접 예정자.
 * 채용사이트 자동 수집 대신 담당자가 적는다(2026-10-13). 추이를 보려고 날짜별 행을 보존한다.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects } from "@/lib/db";

const nowIso = () => new Date().toISOString();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

export interface ApplicantCountRow {
  countedOn: string;
  count: number;
  /** 전날 기록 대비 증감(첫 기록은 null) */
  delta: number | null;
  memo: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

export type InterviewStatus = "scheduled" | "done" | "cancelled";

export interface InterviewRow {
  interviewId: string;
  name: string;
  phone: string | null;
  email: string | null;
  resumeNote: string | null;
  interviewAt: string | null;
  status: InterviewStatus;
  memo: string | null;
  createdAt: string;
  createdByName: string | null;
  updatedAt: string;
}

const str = (v: unknown, max: number): string | null => {
  if (v == null) return null;
  const s = String(v).trim().slice(0, max);
  return s ? s : null;
};

export async function listApplicantCounts(postingId: string): Promise<ApplicantCountRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.counted_on, c.count, c.memo, c.updated_at, u.name AS updated_by_name
         FROM recruit_applicant_counts c
         LEFT JOIN users u ON u.user_id = c.updated_by
        WHERE c.posting_id = $1
        ORDER BY c.counted_on`,
      [postingId]
    )
  );
  let prev: number | null = null;
  return rows.map((r) => {
    const count = Number(r.count ?? 0);
    const row: ApplicantCountRow = {
      countedOn: String(r.counted_on),
      count,
      delta: prev == null ? null : count - prev,
      memo: r.memo != null ? String(r.memo) : null,
      updatedAt: String(r.updated_at ?? ""),
      updatedByName: r.updated_by_name != null ? String(r.updated_by_name) : null,
    };
    prev = count;
    return row;
  });
}

/** 날짜별 누적 지원자 수 기록 — 같은 날짜는 갱신(이전 날짜 행은 그대로). */
export async function upsertApplicantCount(
  postingId: string,
  input: { countedOn: unknown; count: unknown; memo?: unknown },
  userId: string
): Promise<void> {
  const countedOn = str(input.countedOn, 10);
  if (!countedOn || !DATE_RE.test(countedOn)) throw fail("기준일을 8자리(YYYYMMDD)로 입력하세요.");
  const count = Number(input.count);
  if (!Number.isInteger(count) || count < 0 || count > 1_000_000) throw fail("지원자 수는 0 이상의 정수로 입력하세요.");
  const db = await getDb();
  const now = nowIso();
  await db.exec(
    `INSERT INTO recruit_applicant_counts (posting_id, counted_on, count, memo, created_at, created_by, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $5, $6)
     ON CONFLICT (posting_id, counted_on) DO UPDATE
       SET count = EXCLUDED.count, memo = EXCLUDED.memo, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [postingId, countedOn, count, str(input.memo, 200), now, userId]
  );
}

export async function deleteApplicantCount(postingId: string, countedOn: string): Promise<void> {
  const db = await getDb();
  await db.exec(`DELETE FROM recruit_applicant_counts WHERE posting_id = $1 AND counted_on = $2`, [postingId, countedOn]);
}

export async function listInterviews(postingId: string): Promise<InterviewRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT i.*, u.name AS created_by_name
         FROM recruit_interviews i
         LEFT JOIN users u ON u.user_id = i.created_by
        WHERE i.posting_id = $1
        ORDER BY i.interview_at NULLS LAST, i.created_at`,
      [postingId]
    )
  );
  return rows.map((r) => ({
    interviewId: String(r.interview_id),
    name: String(r.name ?? ""),
    phone: r.phone != null ? String(r.phone) : null,
    email: r.email != null ? String(r.email) : null,
    resumeNote: r.resume_note != null ? String(r.resume_note) : null,
    interviewAt: r.interview_at != null ? String(r.interview_at) : null,
    status: r.status === "done" ? "done" : r.status === "cancelled" ? "cancelled" : "scheduled",
    memo: r.memo != null ? String(r.memo) : null,
    createdAt: String(r.created_at ?? ""),
    createdByName: r.created_by_name != null ? String(r.created_by_name) : null,
    updatedAt: String(r.updated_at ?? ""),
  }));
}

export interface InterviewInput {
  name: unknown;
  phone?: unknown;
  email?: unknown;
  resumeNote?: unknown;
  /** "YYYY-MM-DD HH:MM" 또는 빈값 */
  interviewAt?: unknown;
  memo?: unknown;
}

function normalizeInterview(input: InterviewInput) {
  const name = str(input.name, 60);
  if (!name) throw fail("성명을 입력하세요.");
  const email = str(input.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail("이메일 형식이 올바르지 않습니다.");
  const interviewAt = str(input.interviewAt, 16);
  if (interviewAt && !DATETIME_RE.test(interviewAt)) throw fail("면접 일시는 날짜 8자리와 시각(HH:MM)을 모두 입력하세요.");
  return { name, phone: str(input.phone, 40), email, resumeNote: str(input.resumeNote, 300), interviewAt, memo: str(input.memo, 300) };
}

export async function createInterview(postingId: string, input: InterviewInput, userId: string): Promise<string> {
  const v = normalizeInterview(input);
  const db = await getDb();
  const id = "ri_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const now = nowIso();
  await db.exec(
    `INSERT INTO recruit_interviews
       (interview_id, posting_id, name, phone, email, resume_note, interview_at, status, memo, created_at, created_by, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9, $10, $9, $10)`,
    [id, postingId, v.name, v.phone, v.email, v.resumeNote, v.interviewAt, v.memo, now, userId]
  );
  return id;
}

export async function updateInterview(
  postingId: string,
  interviewId: string,
  patch: Partial<InterviewInput> & { status?: unknown },
  userId: string
): Promise<void> {
  const db = await getDb();
  const cur = rowsToObjects(
    await db.exec(`SELECT * FROM recruit_interviews WHERE posting_id = $1 AND interview_id = $2`, [postingId, interviewId])
  )[0];
  if (!cur) throw fail("면접 예정자를 찾을 수 없습니다.", 404);
  const merged = normalizeInterview({
    name: patch.name !== undefined ? patch.name : cur.name,
    phone: patch.phone !== undefined ? patch.phone : cur.phone,
    email: patch.email !== undefined ? patch.email : cur.email,
    resumeNote: patch.resumeNote !== undefined ? patch.resumeNote : cur.resume_note,
    interviewAt: patch.interviewAt !== undefined ? patch.interviewAt : cur.interview_at,
    memo: patch.memo !== undefined ? patch.memo : cur.memo,
  });
  const status = patch.status !== undefined ? String(patch.status) : String(cur.status);
  if (!["scheduled", "done", "cancelled"].includes(status)) throw fail("상태 값이 올바르지 않습니다.");
  await db.exec(
    `UPDATE recruit_interviews
        SET name = $3, phone = $4, email = $5, resume_note = $6, interview_at = $7, status = $8, memo = $9, updated_at = $10, updated_by = $11
      WHERE posting_id = $1 AND interview_id = $2`,
    [postingId, interviewId, merged.name, merged.phone, merged.email, merged.resumeNote, merged.interviewAt, status, merged.memo, nowIso(), userId]
  );
}

export async function deleteInterview(postingId: string, interviewId: string): Promise<void> {
  const db = await getDb();
  await db.exec(`DELETE FROM recruit_interviews WHERE posting_id = $1 AND interview_id = $2`, [postingId, interviewId]);
}
