// 미니 전표 계층 — 자동분개 생성·확정·조회 (accounting-expansion 블루프린트 §5 P3)
//
// 원칙(★설계 대원칙 U2·U3):
// - 전표는 원장 위의 "파생 계층" — regenerateJournal 이 소스 4종을 스캔해 언제든 재생성한다.
//   재생성 시 auto/pending 은 삭제 후 다시 만들고, confirmed/excluded(사람 판단) 는 보존한다
//   (dedup: (source_kind, source_id) UNIQUE + ON CONFLICT DO NOTHING).
// - 전표입력 화면 없음: 계정이 확정되지 않는 건만 suspense 계정(가지급금 134/가수금 257)으로
//   차대 균형을 맞춰 pending 전표로 만들고, 회계담당이 확정 큐에서 계정만 지정한다.
// - 확정 시 은행 거래상대 → 계정 학습(journal_party_accounts, card_merchant_links 패턴).
//
// 자동분개 소스 4종:
//   card        승인: (차)비용[분류→계정] (+차)부가세대급금[공제 건] / (대)미지급금 253. 취소·환불은 차대 반전.
//   bank_in     수금 확정: (차)보통예금 / (대)외상매출금. 비수금(reject_reason)은 이자수익·잡이익 등으로,
//               계좌간 이체는 excluded, 미확정 입금은 (대)가수금 pending.
//   bank_out    카드사 출금 = (차)미지급금 상계, 자사 이체 = excluded, 학습 사전 히트 = 해당 계정,
//               그 외 = (차)가지급금 pending.
//   tax_invoice 발행: (차)외상매출금 / (대)용역매출 + 부가세예수금 (작성일 기준. 수정세금계산서 음수는 차대 반전).
//   expense_doc 결재종결 지출결의·출장보고: **개인카드(영수증)·수기 행만** — 법인카드(_cardTxnId) 행은
//               card 분개가 이미 커버하므로 제외(이중 분개 방지). (차)비용 / (대)미지급금(직원경비) 254.

import { createHash } from "node:crypto";
import { getDb, withDbWrite, rowsToObjects, type PgDatabase } from "@/lib/db";
import { loadCategories } from "@/lib/barobill/classify";
import { COMPANY_KO } from "@/lib/letter/types";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

