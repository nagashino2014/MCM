// 재무(바로빌) 화면용 조회 계층 — 연결 목록 / 원장 / 수집 로그 (P0 최소)

import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";
import { BANK_NAME_TO_CODE } from "@/lib/barobill/bank";

// 저장분이 한글 은행명일 수 있어(마이그 172 이전 적재) 코드 형식이 아니면 이름으로 역매핑한다.
const normalizeBankCode = (code: string, name: string) =>
  /^[A-Z]+$/.test(code) ? code : BANK_NAME_TO_CODE[name] ?? BANK_NAME_TO_CODE[code] ?? "";

export interface FinanceConnectionRow {
  id: string;
  kind: "bank" | "card";
  label: string; // 은행명 / 카드사명
  code: string; // 바로빌 은행/카드사 코드(KB·IBK·BC·LOTTE…) — 로고 매핑 키
  numberMasked: string;
  alias: string | null;
  holderEmployeeId: string | null;
  collectCycle: string;
  barobillStatus: string; // active / stopped
  isActive: boolean;
  lastSyncedAt: string | null;
  txnCount: number;
  firstTxnAt: string | null; // 적재 데이터 범위 표시용(사용자 요청)
  lastTxnAt: string | null;
}

const maskAccountNo = (no: string) => (no.length <= 6 ? no : `${no.slice(0, 3)}****${no.slice(-4)}`);
const maskCardNum = (no: string) => (no.length <= 8 ? no : `${no.slice(0, 4)}-****-****-${no.slice(-4)}`);

export async function listConnections(): Promise<FinanceConnectionRow[]> {
  const db = await getDb();
  const accounts = rowsToObjects(
    await db.exec(
      `SELECT a.account_id, a.bank_name, a.bank_code, a.account_no, a.account_alias, a.collect_cycle,
              a.barobill_status, a.is_active, a.last_synced_at,
              count(t.txn_id) AS txn_count, min(t.txn_at) AS first_txn_at, max(t.txn_at) AS last_txn_at
         FROM bank_accounts a
         LEFT JOIN bank_transactions t ON t.account_id = a.account_id
        GROUP BY a.account_id
        ORDER BY a.created_at`,
    ),
  );
  const cards = rowsToObjects(
    await db.exec(
      `SELECT c.card_id, c.card_company_name, c.card_company, c.card_num, c.card_alias, c.holder_employee_id,
              c.collect_cycle, c.barobill_status, c.is_active, c.last_synced_at,
              count(t.card_txn_id) AS txn_count, min(t.approved_at) AS first_txn_at, max(t.approved_at) AS last_txn_at
         FROM card_registry c
         LEFT JOIN card_transactions t ON t.card_id = c.card_id
        GROUP BY c.card_id
        ORDER BY c.created_at`,
    ),
  );
  return [
    ...accounts.map((r): FinanceConnectionRow => ({
      id: String(r.account_id),
      kind: "bank",
      label: String(r.bank_name || r.bank_code || ""),
      code: normalizeBankCode(String(r.bank_code || ""), String(r.bank_name || "")),
      numberMasked: maskAccountNo(String(r.account_no || "")),
      alias: (r.account_alias as string | null) ?? null,
      holderEmployeeId: null,
      collectCycle: String(r.collect_cycle || "DAY1"),
      barobillStatus: String(r.barobill_status || "active"),
      isActive: Boolean(r.is_active),
      lastSyncedAt: (r.last_synced_at as string | null) ?? null,
      txnCount: Number(r.txn_count || 0),
      firstTxnAt: (r.first_txn_at as string | null) ?? null,
      lastTxnAt: (r.last_txn_at as string | null) ?? null,
    })),
    ...cards.map((r): FinanceConnectionRow => ({
      id: String(r.card_id),
      kind: "card",
      label: String(r.card_company_name || r.card_company || ""),
      code: String(r.card_company || ""),
      numberMasked: maskCardNum(String(r.card_num || "")),
      alias: (r.card_alias as string | null) ?? null,
      holderEmployeeId: (r.holder_employee_id as string | null) ?? null,
      collectCycle: String(r.collect_cycle || "DAY1"),
      barobillStatus: String(r.barobill_status || "active"),
      isActive: Boolean(r.is_active),
      lastSyncedAt: (r.last_synced_at as string | null) ?? null,
      txnCount: Number(r.txn_count || 0),
      firstTxnAt: (r.first_txn_at as string | null) ?? null,
      lastTxnAt: (r.last_txn_at as string | null) ?? null,
    })),
  ];
}

