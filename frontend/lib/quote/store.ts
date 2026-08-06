// 견적 발송 대장(quotations, 136) DB 접근 — 승인 시 pending 등록, 발송/생성 파이프라인의
// 상태 선점/확정, 목록/상세 조회, 수신처·결과 사후 편집.
// 문서 원본은 approval_docs.field_values 이고 이 테이블은 발송·산출물 메타 + 산정 스냅샷 대장이다.
// ⚠ lib/approval/docs.ts 와의 순환 import 금지 — 여기서는 db 만 사용한다(공문 store 관례).

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import {
  QUOTE_FORM_ID,
  type QuoteFieldValues,
  type QuoteRecipient,
  type QuoteResult,
  type QuoteSendStatus,
  type QuotationRow,
  type SituationEntry,
} from "./types";

function newQuoteId(): string {
  return "qt-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
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

function mapRow(r: Record<string, unknown>): QuotationRow {
  return {
    quoteId: String(r.quote_id ?? ""),
    docId: String(r.doc_id ?? ""),
    quoteNo: r.quote_no != null ? String(r.quote_no) : null,
    year: r.year != null ? String(r.year) : null,
    title: r.title != null ? String(r.title) : null,
    serviceType: r.service_type != null ? String(r.service_type) : null,
    serviceSubtype: r.service_subtype != null ? String(r.service_subtype) : null,
    recipients: parseJsonArr<QuoteRecipient>(r.recipients),
    ccRefs: parseJsonArr<QuoteRecipient>(r.cc_refs),
    drafterName: r.drafter_name != null ? String(r.drafter_name) : null,
    issueDate: r.issue_date != null ? String(r.issue_date) : null,
    validUntil: r.valid_until != null ? String(r.valid_until) : null,
    totalAmount: r.total_amount != null ? Number(r.total_amount) : null,
    xlsxKey: r.xlsx_key != null ? String(r.xlsx_key) : null,
    pdfKey: r.pdf_key != null ? String(r.pdf_key) : null,
    sendMode: String(r.send_mode ?? "mail") === "direct" ? "direct" : "mail",
    sendStatus: (String(r.send_status ?? "pending") as QuoteSendStatus) ?? "pending",
    sendError: r.send_error != null ? String(r.send_error) : null,
    sendAttempts: Number(r.send_attempts ?? 0),
    sentAt: r.sent_at != null ? String(r.sent_at) : null,
    situation: parseJsonArr<SituationEntry>(r.situation),
    result: (["pending", "won", "lost", "dropped"].includes(String(r.result)) ? String(r.result) : "pending") as QuotationRow["result"],
    resultNote: r.result_note != null ? String(r.result_note) : null,
    resultAt: r.result_at != null ? String(r.result_at) : null,
    resultAmount: r.result_amount != null ? Number(r.result_amount) : null,
    resultReason: r.result_reason != null ? String(r.result_reason) : null,
    contractId: r.contract_id != null ? String(r.contract_id) : null,
    createdAt: String(r.created_at ?? ""),
  };
}

/** 견적일 + 1개월 (유효기간 고정 정책의 계산값) */
function validUntilOf(issueDate: string): string {
  const d = new Date(issueDate + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * 최종 승인 시 발송 대장 등록(actOnDoc 트랜잭션 내 — 가벼운 upsert 만).
 * 견적 양식 문서가 아니면 no-op. 이미 발송 완료(sent)면 상태를 되돌리지 않는다.
 * 사업장 라인(quotation_sites) 스냅샷도 여기서 적재한다(재승인 시 갱신).
 */
export async function markQuotePendingOnApproval(txn: PgDatabase, docId: string): Promise<void> {
  const rows = rowsToObjects(
    await txn.exec(
      `SELECT d.doc_no, d.title, d.drafter_name, d.field_values FROM approval_docs d
        WHERE d.doc_id = $1 AND d.form_id = $2`,
      [docId, QUOTE_FORM_ID]
    )
  );
  if (!rows.length) return;
  const r = rows[0];
  let values: Partial<QuoteFieldValues> = {};
  try {
    values = typeof r.field_values === "string" ? JSON.parse(String(r.field_values)) : ((r.field_values ?? {}) as Partial<QuoteFieldValues>);
  } catch {
    values = {};
  }
  const docNo = r.doc_no != null ? String(r.doc_no) : null;
  const now = new Date().toISOString();
  const issueDate = String(values.issue_date ?? now.slice(0, 10));
  const sites = Array.isArray(values.sites) ? values.sites : [];
  const totalAmount = sites.reduce((acc, s) => acc + (Number(s?.amounts?.final) || 0), 0);
  const sendMode = values.send_mode === "direct" ? "direct" : "mail";
  const inserted = rowsToObjects(
    await txn.exec(
      `INSERT INTO quotations
         (quote_id, doc_id, quote_no, year, title, service_type, service_subtype, recipients, cc_refs,
          drafter_name, issue_date, valid_until, total_amount, send_mode, situation, send_status, sales_project_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15::jsonb, 'pending', $16, $17, $17)
       ON CONFLICT (doc_id) DO UPDATE SET
         quote_no = EXCLUDED.quote_no,
         title = EXCLUDED.title,
         service_type = EXCLUDED.service_type,
         service_subtype = EXCLUDED.service_subtype,
         recipients = EXCLUDED.recipients,
         cc_refs = EXCLUDED.cc_refs,
         issue_date = EXCLUDED.issue_date,
         valid_until = EXCLUDED.valid_until,
         total_amount = EXCLUDED.total_amount,
         send_mode = EXCLUDED.send_mode,
         situation = EXCLUDED.situation,
         send_status = CASE WHEN quotations.send_status = 'sent' THEN 'sent' ELSE 'pending' END,
         updated_at = EXCLUDED.updated_at
       RETURNING quote_id`,
      [
        newQuoteId(),
        docId,
        docNo,
        docNo ? docNo.slice(0, 4) : now.slice(0, 4),
        String(r.title ?? ""),
        String(values.service_type ?? ""),
        String(values.service_subtype ?? ""),
        JSON.stringify(values.recipients ?? []),
        JSON.stringify(values.cc_refs ?? []),
        r.drafter_name != null ? String(r.drafter_name) : null,
        issueDate,
        validUntilOf(issueDate),
        Math.round(totalAmount),
        sendMode,
        JSON.stringify(values.situation ?? []),
        values.sales_project_id != null ? String(values.sales_project_id) : null,
        now,
      ]
    )
  );
  // 사업장 라인 스냅샷 재적재(재승인 대비 전체 교체)
  const quoteId = String(inserted[0]?.quote_id ?? "");
  if (quoteId) {
    await txn.run(`DELETE FROM quotation_sites WHERE quote_id = $1`, [quoteId]);
    for (const s of sites) {
      await txn.run(
        `INSERT INTO quotation_sites (quote_id, site_seq, facility_id, site_label, factors, md_matrix, rates, amounts, remarks)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9)`,
        [
          quoteId,
          Number(s.siteSeq) || 0,
          s.facilityId != null ? String(s.facilityId) : null,
          String(s.siteLabel ?? ""),
          JSON.stringify(s.factors ?? {}),
          JSON.stringify(s.mdMatrix ?? []),
          JSON.stringify(s.rates ?? {}),
          JSON.stringify(s.amounts ?? {}),
          s.remarks != null ? String(s.remarks) : null,
        ]
      );
    }
  }
}

/** 생성/발송 선점 — pending|failed → generating. 0행이면 이미 진행 중(중복 실행 가드). */
export async function claimQuoteSend(docId: string): Promise<QuotationRow | null> {
  let row: QuotationRow | null = null;
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(
        `UPDATE quotations
            SET send_status = 'generating', send_attempts = send_attempts + 1, send_error = NULL, updated_at = $2
          WHERE doc_id = $1 AND send_status IN ('pending', 'failed', 'generated')
          RETURNING *`,
        [docId, new Date().toISOString()]
      )
    );
    row = rows.length ? mapRow(rows[0]) : null;
  });
  return row;
}