const hashId = (prefix: string, source: string) =>
  `${prefix}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;

// 계정 코드 상수(마이그 178 시드) — 규칙 분개가 참조. 계정 추가·명칭 변경은 DB에서.
export const ACCT = {
  bank: "103", // 보통예금
  receivable: "108", // 외상매출금
  suspenseOut: "134", // 가지급금(미확정 출금)
  vatIn: "135", // 부가세대급금
  cardPayable: "253", // 미지급금(법인카드)
  employeePayable: "258", // 미지급금(직원경비) — 254는 표준 예수금 자리라 예비 코드 사용(세무 실측 반영)
  vatOut: "255", // 부가세예수금
  suspenseIn: "257", // 가수금(미확정 입금)
  sales: "412", // 용역수입(세무 41200 실측)
  interest: "901", // 이자수익
  miscIncome: "930", // 잡이익(세무 93001·93002 실측)
  miscExpense: "848", // 잡비
} as const;

/** 거래상대 정규화 — NFKC + 공백 제거 + 대문자(학습 사전 키). */
export const normalizeParty = (s: string | null | undefined) =>
  (s ?? "").normalize("NFKC").replace(/\s+/g, "").toUpperCase();

const COMPANY_NORM = normalizeParty(COMPANY_KO);
/** 카드사(자사 법인카드 결제 대금) 키워드 — BC(기업은행)·롯데 운용 실측. */
const CARD_COMPANY_RE = /비씨카드|BC카드|롯데카드|롯데카드사|비씨|케이비카드/i;
/** 계좌간 이체 판정 키워드(170 실측: "법인잔고이전"). */
const TRANSFER_RE = /법인잔고이전|잔고이전/;

export interface JournalLineInput {
  accountCode: string;
  debit: number;
  credit: number;
  memo?: string | null;
}

interface EntryDraft {
  sourceKind: string;
  sourceId: string;
  entryDate: string; // YYYY-MM-DD
  description: string;
  partyName: string | null;
  status: "auto" | "pending" | "excluded";
  docId?: string | null;
  lines: JournalLineInput[];
}

const round = (n: number) => Math.round(Number(n) || 0);

// ─────────────────────────────────────────────
// 소스별 분개 초안 생성
// ─────────────────────────────────────────────

/** 카드 매입 → 분개 초안. 불공제 건은 세액을 비용에 합산. 미분류는 가지급금 pending. */
async function draftCardEntries(db: PgDatabase, from: string, to: string): Promise<EntryDraft[]> {
  const categories = await loadCategories();
  const catRows = rowsToObjects(
    await db.exec(`SELECT category_key, account_code FROM expense_categories`),
  );
  const accByKey = new Map(catRows.map((r) => [String(r.category_key), r.account_code ? String(r.account_code) : null]));
  const catInfo = new Map(
    categories.map((c) => [c.categoryKey, { account: accByKey.get(c.categoryKey) ?? null, vatDefault: c.vatDeductibleDefault }]),
  );

  const rows = rowsToObjects(
    await db.exec(
      `SELECT card_txn_id, approval_type, approved_at, amount_total, supply_amount, tax_amount,
              store_name, store_tax_type, category_key, vat_deductible
         FROM card_transactions
        WHERE excluded = 0 AND approval_type <> '거절'
          AND substr(approved_at, 1, 10) BETWEEN $1 AND $2`,
      [from, to],
    ),
  );

  const drafts: EntryDraft[] = [];
  for (const r of rows) {
    // 실측: 취소·환불 건이 카드사에 따라 음수 금액으로 실려 온다 — 절대값으로 통일하고
    // (취소 유형 OR 음수 금액)이면 차대 반전 1회(이중 반전 방지).
    const rawTotal = round(Number(r.amount_total));
    if (!rawTotal) continue;
    const total = Math.abs(rawTotal);
    const tax = Math.abs(round(Number(r.tax_amount ?? 0)));
    const reversed = rawTotal < 0 || ["취소", "부분취소", "환불"].includes(String(r.approval_type));
    const categoryKey = r.category_key ? String(r.category_key) : null;
    const cat = categoryKey ? catInfo.get(categoryKey) : undefined;
    const expenseAccount = cat?.account ?? null;

    // 공제 판정: 저장값 우선 → 간이(2)/면세(4)/비영리(6)/기타(8) 가맹점 불공제 → 분류 기본값(vat.ts 규약)
    const storeTaxType = r.store_tax_type == null ? null : Number(r.store_tax_type);
    const catDefault = cat?.vatDefault ?? null;
    const deductible =
      r.vat_deductible != null
        ? Number(r.vat_deductible) === 1
        : storeTaxType != null && [2, 4, 6, 8].includes(storeTaxType)
          ? false
          : catDefault !== 0;

    const expenseAmount = deductible && tax > 0 ? total - tax : total;
    const vatAmount = deductible && tax > 0 ? tax : 0;

    const lines: JournalLineInput[] = [];
    const store = r.store_name ? String(r.store_name) : null;
    if (expenseAccount) {
      lines.push({ accountCode: expenseAccount, debit: expenseAmount, credit: 0, memo: store });
    } else {
      lines.push({ accountCode: ACCT.suspenseOut, debit: expenseAmount, credit: 0, memo: "분류 미확정" });
    }
    if (vatAmount > 0) lines.push({ accountCode: ACCT.vatIn, debit: vatAmount, credit: 0, memo: null });
    lines.push({ accountCode: ACCT.cardPayable, debit: 0, credit: total, memo: null });

    drafts.push({
      sourceKind: "card",
      sourceId: String(r.card_txn_id),
      entryDate: String(r.approved_at).slice(0, 10),
      description: `법인카드 ${reversed ? String(r.approval_type) : "매입"} — ${store ?? "가맹점 미상"}`,
      partyName: store,
      status: expenseAccount ? "auto" : "pending",
      lines: reversed ? lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) : lines,
    });
  }
  return drafts;
}

/** 계좌 입금 → 분개 초안. 수금 확정=외상매출금, 비수금(reject_reason)=수익 계정, 이체=excluded, 그 외 pending. */
async function draftBankInEntries(db: PgDatabase, from: string, to: string): Promise<EntryDraft[]> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT t.txn_id, t.txn_at, t.amount, t.remitter_name_raw, t.remitter_name_norm, t.trans_type, t.recon_status,
              (SELECT m.reject_reason FROM recon_matches m
                WHERE m.txn_id = t.txn_id AND m.reject_reason IS NOT NULL
                ORDER BY m.created_at DESC LIMIT 1) AS reject_reason
         FROM bank_transactions t
        WHERE t.direction = 'in' AND substr(t.txn_at, 1, 10) BETWEEN $1 AND $2`,
      [from, to],
    ),
  );
  const partyLinks = await loadPartyAccounts(db);

  return rows.flatMap((r): EntryDraft[] => {
    const amount = round(Number(r.amount));
    if (!amount) return [];
    const party = r.remitter_name_raw ? String(r.remitter_name_raw) : null;
    const partyNorm = normalizeParty(party ?? String(r.remitter_name_norm ?? ""));
    const date = String(r.txn_at).slice(0, 10);
    const base = {
      sourceKind: "bank_in",
      sourceId: String(r.txn_id),
      entryDate: date,
      partyName: party,
    };

    // 계좌간 이체(자사명·잔고이전 키워드) → 전표 제외
    if ((partyNorm && COMPANY_NORM && partyNorm.includes(COMPANY_NORM)) || TRANSFER_RE.test(String(r.trans_type ?? "") + (party ?? ""))) {
      return [{ ...base, description: `계좌간 이체 입금 — ${party ?? ""}`, status: "excluded" as const, lines: balanced(ACCT.bank, ACCT.suspenseIn, amount, party) }];
    }
    if (String(r.recon_status) === "confirmed") {
      return [{
        ...base,
        description: `수금 — ${party ?? "입금자 미상"}`,
        status: "auto" as const,
        lines: balanced(ACCT.bank, ACCT.receivable, amount, party),
      }];
    }
    const reason = r.reject_reason ? String(r.reject_reason) : null;
    if (String(r.recon_status) === "ignored" && reason) {
      // 174 reject_reason → 계정 매핑: interest=이자수익, subsidy/tax_refund=잡이익, transfer=제외, mismatch/other=확정 큐
      if (reason === "transfer") {
        return [{ ...base, description: `계좌간 이체 입금 — ${party ?? ""}`, status: "excluded" as const, lines: balanced(ACCT.bank, ACCT.suspenseIn, amount, party) }];
      }
      const account = reason === "interest" ? ACCT.interest : reason === "subsidy" || reason === "tax_refund" ? ACCT.miscIncome : null;
      if (account) {
        return [{
          ...base,
          description: `${reason === "interest" ? "이자" : "기타수입"} — ${party ?? String(r.trans_type ?? "")}`,
          status: "auto" as const,
          lines: balanced(ACCT.bank, account, amount, party),
        }];
      }
    }
    // 학습 사전(비수금 상대 → 계정) 히트
    const learned = partyNorm ? partyLinks.get(partyNorm) : undefined;
    if (learned) {
      return [{ ...base, description: `입금 — ${party ?? ""}`, status: "auto" as const, lines: balanced(ACCT.bank, learned, amount, party) }];
    }
    // 미확정 입금 → 가수금 pending(확정 큐)
    return [{
      ...base,
      description: `미확정 입금 — ${party ?? String(r.trans_type ?? "")}`,
      status: "pending" as const,
      lines: balanced(ACCT.bank, ACCT.suspenseIn, amount, party),
    }];
  });
}