// 라우트에서 액션 실행 전 원문 번호가 필요 (마스킹 없이 — 서버 내부 전용)
export async function getConnectionSecretNo(kind: "bank" | "card", id: string): Promise<string | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    kind === "bank"
      ? await db.exec(`SELECT account_no AS no FROM bank_accounts WHERE account_id = $1`, [id])
      : await db.exec(`SELECT card_num AS no FROM card_registry WHERE card_id = $1`, [id]),
  );
  return rows.length ? String(rows[0].no) : null;
}

export async function updateCardMeta(
  cardId: string,
  meta: { alias?: string | null; holderEmployeeId?: string | null; isActive?: boolean },
): Promise<void> {
  await withDbWrite(async (db) => {
    const sets: string[] = [];
    const params: unknown[] = [cardId];
    if (meta.alias !== undefined) {
      params.push(meta.alias);
      sets.push(`card_alias = $${params.length}`);
    }
    if (meta.holderEmployeeId !== undefined) {
      params.push(meta.holderEmployeeId);
      sets.push(`holder_employee_id = $${params.length}`);
    }
    if (meta.isActive !== undefined) {
      params.push(meta.isActive ? 1 : 0);
      sets.push(`is_active = $${params.length}`);
    }
    if (!sets.length) return;
    params.push(new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " "));
    sets.push(`updated_at = $${params.length}`);
    await db.run(`UPDATE card_registry SET ${sets.join(", ")} WHERE card_id = $1`, params);
  });
}

export interface BankTxnRow {
  txnId: string;
  accountLabel: string;
  txnAt: string;
  direction: string;
  amount: number;
  balanceAfter: number | null;
  remitterRaw: string | null;
  transType: string | null;
  remark2: string | null;
  reconStatus: string;
}

