// 내부고시 채번(서버 전용) — 연도 없는 통산 일련번호 '내부고시-NNNN호'(2026-09-22 사용자 확정).
// 시퀀스 키 = doc_no_sequences(rule_key='내부고시', year='ALL'). 자동 채번은 allocateDocNo(lib/approval/docs.ts),
// 관리자 직접 지정은 공문(lib/letter/store.ts assignManualDocNo)과 같은 방식으로 draft 단계에서 doc_no 를 선점한다.

import { getDb, rowsToObjects, type PgDatabase } from "@/lib/db";
import { NOTICE_FORM_ID, NOTICE_RULE_KEY, NOTICE_SEQ_START, NOTICE_SEQ_YEAR, formatNoticeNo, parseNoticeNo } from "./types";

/** 다음 자동 채번 번호 — 반납 풀의 최소 번호 우선, 없으면 시퀀스 + 1 */
export async function getNextNoticeNo(): Promise<string> {
  const db = await getDb();
  const pool = rowsToObjects(
    await db.exec(`SELECT min(seq) AS seq FROM doc_no_pool WHERE rule_key = $1 AND year = $2`, [NOTICE_RULE_KEY, NOTICE_SEQ_YEAR])
  );
  let seq = pool[0]?.seq != null ? Number(pool[0].seq) : null;
  if (seq == null) {
    const rows = rowsToObjects(
      await db.exec(`SELECT last_seq FROM doc_no_sequences WHERE rule_key = $1 AND year = $2`, [NOTICE_RULE_KEY, NOTICE_SEQ_YEAR])
    );
    seq = rows.length ? Number(rows[0].last_seq) + 1 : NOTICE_SEQ_START;
  }
  return formatNoticeNo(seq);
}

/** 번호 사용 여부 — 결재 문서(내부고시 양식)의 doc_no 기준 */
export async function checkNoticeNoAvailable(no: string, excludeDocId?: string | null): Promise<{ available: boolean; usedBy: string | null }> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT title FROM approval_docs WHERE form_id = $1 AND doc_no = $2 AND ($3::text IS NULL OR doc_id <> $3)`,
      [NOTICE_FORM_ID, no, excludeDocId ?? null]
    )
  );
  if (!rows.length) return { available: true, usedBy: null };
  return { available: false, usedBy: rows[0].title != null ? String(rows[0].title) : "(제목 없음)" };
}

/**
 * 직접 지정 번호 선점(관리자) — doc_no 기록 + 시퀀스를 GREATEST 로 끌어올려 자동 채번이 다시 내주지 않게 한다.
 * 건너뛴 번호는 반납 풀에 넣지 않는다(수기 발번분 자리).
 */
export async function assignManualNoticeNo(txn: PgDatabase, docId: string, no: string): Promise<void> {
  const seq = parseNoticeNo(no);
  if (seq == null) throw Object.assign(new Error("내부고시 번호 형식이 올바르지 않습니다(예: 내부고시-1010호)."), { status: 400 });
  const normalized = formatNoticeNo(seq);
  const dup = rowsToObjects(
    await txn.exec(`SELECT 1 FROM approval_docs WHERE form_id = $1 AND doc_no = $2 AND doc_id <> $3`, [NOTICE_FORM_ID, normalized, docId])
  );
  if (dup.length) throw Object.assign(new Error(`이미 사용 중인 내부고시 번호입니다(${normalized}).`), { status: 400 });
  await txn.run(`UPDATE approval_docs SET doc_no = $2 WHERE doc_id = $1`, [docId, normalized]);
  await txn.run(
    `INSERT INTO doc_no_sequences (rule_key, year, last_seq) VALUES ($1, $2, $3)
     ON CONFLICT (rule_key, year) DO UPDATE SET last_seq = GREATEST(doc_no_sequences.last_seq, EXCLUDED.last_seq)`,
    [NOTICE_RULE_KEY, NOTICE_SEQ_YEAR, seq]
  );
  await txn.run(`DELETE FROM doc_no_pool WHERE rule_key = $1 AND year = $2 AND seq = $3`, [NOTICE_RULE_KEY, NOTICE_SEQ_YEAR, seq]);
}