/** 계좌 출금 → 분개 초안. 카드사=미지급금 상계, 자사 이체=excluded, 학습 히트=해당 계정, 그 외 가지급금 pending. */
async function draftBankOutEntries(db: PgDatabase, from: string, to: string): Promise<EntryDraft[]> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT txn_id, txn_at, amount, remitter_name_raw, remitter_name_norm, trans_type
         FROM bank_transactions
        WHERE direction = 'out' AND substr(txn_at, 1, 10) BETWEEN $1 AND $2`,
      [from, to],
    ),
  );
  const partyLinks = await loadPartyAccounts(db);

  return rows.flatMap((r): EntryDraft[] => {
    const amount = round(Number(r.amount));
    if (!amount) return [];
    const party = r.remitter_name_raw ? String(r.remitter_name_raw) : null;
    const partyNorm = normalizeParty(party ?? String(r.remitter_name_norm ?? ""));
    const base = {
      sourceKind: "bank_out",
      sourceId: String(r.txn_id),
      entryDate: String(r.txn_at).slice(0, 10),
      partyName: party,
    };

    if ((partyNorm && COMPANY_NORM && partyNorm.includes(COMPANY_NORM)) || TRANSFER_RE.test(String(r.trans_type ?? "") + (party ?? ""))) {
      return [{ ...base, description: `계좌간 이체 출금 — ${party ?? ""}`, status: "excluded" as const, lines: balanced(ACCT.suspenseOut, ACCT.bank, amount, party) }];
    }
    if (party && CARD_COMPANY_RE.test(party)) {
      // 법인카드 대금 결제 → 카드 매입 분개(미지급금 253)의 상계
      return [{ ...base, description: `카드대금 결제 — ${party}`, status: "auto" as const, lines: balanced(ACCT.cardPayable, ACCT.bank, amount, party) }];
    }
    const learned = partyNorm ? partyLinks.get(partyNorm) : undefined;
    if (learned) {
      return [{ ...base, description: `출금 — ${party ?? ""}`, status: "auto" as const, lines: balanced(learned, ACCT.bank, amount, party) }];
    }
    return [{
      ...base,
      description: `미확정 출금 — ${party ?? String(r.trans_type ?? "")}`,
      status: "pending" as const,
      lines: balanced(ACCT.suspenseOut, ACCT.bank, amount, party),
    }];
  });
}

/** 세금계산서(매출) → 분개 초안. 수정세금계산서 음수는 차대 반전. */
async function draftInvoiceEntries(db: PgDatabase, from: string, to: string): Promise<EntryDraft[]> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT invoice_id, write_date, amount_total, tax_total, total_amount, invoicee_corp_name, modify_code
         FROM tax_invoices
        WHERE canceled_at IS NULL AND direction = 'sales' AND write_date BETWEEN $1 AND $2`,
      [from, to],
    ),
  );
  return rows.flatMap((r) => {
    const supply = round(Number(r.amount_total));
    const tax = round(Number(r.tax_total));
    const total = round(Number(r.total_amount));
    if (!total) return [];
    const negative = total < 0;
    const a = Math.abs; // 음수(환입·취소 수정분)는 절대값 + 차대 반전
    const party = r.invoicee_corp_name ? String(r.invoicee_corp_name) : null;
    const lines: JournalLineInput[] = [
      { accountCode: ACCT.receivable, debit: a(total), credit: 0, memo: party },
      { accountCode: ACCT.sales, debit: 0, credit: a(supply), memo: null },
      ...(a(tax) > 0 ? [{ accountCode: ACCT.vatOut, debit: 0, credit: a(tax), memo: null }] : []),
    ];
    return [{
      sourceKind: "tax_invoice",
      sourceId: String(r.invoice_id),
      entryDate: String(r.write_date).slice(0, 10),
      description: `${r.modify_code ? "수정" : ""}세금계산서 발행 — ${party ?? ""}`,
      partyName: party,
      status: "auto" as const,
      lines: negative ? lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) : lines,
    }];
  });
}