export async function listBankTransactions(params: {
  accountId?: string;
  accountIds?: string[]; // 등록 계좌 태그 다중 선택(빈 배열 = 전체)
  direction?: "in" | "out";
  from?: string; // YYYY-MM-DD
  to?: string;
  keyword?: string; // 거래상대·메모 부분일치
  amountMin?: number;
  amountMax?: number;
  limit?: number;
  offset?: number;
}): Promise<{ rows: BankTxnRow[]; total: number; totals: { deposit: number; withdraw: number } }> {
  const db = await getDb();
  const where: string[] = [];
  const args: unknown[] = [];
  if (params.accountId) {
    args.push(params.accountId);
    where.push(`t.account_id = $${args.length}`);
  }
  if (params.accountIds?.length) {
    args.push(params.accountIds);
    where.push(`t.account_id = ANY($${args.length}::text[])`);
  }
  if (params.direction) {
    args.push(params.direction);
    where.push(`t.direction = $${args.length}`);
  }
  if (params.from) {
    args.push(`${params.from} 00:00:00`);
    where.push(`t.txn_at >= $${args.length}`);
  }
  if (params.to) {
    args.push(`${params.to} 23:59:59`);
    where.push(`t.txn_at <= $${args.length}`);
  }
  if (params.keyword) {
    args.push(`%${params.keyword.trim()}%`);
    where.push(`(t.remitter_name_raw ILIKE $${args.length} OR t.remark2 ILIKE $${args.length} OR t.trans_type ILIKE $${args.length})`);
  }
  if (params.amountMin != null) {
    args.push(params.amountMin);
    where.push(`t.amount >= $${args.length}`);
  }
  if (params.amountMax != null) {
    args.push(params.amountMax);
    where.push(`t.amount <= $${args.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRows = rowsToObjects(await db.exec(`SELECT count(*) AS n FROM bank_transactions t ${whereSql}`, args));
  // 입금·출금 총계 — direction 칩과 무관하게 기간·키워드·금액대 필터 기준으로 집계(사용자 요청).
  // where/args 를 재사용하면 $N 번호가 어긋나므로 direction 을 뺀 조건을 새로 조립한다.
  const sumWhere: string[] = [];
  const sumArgs: unknown[] = [];
  if (params.accountId) {
    sumArgs.push(params.accountId);
    sumWhere.push(`t.account_id = $${sumArgs.length}`);
  }
  if (params.accountIds?.length) {
    sumArgs.push(params.accountIds);
    sumWhere.push(`t.account_id = ANY($${sumArgs.length}::text[])`);
  }
  if (params.from) {
    sumArgs.push(`${params.from} 00:00:00`);
    sumWhere.push(`t.txn_at >= $${sumArgs.length}`);
  }
  if (params.to) {
    sumArgs.push(`${params.to} 23:59:59`);
    sumWhere.push(`t.txn_at <= $${sumArgs.length}`);
  }
  if (params.keyword) {
    sumArgs.push(`%${params.keyword.trim()}%`);
    sumWhere.push(`(t.remitter_name_raw ILIKE $${sumArgs.length} OR t.remark2 ILIKE $${sumArgs.length} OR t.trans_type ILIKE $${sumArgs.length})`);
  }
  if (params.amountMin != null) {
    sumArgs.push(params.amountMin);
    sumWhere.push(`t.amount >= $${sumArgs.length}`);
  }
  if (params.amountMax != null) {
    sumArgs.push(params.amountMax);
    sumWhere.push(`t.amount <= $${sumArgs.length}`);
  }
  const sumRows = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(SUM(CASE WHEN t.direction = 'in' THEN t.amount END), 0) AS total_in,
              COALESCE(SUM(CASE WHEN t.direction = 'out' THEN t.amount END), 0) AS total_out
         FROM bank_transactions t
        ${sumWhere.length ? `WHERE ${sumWhere.join(" AND ")}` : ""}`,
      sumArgs,
    ),
  );
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT t.txn_id, a.bank_name, a.account_alias, t.txn_at, t.direction, t.amount, t.balance_after,
              t.remitter_name_raw, t.trans_type, t.remark2, t.recon_status
         FROM bank_transactions t JOIN bank_accounts a ON a.account_id = t.account_id
        ${whereSql}
        ORDER BY t.txn_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      args,
    ),
  );
  return {
    totals: {
      deposit: Number(sumRows[0]?.total_in || 0),
      withdraw: Number(sumRows[0]?.total_out || 0),
    },
    total: Number(totalRows[0]?.n || 0),
    rows: rows.map((r) => ({
      txnId: String(r.txn_id),
      accountLabel: String(r.account_alias || r.bank_name || ""),
      txnAt: String(r.txn_at),
      direction: String(r.direction),
      amount: Number(r.amount || 0),
      balanceAfter: r.balance_after == null ? null : Number(r.balance_after),
      remitterRaw: (r.remitter_name_raw as string | null) ?? null,
      transType: (r.trans_type as string | null) ?? null,
      remark2: (r.remark2 as string | null) ?? null,
      reconStatus: String(r.recon_status || "unprocessed"),
    })),
  };
}

export interface CardTxnRow {
  cardTxnId: string;
  cardLabel: string;
  approvedAt: string;
  approvalType: string;
  amountTotal: number;
  supplyAmount: number | null;
  taxAmount: number | null;
  storeName: string | null;
  storeBizType: string | null;
  storeCorpNum: string | null;
  isPurchased: boolean;
  categoryKey: string | null;
  categorySource: string | null;
  vatDeductible: number | null;
  excluded: boolean;
  docId: string | null;
}