export async function setQuoteArtifacts(docId: string, xlsxKey: string | null, pdfKey: string | null): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(`UPDATE quotations SET xlsx_key = $2, pdf_key = $3, updated_at = $4 WHERE doc_id = $1`, [
      docId,
      xlsxKey,
      pdfKey,
      new Date().toISOString(),
    ]);
  });
}

/**
 * 생성/발송 확정 — mode=direct 는 산출물 생성만으로 완료(generated),
 * mode=mail 은 발송 성공 시 sent / 실패 시 failed.
 */
export async function finishQuoteSend(
  docId: string,
  result: { ok: boolean; mode: "mail" | "direct"; error?: string | null; messageId?: string | null }
): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    if (!result.ok) {
      await txn.run(`UPDATE quotations SET send_status = 'failed', send_error = $2, updated_at = $3 WHERE doc_id = $1`, [
        docId,
        String(result.error ?? "발송 실패"),
        now,
      ]);
    } else if (result.mode === "direct") {
      await txn.run(`UPDATE quotations SET send_status = 'generated', send_error = NULL, updated_at = $2 WHERE doc_id = $1`, [docId, now]);
    } else {
      await txn.run(
        `UPDATE quotations SET send_status = 'sent', sent_at = $2, sent_message_id = $3, send_error = NULL, updated_at = $2 WHERE doc_id = $1`,
        [docId, now, result.messageId ?? null]
      );
    }
  });
}