/** 결재종결 지출결의·출장보고 → 분개 초안 (문서 1건 = 전표 1건, 영수증·수기 행만). */
async function draftExpenseDocEntries(db: PgDatabase, from: string, to: string): Promise<EntryDraft[]> {
  const categories = await loadCategories();
  const catRows = rowsToObjects(await db.exec(`SELECT category_key, account_code FROM expense_categories`));
  const accByKey = new Map(catRows.map((r) => [String(r.category_key), r.account_code ? String(r.account_code) : null]));
  // 양식 옵션 문자열/라벨 → category_key 역매핑(classify.syncDocCardLinks 규약)
  const optionToKey = new Map<string, string>();
  for (const cat of categories) {
    for (const option of Object.values(cat.formOptionMap)) optionToKey.set(option, cat.categoryKey);
    optionToKey.set(cat.label, cat.categoryKey);
  }

  const docs = rowsToObjects(
    await db.exec(
      `SELECT doc_id, form_id, doc_no, title, field_values, completed_at
         FROM approval_docs
        WHERE status = 'approved' AND form_id IN ('frm-expense-report', 'frm-biz-trip-report')
          AND substr(completed_at, 1, 10) BETWEEN $1 AND $2`,
      [from, to],
    ),
  );
  if (!docs.length) return [];

  // 영수증 확정 분류(personal_receipts.category_key)가 field_values 보다 우선
  const receiptRows = rowsToObjects(
    await db.exec(
      `SELECT receipt_id, doc_id, category_key, total_amount, store_name FROM personal_receipts WHERE doc_id = ANY($1::text[])`,
      [docs.map((d) => String(d.doc_id))],
    ),
  );
  const receiptsByDoc = new Map<string, Map<string, { categoryKey: string | null; storeName: string | null }>>();
  for (const r of receiptRows) {
    const docId = String(r.doc_id);
    if (!receiptsByDoc.has(docId)) receiptsByDoc.set(docId, new Map());
    receiptsByDoc.get(docId)!.set(String(r.receipt_id), {
      categoryKey: r.category_key ? String(r.category_key) : null,
      storeName: r.store_name ? String(r.store_name) : null,
    });
  }

  const drafts: EntryDraft[] = [];
  for (const doc of docs) {
    const docId = String(doc.doc_id);
    const fv = (doc.field_values ?? {}) as Record<string, unknown>;
    const tableKey = String(doc.form_id) === "frm-expense-report" ? "expenses" : "trip_expenses";
    const rows = Array.isArray(fv[tableKey]) ? (fv[tableKey] as Record<string, unknown>[]) : [];
    const docReceipts = receiptsByDoc.get(docId);

    // 비용 계정별 합산 — 법인카드 행(_cardTxnId)은 card 분개가 커버하므로 제외(이중 방지)
    const byAccount = new Map<string, { amount: number; memos: string[] }>();
    let total = 0;
    let hasUnmapped = false;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      if (typeof row._cardTxnId === "string" && row._cardTxnId) continue;
      const amount = round(Number(String(row.amount ?? "").replace(/[^0-9.-]/g, "")));
      if (!amount) continue;
      const receiptId = typeof row._receiptId === "string" ? row._receiptId : null;
      const receipt = receiptId && docReceipts ? docReceipts.get(receiptId) : undefined;
      const categoryKey =
        receipt?.categoryKey ??
        (typeof row.category === "string" && row.category ? optionToKey.get(row.category) ?? null : null);
      const account = (categoryKey ? accByKey.get(categoryKey) : null) ?? null;
      const key = account ?? ACCT.suspenseOut;
      if (!account) hasUnmapped = true;
      const memo = String(row.vendor ?? receipt?.storeName ?? "").trim();
      const bucket = byAccount.get(key) ?? { amount: 0, memos: [] };
      bucket.amount += amount;
      if (memo && bucket.memos.length < 5 && !bucket.memos.includes(memo)) bucket.memos.push(memo);
      byAccount.set(key, bucket);
      total += amount;
    }
    if (!total) continue; // 전 행이 법인카드(또는 빈 문서) — 전표 없음

    const lines: JournalLineInput[] = [...byAccount.entries()].map(([account, v]) => ({
      accountCode: account,
      debit: v.amount,
      credit: 0,
      memo: v.memos.join(", ") || null,
    }));
    lines.push({ accountCode: ACCT.employeePayable, debit: 0, credit: total, memo: "개인 경비 환급(별도 이체)" });

    drafts.push({
      sourceKind: "expense_doc",
      sourceId: docId,
      entryDate: String(doc.completed_at ?? "").slice(0, 10) || from,
      description: `${String(doc.doc_no ?? "")} ${String(doc.title ?? "")}`.trim() || "지출결의",
      partyName: null,
      status: hasUnmapped ? "pending" : "auto",
      docId,
      lines,
    });
  }
  return drafts;
}