export async function listCardTransactions(params: {
  cardId?: string;
  cardIds?: string[]; // 등록 카드/카드사 태그 다중 선택(빈 배열 = 전체)
  from?: string;
  to?: string;
  keyword?: string; // 상호·업태 부분일치
  amountMin?: number;
  amountMax?: number;
  unusedOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ rows: CardTxnRow[]; total: number; totals: { count: number; amountTotal: number; supplyAmount: number; taxAmount: number } }> {
  const db = await getDb();
  const where: string[] = [];
  const args: unknown[] = [];
  if (params.cardId) {
    args.push(params.cardId);
    where.push(`t.card_id = $${args.length}`);
  }
  if (params.cardIds?.length) {
    args.push(params.cardIds);
    where.push(`t.card_id = ANY($${args.length}::text[])`);
  }
  if (params.from) {
    args.push(`${params.from} 00:00:00`);
    where.push(`t.approved_at >= $${args.length}`);
  }
  if (params.to) {
    args.push(`${params.to} 23:59:59`);
    where.push(`t.approved_at <= $${args.length}`);
  }
  if (params.keyword) {
    args.push(`%${params.keyword.trim()}%`);
    where.push(`(t.store_name ILIKE $${args.length} OR t.store_biz_type ILIKE $${args.length})`);
  }
  if (params.amountMin != null) {
    args.push(params.amountMin);
    where.push(`t.amount_total >= $${args.length}`);
  }
  if (params.amountMax != null) {
    args.push(params.amountMax);
    where.push(`t.amount_total <= $${args.length}`);
  }
  if (params.unusedOnly) {
    where.push(`t.doc_id IS NULL AND t.excluded = 0 AND t.approval_type = '승인'`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRows = rowsToObjects(await db.exec(`SELECT count(*) AS n FROM card_transactions t ${whereSql}`, args));
  // 상단 요약 — 취소·환불 건은 금액을 왜곡하므로 승인 건만 합산(부가세 집계와 동일 기준)
  const sumRows = rowsToObjects(
    await db.exec(
      `SELECT count(*) AS n,
              COALESCE(SUM(t.amount_total), 0) AS amount_total,
              COALESCE(SUM(t.supply_amount), 0) AS supply_amount,
              COALESCE(SUM(t.tax_amount), 0) AS tax_amount
         FROM card_transactions t
        ${whereSql ? `${whereSql} AND` : "WHERE"} t.approval_type = '승인'`,
      args,
    ),
  );
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT t.card_txn_id, c.card_alias, c.card_company_name, t.approved_at, t.approval_type,
              t.amount_total, t.supply_amount, t.tax_amount, t.store_name, t.store_biz_type, t.store_corp_num,
              t.is_purchased, t.category_key, t.category_source, t.vat_deductible, t.excluded, t.doc_id
         FROM card_transactions t JOIN card_registry c ON c.card_id = t.card_id
        ${whereSql}
        ORDER BY t.approved_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      args,
    ),
  );
  return {
    total: Number(totalRows[0]?.n || 0),
    totals: {
      count: Number(sumRows[0]?.n || 0),
      amountTotal: Number(sumRows[0]?.amount_total || 0),
      supplyAmount: Number(sumRows[0]?.supply_amount || 0),
      taxAmount: Number(sumRows[0]?.tax_amount || 0),
    },
    rows: rows.map((r) => ({
      cardTxnId: String(r.card_txn_id),
      cardLabel: String(r.card_alias || r.card_company_name || ""),
      approvedAt: String(r.approved_at),
      approvalType: String(r.approval_type),
      amountTotal: Number(r.amount_total || 0),
      supplyAmount: r.supply_amount == null ? null : Number(r.supply_amount),
      taxAmount: r.tax_amount == null ? null : Number(r.tax_amount),
      storeName: (r.store_name as string | null) ?? null,
      storeBizType: (r.store_biz_type as string | null) ?? null,
      storeCorpNum: (r.store_corp_num as string | null) ?? null,
      isPurchased: Boolean(r.is_purchased),
      categoryKey: (r.category_key as string | null) ?? null,
      categorySource: (r.category_source as string | null) ?? null,
      vatDeductible: r.vat_deductible == null ? null : Number(r.vat_deductible),
      excluded: Boolean(r.excluded),
      docId: (r.doc_id as string | null) ?? null,
    })),
  };
}

export interface SyncLogRow {
  syncId: string;
  kind: string;
  targetId: string | null;
  status: string;
  fetched: number;
  inserted: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export async function listSyncLogs(limit = 20): Promise<SyncLogRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT sync_id, kind, target_id, status, fetched, inserted, error, started_at, finished_at
         FROM finance_sync_logs ORDER BY started_at DESC LIMIT ${Math.min(limit, 100)}`,
    ),
  );
  return rows.map((r) => ({
    syncId: String(r.sync_id),
    kind: String(r.kind),
    targetId: (r.target_id as string | null) ?? null,
    status: String(r.status),
    fetched: Number(r.fetched || 0),
    inserted: Number(r.inserted || 0),
    error: (r.error as string | null) ?? null,
    startedAt: String(r.started_at),
    finishedAt: (r.finished_at as string | null) ?? null,
  }));
}
