// 공문 발송 대장(official_letters, 135) DB 접근 — 승인 시 pending 등록, 발송 파이프라인의
// 상태 선점/확정, 목록/상세 조회, 백필(imported) 등록, 수신처 사후 편집.
// 문서 원본은 approval_docs.field_values 이고 이 테이블은 발송·산출물 메타 전용이다.
// ⚠ lib/approval/docs.ts 와의 순환 import 금지 — 여기서는 db 만 사용한다.

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { LETTER_FORM_ID, type LetterRecipient, type LetterSendStatus, type OfficialLetterRow } from "./types";

function newLetterId(): string {
  return "ltr-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
}

function parseJsonArr<T>(raw: unknown): T[] {
  if (raw == null) return [];
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function mapRow(r: Record<string, unknown>): OfficialLetterRow {
  return {
    letterId: String(r.letter_id ?? ""),
    docId: r.doc_id != null ? String(r.doc_id) : null,
    source: String(r.source ?? "system") === "imported" ? "imported" : "system",
    letterNo: r.letter_no != null ? String(r.letter_no) : null,
    year: r.year != null ? String(r.year) : null,
    title: r.title != null ? String(r.title) : null,
    letterKind: String(r.letter_kind ?? "general") === "proof" ? "proof" : "general",
    recipients: parseJsonArr<LetterRecipient>(r.recipients),
    ccRefs: parseJsonArr<LetterRecipient>(r.cc_refs),
    drafterName: r.drafter_name != null ? String(r.drafter_name) : null,
    issueDate: r.issue_date != null ? String(r.issue_date) : null,
    pdfKey: r.pdf_key != null ? String(r.pdf_key) : null,
    hwpxKey: r.hwpx_key != null ? String(r.hwpx_key) : null,
    hwpKey: r.hwp_key != null ? String(r.hwp_key) : null,
    attachKeys: parseJsonArr<{ name: string; key: string }>(r.attach_keys),
    sendStatus: (String(r.send_status ?? "pending") as LetterSendStatus) ?? "pending",
    sendError: r.send_error != null ? String(r.send_error) : null,
    sendAttempts: Number(r.send_attempts ?? 0),
    sentAt: r.sent_at != null ? String(r.sent_at) : null,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

/**
 * 최종 승인 시 발송 대장 등록(actOnDoc 트랜잭션 내 — 가벼운 upsert 만).
 * 공문 양식 문서가 아니면 no-op. 이미 발송 완료(sent)면 상태를 되돌리지 않는다.
 */
export async function markLetterPendingOnApproval(txn: PgDatabase, docId: string): Promise<void> {
  const rows = rowsToObjects(
    await txn.exec(
      `SELECT d.doc_no, d.title, d.drafter_name, d.field_values FROM approval_docs d
        WHERE d.doc_id = $1 AND d.form_id = $2`,
      [docId, LETTER_FORM_ID]
    )
  );
  if (!rows.length) return;
  const r = rows[0];
  let values: Record<string, unknown> = {};
  try {
    values = typeof r.field_values === "string" ? JSON.parse(String(r.field_values)) : ((r.field_values ?? {}) as Record<string, unknown>);
  } catch {
    values = {};
  }
  const docNo = r.doc_no != null ? String(r.doc_no) : null;
  const now = new Date().toISOString();
  await txn.run(
    `INSERT INTO official_letters
       (letter_id, doc_id, source, letter_no, year, title, letter_kind, recipients, cc_refs, drafter_name, issue_date, send_status, created_at, updated_at)
     VALUES ($1, $2, 'system', $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, 'pending', $11, $11)
     ON CONFLICT (doc_id) DO UPDATE SET
       letter_no = EXCLUDED.letter_no,
       title = EXCLUDED.title,
       letter_kind = EXCLUDED.letter_kind,
       recipients = EXCLUDED.recipients,
       cc_refs = EXCLUDED.cc_refs,
       issue_date = EXCLUDED.issue_date,
       send_status = CASE WHEN official_letters.send_status = 'sent' THEN 'sent' ELSE 'pending' END,
       updated_at = EXCLUDED.updated_at`,
    [
      newLetterId(),
      docId,
      docNo,
      docNo ? docNo.slice(0, 4) : now.slice(0, 4),
      String(r.title ?? ""),
      String((values.letter_kind as string) ?? "general") === "proof" ? "proof" : "general",
      JSON.stringify(values.recipients ?? []),
      JSON.stringify(values.cc_refs ?? []),
      r.drafter_name != null ? String(r.drafter_name) : null,
      now.slice(0, 10),
      now,
    ]
  );
}

/** 발송 선점 — pending|failed → generating. 0행이면 이미 발송됨/진행 중(중복 실행 가드). */
export async function claimLetterSend(docId: string): Promise<OfficialLetterRow | null> {
  let row: OfficialLetterRow | null = null;
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(
        `UPDATE official_letters
            SET send_status = 'generating', send_attempts = send_attempts + 1, send_error = NULL, updated_at = $2
          WHERE doc_id = $1 AND send_status IN ('pending', 'failed')
          RETURNING *`,
        [docId, new Date().toISOString()]
      )
    );
    row = rows.length ? mapRow(rows[0]) : null;
  });
  return row;
}