/** 차/대 1:1 균형 라인 헬퍼. */
function balanced(debitAccount: string, creditAccount: string, amount: number, memo: string | null): JournalLineInput[] {
  return [
    { accountCode: debitAccount, debit: amount, credit: 0, memo },
    { accountCode: creditAccount, debit: 0, credit: amount, memo: null },
  ];
}

async function loadPartyAccounts(db: PgDatabase): Promise<Map<string, string>> {
  const rows = rowsToObjects(await db.exec(`SELECT match_norm, account_code FROM journal_party_accounts`));
  return new Map(rows.map((r) => [String(r.match_norm), String(r.account_code)]));
}

// ─────────────────────────────────────────────
// 재생성 배치
// ─────────────────────────────────────────────

export interface RegenerateResult {
  scanned: number;
  created: number;
  kept: number; // confirmed/excluded 보존으로 재생성하지 않은 건
}

/** 기간 내 자동분개 재생성 — auto/pending 삭제 후 소스 4종에서 다시 생성. confirmed/excluded 는 보존. */
export async function regenerateJournal(from: string, to: string): Promise<RegenerateResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw Object.assign(new Error("기간(YYYY-MM-DD)이 올바르지 않습니다."), { status: 400 });
  }
  return withDbWrite(async (db) => {
    const drafts = [
      ...(await draftCardEntries(db, from, to)),
      ...(await draftBankInEntries(db, from, to)),
      ...(await draftBankOutEntries(db, from, to)),
      ...(await draftInvoiceEntries(db, from, to)),
      ...(await draftExpenseDocEntries(db, from, to)),
    ];

    // 사람 판단(confirmed/excluded)은 보존, 기계 생성(auto/pending)만 리셋
    await db.run(
      `DELETE FROM journal_entries
        WHERE entry_date BETWEEN $1 AND $2 AND status IN ('auto', 'pending') AND source_kind <> 'manual'`,
      [from, to],
    );

    const now = KST_NOW();
    let created = 0;
    let kept = 0;
    for (const draft of drafts) {
      const entryId = hashId("je", `${draft.sourceKind}:${draft.sourceId}`);
      const debitSum = draft.lines.reduce((s, l) => s + l.debit, 0);
      const creditSum = draft.lines.reduce((s, l) => s + l.credit, 0);
      if (debitSum !== creditSum) continue; // 차대 불일치 초안은 만들지 않는다(방어)

      const inserted = rowsToObjects(
        await db.exec(
          `INSERT INTO journal_entries
             (entry_id, entry_date, source_kind, source_id, description, party_name, status, doc_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (source_kind, source_id) DO NOTHING
           RETURNING entry_id`,
          [entryId, draft.entryDate, draft.sourceKind, draft.sourceId, draft.description, draft.partyName, draft.status, draft.docId ?? null, now],
        ),
      );
      if (!inserted.length) {
        kept += 1; // confirmed/excluded 보존 건
        continue;
      }
      let lineNo = 0;
      for (const line of draft.lines) {
        lineNo += 1;
        await db.run(
          `INSERT INTO journal_lines (line_id, entry_id, line_no, account_code, debit, credit, memo)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [hashId("jl", `${entryId}:${lineNo}`), entryId, lineNo, line.accountCode, line.debit, line.credit, line.memo ?? null],
        );
      }
      created += 1;
    }
    return { scanned: drafts.length, created, kept };
  });
}

// ─────────────────────────────────────────────
// 확정 큐 액션
// ─────────────────────────────────────────────

/** 확정 — 라인 교체(계정 지정) + 상태 확정 + 거래상대 학습(bank 소스만). */
export async function confirmEntry(
  entryId: string,
  lines: JournalLineInput[],
  actorUserId: string,
): Promise<void> {
  if (!lines.length) throw Object.assign(new Error("분개 라인이 필요합니다."), { status: 400 });
  const debitSum = lines.reduce((s, l) => s + round(l.debit), 0);
  const creditSum = lines.reduce((s, l) => s + round(l.credit), 0);
  if (debitSum !== creditSum || debitSum <= 0) {
    throw Object.assign(new Error(`차변(${debitSum.toLocaleString()})과 대변(${creditSum.toLocaleString()})이 일치해야 합니다.`), { status: 400 });
  }
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(await db.exec(`SELECT source_kind, party_name FROM journal_entries WHERE entry_id = $1`, [entryId]));
    if (!rows.length) throw Object.assign(new Error("전표를 찾을 수 없습니다."), { status: 404 });
    const valid = rowsToObjects(
      await db.exec(`SELECT account_code FROM journal_accounts WHERE account_code = ANY($1::text[])`, [lines.map((l) => l.accountCode)]),
    );
    if (valid.length !== new Set(lines.map((l) => l.accountCode)).size) {
      throw Object.assign(new Error("존재하지 않는 계정과목이 있습니다."), { status: 400 });
    }
    const now = KST_NOW();
    await db.run(`DELETE FROM journal_lines WHERE entry_id = $1`, [entryId]);
    let lineNo = 0;
    for (const line of lines) {
      lineNo += 1;
      await db.run(
        `INSERT INTO journal_lines (line_id, entry_id, line_no, account_code, debit, credit, memo)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [hashId("jl", `${entryId}:${lineNo}:${now}`), entryId, lineNo, line.accountCode, round(line.debit), round(line.credit), line.memo ?? null],
      );
    }
    await db.run(
      `UPDATE journal_entries SET status = 'confirmed', confirmed_by = $2, confirmed_at = $3, updated_at = $3 WHERE entry_id = $1`,
      [entryId, actorUserId, now],
    );

    // 거래상대 학습(은행 소스만) — 보통예금이 아닌 상대 계정을 사전에 기록 → 다음부터 auto
    const sourceKind = String(rows[0].source_kind);
    const partyNorm = normalizeParty(rows[0].party_name ? String(rows[0].party_name) : null);
    if ((sourceKind === "bank_in" || sourceKind === "bank_out") && partyNorm) {
      const counter = lines.find((l) => l.accountCode !== ACCT.bank);
      if (counter && counter.accountCode !== ACCT.suspenseIn && counter.accountCode !== ACCT.suspenseOut) {
        await db.run(
          `INSERT INTO journal_party_accounts (match_norm, account_code, label_snapshot, confirm_count, last_confirmed_at, created_at)
           VALUES ($1, $2, $3, 1, $4, $4)
           ON CONFLICT (match_norm) DO UPDATE SET
             account_code = EXCLUDED.account_code,
             label_snapshot = EXCLUDED.label_snapshot,
             confirm_count = journal_party_accounts.confirm_count + 1,
             last_confirmed_at = EXCLUDED.last_confirmed_at`,
          [partyNorm, counter.accountCode, rows[0].party_name ? String(rows[0].party_name) : null, KST_NOW()],
        );
      }
    }
  });
}