export async function getQuoteByDocId(docId: string): Promise<QuotationRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM quotations WHERE doc_id = $1`, [docId]));
  return rows.length ? mapRow(rows[0]) : null;
}

export async function getQuoteById(quoteId: string): Promise<QuotationRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM quotations WHERE quote_id = $1`, [quoteId]));
  return rows.length ? mapRow(rows[0]) : null;
}

/** 발송견적 목록 — 양식별 문서 조회 '발송견적' 탭. from/to = YYYY-MM. */
export async function listQuotes(params: { from?: string | null; to?: string | null; q?: string | null; limit?: number }): Promise<QuotationRow[]> {
  const db = await getDb();
  const cond: string[] = [];
  const args: unknown[] = [];
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
    cond.push(`(title ILIKE $${args.length} OR quote_no ILIKE $${args.length} OR drafter_name ILIKE $${args.length})`);
  }
  args.push(Math.min(500, Math.max(1, params.limit ?? 200)));
  const rows = rowsToObjects(
    await db.exec(
      `SELECT * FROM quotations
        ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
        ORDER BY quote_no DESC NULLS LAST, created_at DESC
        LIMIT $${args.length}`,
      args
    )
  );
  return rows.map(mapRow);
}

/** 수신처·참조·수주 결과 사후 편집. 수신처 변경은 approval_docs.field_values 에도 반영(재발송 대비). */
export async function updateQuoteMeta(
  quoteId: string,
  patch: {
    recipients?: QuoteRecipient[];
    ccRefs?: QuoteRecipient[];
    result?: QuoteResult;
    resultNote?: string | null;
    resultAt?: string | null;
    resultAmount?: number | null;
    resultReason?: string | null;
    contractId?: string | null;
  }
): Promise<void> {
  await withDbWrite(async (txn) => {
    const sets: string[] = [];
    const args: unknown[] = [quoteId];
    if (patch.recipients !== undefined) {
      args.push(JSON.stringify(patch.recipients));
      sets.push(`recipients = $${args.length}::jsonb`);
    }
    if (patch.ccRefs !== undefined) {
      args.push(JSON.stringify(patch.ccRefs));
      sets.push(`cc_refs = $${args.length}::jsonb`);
    }
    if (patch.result !== undefined) {
      args.push(patch.result);
      sets.push(`result = $${args.length}`);
    }
    if (patch.resultNote !== undefined) {
      args.push(patch.resultNote);
      sets.push(`result_note = $${args.length}`);
    }
    if (patch.resultAt !== undefined) {
      args.push(patch.resultAt);
      sets.push(`result_at = $${args.length}`);
    }
    if (patch.resultAmount !== undefined) {
      args.push(patch.resultAmount);
      sets.push(`result_amount = $${args.length}`);
    }
    if (patch.resultReason !== undefined) {
      args.push(patch.resultReason);
      sets.push(`result_reason = $${args.length}`);
    }
    if (patch.contractId !== undefined) {
      args.push(patch.contractId);
      sets.push(`contract_id = $${args.length}`);
    }
    if (!sets.length) return;
    args.push(new Date().toISOString());
    sets.push(`updated_at = $${args.length}`);
    await txn.run(`UPDATE quotations SET ${sets.join(", ")} WHERE quote_id = $1`, args);
    if (patch.recipients !== undefined || patch.ccRefs !== undefined) {
      const merge: Record<string, unknown> = {};
      if (patch.recipients !== undefined) merge.recipients = patch.recipients;
      if (patch.ccRefs !== undefined) merge.cc_refs = patch.ccRefs;
      await txn.run(
        `UPDATE approval_docs SET field_values = field_values || $2::jsonb
          WHERE doc_id = (SELECT doc_id FROM quotations WHERE quote_id = $1)`,
        [quoteId, JSON.stringify(merge)]
      );
    }
  });
}
