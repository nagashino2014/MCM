// 공문 발송 대장(official_letters, 135) DB 접근 — 승인 시 pending 등록, 발송 파이프라인의
// 상태 선점/확정, 목록/상세 조회, 백필(imported) 등록, 수신처 사후 편집.
// 문서 원본은 approval_docs.field_values 이고 이 테이블은 발송·산출물 메타 전용이다.
// ⚠ lib/approval/docs.ts 와의 순환 import 금지 — 여기서는 db 만 사용한다.

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import {
  LETTER_FORM_ID,
  LETTER_RULE_KEY,
  LETTER_SEQ_START,
  formatLetterNo,
  parseLetterNo,
  type LetterRecipient,
  type LetterSendRecord,
  type LetterSendStatus,
  type OfficialLetterRow,
} from "./types";

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
    sendHistory: parseJsonArr<LetterSendRecord>(r.send_history),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

/**
 * 최종 승인 시 발송 대장 등록(actOnDoc 트랜잭션 내 — 가벼운 upsert 만).
 * 공문 양식 문서가 아니면 no-op. 재승인(회수 → 수정 → 재상신)이면 send_status 를
 * pending 으로 되돌려 자동 재발송한다 — 과거 발송은 send_history(194)에 남아 있다.
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
       send_status = 'pending',
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

/**
 * 발송 선점 — pending|failed → generating. 0행이면 이미 발송됨/진행 중(중복 실행 가드).
 * sent 건 즉시 재발송은 지원하지 않는다(2026-08-19 사용자 확정) — 수정 없이 같은 공문을
 * 다시 보내는 건 무의미. 재발송은 회수(recallLetterDoc) → 수정 → 재결재 승인 경유
 * (재승인 시 markLetterPendingOnApproval 이 pending 으로 되돌려 이 관문을 다시 통과한다).
 */
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

export async function finishLetterSend(
  docId: string,
  result: { ok: boolean; error?: string | null; messageId?: string | null; to?: string[]; cc?: string[] }
): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    if (result.ok) {
      // 발송 이력 누적(194) — 1차부터 N차까지. sent_at 은 최근 발송 시각.
      const entry: LetterSendRecord = { sentAt: now, messageId: result.messageId ?? null };
      if (result.to?.length) entry.to = result.to;
      if (result.cc?.length) entry.cc = result.cc;
      await txn.run(
        `UPDATE official_letters
            SET send_status = 'sent', sent_at = $2, sent_message_id = $3, send_error = NULL,
                send_history = COALESCE(send_history, '[]'::jsonb) || $4::jsonb, updated_at = $2
          WHERE doc_id = $1`,
        [docId, now, result.messageId ?? null, JSON.stringify([entry])]
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

/**
 * 이관(imported) 등록 — 과거·사외 공문. letter_no UNIQUE 충돌 시 false(스킵, 재실행 멱등).
 * 결재 문서가 선점 중인 번호(수동 지정 draft 포함)면 오등록이므로 400 으로 막고,
 * 자동 채번이 같은 번호를 다시 내주지 않도록 시퀀스를 GREATEST 로 끌어올린다.
 */
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
    const taken = rowsToObjects(await txn.exec(`SELECT title FROM approval_docs WHERE doc_no = $1`, [params.letterNo]));
    if (taken.length) {
      throw Object.assign(new Error(`결재 문서가 사용 중인 공문번호입니다(${params.letterNo}).`), { status: 400 });
    }
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
    const parsed = parseLetterNo(params.letterNo);
    if (inserted && parsed) {
      await txn.run(
        `INSERT INTO doc_no_sequences (rule_key, year, last_seq) VALUES ($1, $2, $3)
         ON CONFLICT (rule_key, year) DO UPDATE SET last_seq = GREATEST(doc_no_sequences.last_seq, EXCLUDED.last_seq)`,
        [LETTER_RULE_KEY, parsed.year, parsed.seq]
      );
      await txn.run(`DELETE FROM doc_no_pool WHERE rule_key = $1 AND year = $2 AND seq = $3`, [
        LETTER_RULE_KEY,
        parsed.year,
        parsed.seq,
      ]);
    }
  });
  return { inserted, letterId: inserted ? letterId : null };
}

/**
 * 공문번호 사용 현황(연도) — 대장(official_letters)과 결재 문서(approval_docs.doc_no)를 합집합으로 본다.
 * 수동 지정 문서는 상신 전(draft)에도 doc_no 를 선점하므로 approval_docs 도 함께 봐야 중복이 안 난다.
 */