/** 전표 제외(경비 아님·이중 등) / 확정 취소 — 되돌리면 다음 재생성에서 auto 규칙으로 재계산된다. */
export async function setEntryStatus(entryId: string, status: "excluded" | "pending", actorUserId: string): Promise<void> {
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(await db.exec(`SELECT 1 AS x FROM journal_entries WHERE entry_id = $1`, [entryId]));
    if (!rows.length) throw Object.assign(new Error("전표를 찾을 수 없습니다."), { status: 404 });
    await db.run(
      `UPDATE journal_entries SET status = $2, confirmed_by = CASE WHEN $2 = 'excluded' THEN $3 ELSE NULL END,
              confirmed_at = CASE WHEN $2 = 'excluded' THEN $4 ELSE NULL END, updated_at = $4
        WHERE entry_id = $1`,
      [entryId, status, actorUserId, KST_NOW()],
    );
  });
}

// ─────────────────────────────────────────────
// 조회 — 분개장 / 계정별원장 / 합계잔액시산표
// ─────────────────────────────────────────────

export interface JournalAccount {
  accountCode: string;
  name: string;
  acctType: string;
}

export async function listAccounts(): Promise<JournalAccount[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT account_code, name, acct_type FROM journal_accounts WHERE is_active = 1 ORDER BY sort_order`),
  );
  return rows.map((r) => ({ accountCode: String(r.account_code), name: String(r.name), acctType: String(r.acct_type) }));
}

export interface JournalEntryRow {
  entryId: string;
  entryDate: string;
  sourceKind: string;
  description: string | null;
  partyName: string | null;
  status: string;
  docId: string | null;
  total: number;
  lines: Array<{ accountCode: string; accountName: string; debit: number; credit: number; memo: string | null }>;
}

export async function listJournal(params: {
  from: string;
  to: string;
  status?: string;
  /** 소스 구분 필터: bank(입출금 전체) / card / tax_invoice / expense_doc */
  sourceKind?: string;
  /** 계좌별 필터(bank_transactions.account_id — 원장 역조회, 스키마 무변경) */
  accountId?: string;
  /** 카드별 필터(card_transactions.card_id) */
  cardId?: string;
  /** 카드사별 필터(card_registry.card_company — 산하 카드 전체) */
  cardCompany?: string;
  limit?: number;
}): Promise<JournalEntryRow[]> {
  const db = await getDb();
  const conds = ["e.entry_date BETWEEN $1 AND $2"];
  const sqlParams: unknown[] = [params.from, params.to];
  if (params.status) {
    sqlParams.push(params.status);
    conds.push(`e.status = $${sqlParams.length}`);
  }
  if (params.accountId) {
    sqlParams.push(params.accountId);
    conds.push(
      `e.source_kind IN ('bank_in','bank_out') AND EXISTS (
         SELECT 1 FROM bank_transactions bt WHERE bt.txn_id = e.source_id AND bt.account_id = $${sqlParams.length})`,
    );
  } else if (params.cardId) {
    sqlParams.push(params.cardId);
    conds.push(
      `e.source_kind = 'card' AND EXISTS (
         SELECT 1 FROM card_transactions ct WHERE ct.card_txn_id = e.source_id AND ct.card_id = $${sqlParams.length})`,
    );
  } else if (params.cardCompany) {
    sqlParams.push(params.cardCompany);
    conds.push(
      `e.source_kind = 'card' AND EXISTS (
         SELECT 1 FROM card_transactions ct JOIN card_registry cr ON cr.card_id = ct.card_id
          WHERE ct.card_txn_id = e.source_id AND cr.card_company = $${sqlParams.length})`,
    );
  } else if (params.sourceKind === "bank") {
    conds.push(`e.source_kind IN ('bank_in','bank_out')`);
  } else if (params.sourceKind) {
    sqlParams.push(params.sourceKind);
    conds.push(`e.source_kind = $${sqlParams.length}`);
  }
  const limit = Math.min(Math.max(Number(params.limit ?? 300) || 300, 1), 1000);
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.entry_id, e.entry_date, e.source_kind, e.description, e.party_name, e.status, e.doc_id,
              l.line_no, l.account_code, a.name AS account_name, l.debit, l.credit, l.memo
         FROM journal_entries e
         JOIN journal_lines l ON l.entry_id = e.entry_id
         LEFT JOIN journal_accounts a ON a.account_code = l.account_code
        WHERE ${conds.join(" AND ")}
        ORDER BY e.entry_date DESC, e.entry_id, l.line_no
        LIMIT ${limit * 6}`,
      sqlParams,
    ),
  );
  const map = new Map<string, JournalEntryRow>();
  for (const r of rows) {
    const id = String(r.entry_id);
    if (!map.has(id)) {
      if (map.size >= limit) break;
      map.set(id, {
        entryId: id,
        entryDate: String(r.entry_date),
        sourceKind: String(r.source_kind),
        description: r.description ? String(r.description) : null,
        partyName: r.party_name ? String(r.party_name) : null,
        status: String(r.status),
        docId: r.doc_id ? String(r.doc_id) : null,
        total: 0,
        lines: [],
      });
    }
    const entry = map.get(id)!;
    const debit = Number(r.debit ?? 0);
    entry.total += debit;
    entry.lines.push({
      accountCode: String(r.account_code),
      accountName: r.account_name ? String(r.account_name) : String(r.account_code),
      debit,
      credit: Number(r.credit ?? 0),
      memo: r.memo ? String(r.memo) : null,
    });
  }
  return [...map.values()];
}