export async function setLetterArtifacts(docId: string, pdfKey: string, hwpxKey: string | null, fitParams: unknown): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(
      `UPDATE official_letters SET pdf_key = $2, hwpx_key = $3, fit_params = $4::jsonb, updated_at = $5 WHERE doc_id = $1`,
      [docId, pdfKey, hwpxKey, JSON.stringify(fitParams ?? null), new Date().toISOString()]
    );
  });
}

export async function finishLetterSend(docId: string, result: { ok: boolean; error?: string | null; messageId?: string | null }): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    if (result.ok) {
      await txn.run(
        `UPDATE official_letters SET send_status = 'sent', sent_at = $2, sent_message_id = $3, send_error = NULL, updated_at = $2 WHERE doc_id = $1`,
        [docId, now, result.messageId ?? null]
      );
    } else {
      await txn.run(`UPDATE official_letters SET send_status = 'failed', send_error = $2, updated_at = $3 WHERE doc_id = $1`, [
        docId,
        String(result.error ?? "발송 실패"),
        now,
      ]);
    }
  });
}

export async function getLetterByDocId(docId: string): Promise<OfficialLetterRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM official_letters WHERE doc_id = $1`, [docId]));
  return rows.length ? mapRow(rows[0]) : null;
}

export async function getLetterById(letterId: string): Promise<OfficialLetterRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM official_letters WHERE letter_id = $1`, [letterId]));
  return rows.length ? mapRow(rows[0]) : null;
}

/** 발송공문 목록 — 양식별 문서 조회 '발송공문' 탭. imported(백필) 포함. */
export async function listLetters(params: { from?: string | null; to?: string | null; q?: string | null; limit?: number }): Promise<OfficialLetterRow[]> {
  const db = await getDb();
  const cond: string[] = [];
  const args: unknown[] = [];
  // from/to = YYYY-MM (월 단위) — issue_date 앞 7자로 비교
  if (params.from) {
    args.push(params.from);
    cond.push(`substr(COALESCE(issue_date, created_at), 1, 7) >= $${args.length}`);
  }
  if (params.to) {
    args.push(params.to);
    cond.push(`substr(COALESCE(issue_date, created_at), 1, 7) <= $${args.length}`);
  }
  if (params.q?.trim()) {
    args.push(`%${params.q.trim()}%`);
    cond.push(`(title ILIKE $${args.length} OR letter_no ILIKE $${args.length} OR drafter_name ILIKE $${args.length})`);
  }
  args.push(Math.min(500, Math.max(1, params.limit ?? 200)));
  const rows = rowsToObjects(
    await db.exec(
      `SELECT * FROM official_letters
        ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
        ORDER BY letter_no DESC NULLS LAST, created_at DESC
        LIMIT $${args.length}`,
      args
    )
  );
  return rows.map(mapRow);
}