export async function listUsedLetterSeqs(year: string): Promise<Map<number, string>> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT letter_no AS no FROM official_letters WHERE letter_no LIKE $1
        UNION
       SELECT doc_no AS no FROM approval_docs WHERE form_id = $2 AND doc_no LIKE $1`,
      [`${year}-${LETTER_RULE_KEY}-%`, LETTER_FORM_ID]
    )
  );
  const out = new Map<number, string>();
  for (const r of rows) {
    const parsed = parseLetterNo(String(r.no ?? ""));
    if (parsed) out.set(parsed.seq, String(r.no));
  }
  return out;
}

/**
 * 채번 현황 — 다음 자동 채번 번호와 결번(미등록 번호) 목록.
 * 결번 = 사용 하한(01001 또는 최소 사용 번호)부터 마지막 사용 번호까지 중 비어 있는 번호.
 * 수동 지정으로 건너뛴 번호(사외에서 이미 쓰인 공문)가 여기 나오고, 커스텀 이관 등록으로 메운다.
 */
export async function getLetterNumbering(year: string): Promise<{ nextNo: string; gaps: string[]; usedCount: number }> {
  const db = await getDb();
  const used = await listUsedLetterSeqs(year);
  const pool = rowsToObjects(
    await db.exec(`SELECT min(seq) AS seq FROM doc_no_pool WHERE rule_key = $1 AND year = $2`, [LETTER_RULE_KEY, year])
  );
  let nextSeq = pool[0]?.seq != null ? Number(pool[0].seq) : null;
  if (nextSeq == null) {
    const rows = rowsToObjects(
      await db.exec(`SELECT last_seq FROM doc_no_sequences WHERE rule_key = $1 AND year = $2`, [LETTER_RULE_KEY, year])
    );
    nextSeq = rows.length ? Number(rows[0].last_seq) + 1 : LETTER_SEQ_START;
  }
  const seqs = [...used.keys()].sort((a, b) => a - b);
  const gaps: string[] = [];
  if (seqs.length) {
    for (let s = Math.min(LETTER_SEQ_START, seqs[0]); s < seqs[seqs.length - 1]; s += 1) {
      if (!used.has(s)) gaps.push(formatLetterNo(year, s));
    }
  }
  return { nextNo: formatLetterNo(year, nextSeq), gaps, usedCount: used.size };
}

/** 공문번호 사용 가능 여부 — 중복이면 어디에 쓰였는지(대장 제목/문서 제목)를 함께 돌려준다. */
export async function checkLetterNoAvailable(letterNo: string, excludeDocId?: string | null): Promise<{ available: boolean; usedBy: string | null }> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT title FROM official_letters WHERE letter_no = $1 AND ($2::text IS NULL OR doc_id IS NULL OR doc_id <> $2)
        UNION ALL
       SELECT title FROM approval_docs WHERE doc_no = $1 AND ($2::text IS NULL OR doc_id <> $2)`,
      [letterNo, excludeDocId ?? null]
    )
  );
  if (!rows.length) return { available: true, usedBy: null };
  return { available: false, usedBy: rows[0].title != null ? String(rows[0].title) : "(제목 없음)" };
}

/**
 * 수동 지정 번호 선점(관리자) — approval_docs.doc_no 에 기록하고 시퀀스를 동기화한다.
 * 상신(submitDoc)은 doc_no 가 이미 있으면 그대로 쓰므로 이 값이 확정 번호가 된다.
 * 시퀀스는 GREATEST 로만 올린다 → 건너뛴 번호는 반납 풀에 넣지 않고 비워 두고(사외 사용분),
 * 나중에 이관 등록(insertImportedLetter)으로 메운다.
 */
export async function assignManualDocNo(txn: PgDatabase, docId: string, letterNo: string): Promise<void> {
  const parsed = parseLetterNo(letterNo);
  if (!parsed) throw Object.assign(new Error("공문번호 형식이 올바르지 않습니다(예: 2026-대외-01036)."), { status: 400 });
  const dup = rowsToObjects(
    await txn.exec(
      `SELECT 1 FROM official_letters WHERE letter_no = $1 AND (doc_id IS NULL OR doc_id <> $2)
        UNION ALL
       SELECT 1 FROM approval_docs WHERE doc_no = $1 AND doc_id <> $2`,
      [letterNo, docId]
    )
  );
  if (dup.length) throw Object.assign(new Error(`이미 사용 중인 공문번호입니다(${letterNo}).`), { status: 400 });
  await txn.run(`UPDATE approval_docs SET doc_no = $2 WHERE doc_id = $1`, [docId, letterNo]);
  // 자동 채번이 이 번호를 다시 내주지 않도록 시퀀스를 끌어올리고, 반납 풀에 있으면 제거한다.
  await txn.run(
    `INSERT INTO doc_no_sequences (rule_key, year, last_seq) VALUES ($1, $2, $3)
     ON CONFLICT (rule_key, year) DO UPDATE SET last_seq = GREATEST(doc_no_sequences.last_seq, EXCLUDED.last_seq)`,
    [LETTER_RULE_KEY, parsed.year, parsed.seq]
  );
  await txn.run(`DELETE FROM doc_no_pool WHERE rule_key = $1 AND year = $2 AND seq = $3`, [
    LETTER_RULE_KEY,
    parsed.year,
    parsed.seq,
  ]);
}

/** 이관 등록(imported) 문서 삭제 — 오등록 정정용(관리자). 시스템 생성분은 대상이 아니다. */
export async function deleteImportedLetter(letterId: string): Promise<boolean> {
  let deleted = false;
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(`DELETE FROM official_letters WHERE letter_id = $1 AND source = 'imported' RETURNING letter_id`, [letterId])
    );
    deleted = rows.length > 0;
  });
  return deleted;
}