export interface LedgerRow {
  entryDate: string;
  description: string | null;
  partyName: string | null;
  debit: number;
  credit: number;
  balance: number;
}

/** 계정별원장 — 기간 발생분 누적 잔액(자산·비용=차변 증가, 그 외=대변 증가). */
export async function accountLedger(params: { accountCode: string; from: string; to: string }): Promise<{
  account: JournalAccount | null;
  rows: LedgerRow[];
  totalDebit: number;
  totalCredit: number;
}> {
  const db = await getDb();
  const accountRows = rowsToObjects(
    await db.exec(`SELECT account_code, name, acct_type FROM journal_accounts WHERE account_code = $1`, [params.accountCode]),
  );
  const account = accountRows.length
    ? { accountCode: String(accountRows[0].account_code), name: String(accountRows[0].name), acctType: String(accountRows[0].acct_type) }
    : null;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.entry_date, e.description, e.party_name, l.debit, l.credit
         FROM journal_lines l
         JOIN journal_entries e ON e.entry_id = l.entry_id
        WHERE l.account_code = $1 AND e.entry_date BETWEEN $2 AND $3
          AND e.status IN ('auto', 'confirmed')
        ORDER BY e.entry_date, e.entry_id, l.line_no`,
      [params.accountCode, params.from, params.to],
    ),
  );
  const debitNormal = account ? ["asset", "expense"].includes(account.acctType) : true;
  let balance = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const out: LedgerRow[] = rows.map((r) => {
    const debit = Number(r.debit ?? 0);
    const credit = Number(r.credit ?? 0);
    totalDebit += debit;
    totalCredit += credit;
    balance += debitNormal ? debit - credit : credit - debit;
    return {
      entryDate: String(r.entry_date),
      description: r.description ? String(r.description) : null,
      partyName: r.party_name ? String(r.party_name) : null,
      debit,
      credit,
      balance,
    };
  });
  return { account, rows: out, totalDebit, totalCredit };
}

export interface TrialBalanceRow {
  accountCode: string;
  name: string;
  acctType: string;
  debit: number;
  credit: number;
}

/** 합계잔액시산표(기간 발생액) — auto+confirmed 만 집계(pending/excluded 제외). */
export async function trialBalance(params: { from: string; to: string }): Promise<{
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  pendingCount: number;
}> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT a.account_code, a.name, a.acct_type, a.sort_order,
              COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
         FROM journal_accounts a
         JOIN journal_lines l ON l.account_code = a.account_code
         JOIN journal_entries e ON e.entry_id = l.entry_id
        WHERE e.entry_date BETWEEN $1 AND $2 AND e.status IN ('auto', 'confirmed')
        GROUP BY a.account_code, a.name, a.acct_type, a.sort_order
       HAVING COALESCE(SUM(l.debit), 0) <> 0 OR COALESCE(SUM(l.credit), 0) <> 0
        ORDER BY a.sort_order`,
      [params.from, params.to],
    ),
  );
  const pending = rowsToObjects(
    await db.exec(
      `SELECT COUNT(*) AS n FROM journal_entries WHERE entry_date BETWEEN $1 AND $2 AND status = 'pending'`,
      [params.from, params.to],
    ),
  );
  let totalDebit = 0;
  let totalCredit = 0;
  const out: TrialBalanceRow[] = rows.map((r) => {
    const debit = Number(r.debit ?? 0);
    const credit = Number(r.credit ?? 0);
    totalDebit += debit;
    totalCredit += credit;
    return { accountCode: String(r.account_code), name: String(r.name), acctType: String(r.acct_type), debit, credit };
  });
  return { rows: out, totalDebit, totalCredit, pendingCount: Number(pending[0]?.n ?? 0) };
}