/** 수신처·참조 사후 편집(백필 문서 메일주소 보완 등). */
export async function updateLetterMeta(
  letterId: string,
  patch: { title?: string; issueDate?: string | null; recipients?: LetterRecipient[]; ccRefs?: LetterRecipient[] }
): Promise<void> {
  await withDbWrite(async (txn) => {
    const sets: string[] = [];
    const args: unknown[] = [letterId];
    if (patch.title !== undefined) {
      args.push(patch.title);
      sets.push(`title = $${args.length}`);
    }
    if (patch.issueDate !== undefined) {
      args.push(patch.issueDate);
      sets.push(`issue_date = $${args.length}`);
    }
    if (patch.recipients !== undefined) {
      args.push(JSON.stringify(patch.recipients));
      sets.push(`recipients = $${args.length}::jsonb`);
    }
    if (patch.ccRefs !== undefined) {
      args.push(JSON.stringify(patch.ccRefs));
      sets.push(`cc_refs = $${args.length}::jsonb`);
    }
    if (!sets.length) return;
    args.push(new Date().toISOString());
    sets.push(`updated_at = $${args.length}`);
    await txn.run(`UPDATE official_letters SET ${sets.join(", ")} WHERE letter_id = $1`, args);
    // 시스템 문서는 재발송 시 최신 수신처를 쓰도록 approval_docs.field_values 에도 반영
    if (patch.recipients !== undefined || patch.ccRefs !== undefined) {
      const merge: Record<string, unknown> = {};
      if (patch.recipients !== undefined) merge.recipients = patch.recipients;
      if (patch.ccRefs !== undefined) merge.cc_refs = patch.ccRefs;
      await txn.run(
        `UPDATE approval_docs SET field_values = field_values || $2::jsonb
          WHERE doc_id = (SELECT doc_id FROM official_letters WHERE letter_id = $1 AND doc_id IS NOT NULL)`,
        [letterId, JSON.stringify(merge)]
      );
    }
  });
}

/** 백필(imported) 등록 — 과거 공문. letter_no UNIQUE 충돌 시 false(스킵, 재실행 멱등). */
export async function insertImportedLetter(params: {
  letterNo: string;
  title: string;
  letterKind?: "general" | "proof";
  recipients?: LetterRecipient[];
  ccRefs?: LetterRecipient[];
  drafterName?: string | null;
  issueDate?: string | null;
  pdfKey?: string | null;
  hwpKey?: string | null;
  hwpxKey?: string | null;
  attachKeys?: { name: string; key: string }[];
}): Promise<{ inserted: boolean; letterId: string | null }> {
  const now = new Date().toISOString();
  const letterId = newLetterId();
  let inserted = false;
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(
        `INSERT INTO official_letters
           (letter_id, doc_id, source, letter_no, year, title, letter_kind, recipients, cc_refs, drafter_name, issue_date,
            pdf_key, hwp_key, hwpx_key, attach_keys, send_status, created_at, updated_at)
         VALUES ($1, NULL, 'imported', $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb, 'archived', $14, $14)
         ON CONFLICT (letter_no) DO NOTHING
         RETURNING letter_id`,
        [
          letterId,
          params.letterNo,
          /^(\d{4})/.exec(params.letterNo)?.[1] ?? null,
          params.title,
          params.letterKind === "proof" ? "proof" : "general",
          JSON.stringify(params.recipients ?? []),
          JSON.stringify(params.ccRefs ?? []),
          params.drafterName ?? null,
          params.issueDate ?? null,
          params.pdfKey ?? null,
          params.hwpKey ?? null,
          params.hwpxKey ?? null,
          JSON.stringify(params.attachKeys ?? []),
          now,
        ]
      )
    );
    inserted = rows.length > 0;
  });
  return { inserted, letterId: inserted ? letterId : null };
}
