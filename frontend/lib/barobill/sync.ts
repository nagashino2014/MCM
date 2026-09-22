import { lockAccountingWrite } from "@/lib/finance/write-lock";
import { normalizeCardTransaction } from "@/lib/finance/card-tax";
import { canonicalCardNumber, normalizeCardRegistryLists } from "@/lib/barobill/card-number";
// 바로빌 수집 배치 — 등록 목록 동기화 + 계좌/카드 원장 증분 적재 (블루프린트 P0 §2)
// 실행 경로: ① 재무 화면 로드 시 stale 체크 후 자동(catch-up — next가 야간 정지라 새벽 스케줄 불가)
//           ② /api/finance/sync POST 수동 ③ (선택) EventBridge Scheduler
// 원장 불변 원칙: dedup_key ON CONFLICT DO NOTHING. 카드만 매입확정/취소 상태 갱신(DO UPDATE 최소 필드).

import { createHash } from "node:crypto";
import { getDb, withDbWrite, rowsToObjects, type PgDatabase } from "@/lib/db";
import { normalizeCompanyName } from "@/lib/ieps/formatters";
import { getBankAccounts, fetchBankTransLogs } from "@/lib/barobill/bank";
import { getCards, fetchCardPurchases, type BarobillCardPurchase } from "@/lib/barobill/card";

const KST_NOW = () => {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  return now.toISOString().slice(0, 19).replace("T", " ");
};

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

const hashId = (prefix: string, source: string) =>
  `${prefix}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;

// 입금자명 정규화 — 실측: 전각문자 혼입("（주）영흥산업환경") → NFKC 선행 후 기존 상호 정규화 재사용
/**
 * 원장 중복 방지 키 — 바로빌 TransRefKey/HistoryKey 는 "거래일시 + 바로빌 내부 시퀀스"라
 * 재수집할 때마다 값이 바뀐다(2026-08-18 실측: 같은 거래가 08-15 ...0022960011 / 08-17 ...0022964061).
 * 그 값을 키로 쓰면 기간을 바꿔 재수집할 때 전량 신규로 적재되므로, 거래 자체의 자연키를 쓴다.
 * 계좌는 잔액까지 넣는다 — 같은 시각·같은 금액이 실제로 두 건이면 잔액이 달라지기 때문이다(마이그 189).
 */
export function bankDedupKey(
  accountNo: string,
  txnAt: string,
  direction: string,
  amount: number,
  balanceAfter: number | null,
): string {
  const bal = balanceAfter == null ? "x" : String(Math.round(balanceAfter));
  return `nk:${accountNo}:${txnAt}:${direction}:${Math.round(amount)}:${bal}`;
}

export function cardDedupKey(cardNum: string, approvalNum: string | null, approvedAt: string, amountTotal: number): string {
  return `nk:${canonicalCardNumber(cardNum)}:${approvalNum ?? ""}:${approvedAt}:${Math.round(amountTotal)}`;
}

export function normalizeRemitter(raw: string): string {
  const nfkc = (raw || "").normalize("NFKC").trim();
  return normalizeCompanyName(nfkc) ?? "";
}

// ── 등록 목록 동기화 (바로빌 = 진실원본, 앱 테이블 = 캐시 + 메타) ──
export async function syncRegistry(): Promise<{ accounts: number; cards: number }> {
  const [accounts, providerCards] = await Promise.all([getBankAccounts(0), getCards(0)]);
  const activeAccounts = new Set((await getBankAccounts(1)).map((a) => a.accountNum));
  const { all: cards, activeNumbers: activeCards } = normalizeCardRegistryLists(providerCards, await getCards(1));

  await withDbWrite(async (db) => {
    for (const a of accounts) {
      await db.run(
        `INSERT INTO bank_accounts (account_id, bank_code, bank_name, account_no, account_alias, collect_cycle, barobill_status, created_at)
         VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8)
         ON CONFLICT (account_no) DO UPDATE SET
           bank_code = EXCLUDED.bank_code, bank_name = EXCLUDED.bank_name,
           collect_cycle = EXCLUDED.collect_cycle, barobill_status = EXCLUDED.barobill_status,
           updated_at = $8`,
        [
          hashId("ba", a.accountNum),
          a.bankCode || a.bankName,
          a.bankName,
          a.accountNum,
          a.alias,
          a.collectCycle || "DAY1",
          activeAccounts.has(a.accountNum) ? "active" : "stopped",
          KST_NOW(),
        ],
      );
    }
    for (const c of cards) {
      await db.run(
        `INSERT INTO card_registry (card_id, card_company, card_company_name, card_num, card_alias, card_type, collect_target, collect_cycle, barobill_status, created_at)
         VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8, $9, $10)
         ON CONFLICT (card_num) DO UPDATE SET
           card_company = EXCLUDED.card_company, card_company_name = EXCLUDED.card_company_name,
           collect_cycle = EXCLUDED.collect_cycle, barobill_status = EXCLUDED.barobill_status,
           updated_at = $10`,
        [
          hashId("cd", c.cardNum),
          c.cardCompanyCode || c.cardCompanyName,
          c.cardCompanyName,
          c.cardNum,
          c.alias,
          c.cardType || "C",
          c.collectTarget || "PURCHASE",
          c.collectCycle || "DAY1",
          activeCards.has(c.cardNum) ? "active" : "stopped",
          KST_NOW(),
        ],
      );
    }

    // 바로빌 목록에 없는 연결은 'unlinked' 로 표시하고 수집에서 뺀다(운영 전환·해지 후 잔존분).
    // 삭제하지 않는 이유: 원장·분류·학습이 CASCADE 로 함께 사라진다. 같은 번호로 다시 등록하면
    // account_no/card_num UNIQUE 로 이 행이 그대로 재사용되어 이력이 이어진다.
    const accountNos = accounts.map((a) => a.accountNum);
    const cardNums = cards.map((c) => c.cardNum);
    await db.run(
      accountNos.length
        ? `UPDATE bank_accounts SET barobill_status = 'unlinked', updated_at = $2 WHERE NOT (account_no = ANY($1::text[])) AND barobill_status <> 'unlinked'`
        : `UPDATE bank_accounts SET barobill_status = 'unlinked', updated_at = $2 WHERE barobill_status <> 'unlinked'`,
      accountNos.length ? [accountNos, KST_NOW()] : [KST_NOW()],
    );
    await db.run(
      cardNums.length
        ? `UPDATE card_registry SET barobill_status = 'unlinked', updated_at = $2 WHERE NOT (card_num = ANY($1::text[])) AND barobill_status <> 'unlinked'`
        : `UPDATE card_registry SET barobill_status = 'unlinked', updated_at = $2 WHERE barobill_status <> 'unlinked'`,
      cardNums.length ? [cardNums, KST_NOW()] : [KST_NOW()],
    );
  });
  return { accounts: accounts.length, cards: cards.length };
}

// ── 수집 범위 산출: 마지막 적재분 - 오버랩 ~ 오늘 (초회는 소급 실측 반영 90일) ──
const OVERLAP_DAYS = { bank: 3, card: 7 } as const; // 카드는 승인→매입 지연(2~5일) 고려
const INITIAL_DAYS = 90; // 바로빌 소급 수집 실측: 계좌 3개월 · 카드 약 2개월+

async function resolveRange(
  db: PgDatabase,
  kind: "bank" | "card",
  targetId: string,
): Promise<{ start: string; end: string }> {
  const table = kind === "bank" ? "bank_transactions" : "card_transactions";
  const col = kind === "bank" ? "txn_at" : "approved_at";
  const fk = kind === "bank" ? "account_id" : "card_id";
  const rows = rowsToObjects(await db.exec(`SELECT max(${col}) AS last_at FROM ${table} WHERE ${fk} = $1`, [targetId]));
  const lastAt = rows[0]?.last_at as string | null;
  const end = new Date();
  const start = lastAt
    ? new Date(new Date(`${String(lastAt).slice(0, 10)}T00:00:00Z`).getTime() - OVERLAP_DAYS[kind] * 86400000)
    : new Date(end.getTime() - INITIAL_DAYS * 86400000);
  return { start: ymd(start), end: ymd(end) };
}

// ── 계좌 원장 증분 적재 (range 지정 시 해당 기간 강제 수집 — 200일 초과는 fetch 측 자동 분할) ──
export async function syncBankAccount(
  accountId: string,
  accountNo: string,
  range?: { start: string; end: string },
): Promise<{ fetched: number; inserted: number }> {
  const db = await getDb();
  const { start, end } = range ?? (await resolveRange(db, "bank", accountId));
  const logs = await fetchBankTransLogs(accountNo, start, end);
  let inserted = 0;
  await withDbWrite(async (tx) => {
    await lockAccountingWrite(tx);
    for (const log of logs) {
      const amount = log.direction === "in" ? log.deposit : log.direction === "out" ? log.withdraw : log.deposit || log.withdraw;
      const dedupKey = bankDedupKey(accountNo, log.transDT, log.direction, amount, log.balance);
      const before = rowsToObjects(await tx.exec(`SELECT 1 AS x FROM bank_transactions WHERE dedup_key = $1`, [dedupKey]));
      if (before.length) continue;
      await tx.run(
        `INSERT INTO bank_transactions
           (txn_id, account_id, txn_at, direction, amount, balance_after,
            remitter_name_raw, remitter_name_norm, trans_type, trans_office, remark1, remark2,
            bank_ref, dedup_key, raw_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), $13, $14, $15::jsonb, $16)
         ON CONFLICT (dedup_key) DO NOTHING`,
        [
          hashId("btx", dedupKey),
          accountId,
          log.transDT,
          log.direction,
          amount,
          log.balance,
          log.remark1,
          normalizeRemitter(log.remark1),
          log.transType,
          log.transOffice,
          log.remark1,
          log.remark2,
          log.transRefKey,
          dedupKey,
          JSON.stringify(log.raw),
          KST_NOW(),
        ],
      );
      inserted += 1;
    }
    await tx.run(`UPDATE bank_accounts SET last_synced_at = $2, updated_at = $2 WHERE account_id = $1`, [accountId, KST_NOW()]);
  });
  return { fetched: logs.length, inserted };
}

// ── 카드 매입 원장 증분 적재 (range 지정 시 해당 기간 강제 수집) ──
export async function syncCard(
  cardId: string,
  cardNum: string,
  range?: { start: string; end: string },
): Promise<{ fetched: number; inserted: number }> {
  const number = canonicalCardNumber(cardNum);
  const db = await getDb();
  const { start, end } = range ?? (await resolveRange(db, "card", cardId));
  const purchases = await fetchCardPurchases(number, start, end);
  return persistCardPurchases(cardId, number, purchases);
}

/** Persist a complete fetched batch atomically. Ambiguous changes preserve the prior source and fail visibly. */
export async function persistCardPurchases(cardId: string, cardNum: string, purchases: BarobillCardPurchase[]): Promise<{fetched:number;inserted:number}> {
  const number = canonicalCardNumber(cardNum);
  let inserted = 0;
  await withDbWrite(async (tx) => {
    await lockAccountingWrite(tx);
    const registry = rowsToObjects(await tx.exec("SELECT card_num FROM card_registry WHERE card_id=$1",[cardId]))[0];
    if (!registry || registry.card_num !== number) throw Object.assign(new Error("카드 등록 정보가 일치하지 않습니다."),{status:409});
    const batchKeys = new Map<string,string>();
    for (const p of purchases) {
      const normalized = normalizeCardTransaction({approval_type:p.approvalType,amount_total:p.amountTotal,supply_amount:Math.sign(p.amountTotal || 1)*(Math.abs(p.amountTotal)-Math.abs(p.taxAmount)-Math.abs(p.serviceCharge)),tax_amount:p.taxAmount,service_charge:p.serviceCharge});
      if (!Number.isSafeInteger(p.amountTotal) || !Number.isSafeInteger(p.taxAmount) || !Number.isSafeInteger(p.serviceCharge) || Math.abs(p.taxAmount)+Math.abs(p.serviceCharge)>Math.abs(p.amountTotal)) throw Object.assign(new Error("카드 수집 금액이 올바르지 않습니다."),{status:409});
      if (!p.historyKey || !p.approvedAt || !/^\d{4}-\d{2}-\d{2}/.test(p.approvedAt)) throw Object.assign(new Error("카드 수집 식별정보가 부족합니다."),{status:409});
      const kind = normalized.kind === "unknown" ? `unknown:${p.approvalType}` : normalized.kind;
      const dedupKey = `nk2:${number}:${p.approvalNum || ""}:${p.approvedAt}:${kind}:${Math.abs(p.amountTotal)}`;
      const seenHistory = batchKeys.get(dedupKey);
      if (seenHistory && seenHistory !== p.historyKey) throw Object.assign(new Error("같은 승인번호·일시·금액의 복수 원천이 있어 수집 확인이 필요합니다."),{status:409});
      batchKeys.set(dedupKey,p.historyKey);
      const supply = Math.sign(p.amountTotal || 1)*(Math.abs(p.amountTotal)-Math.abs(p.taxAmount)-Math.abs(p.serviceCharge));
      const candidates = rowsToObjects(await tx.exec(`SELECT * FROM card_transactions WHERE card_id=$1 AND (history_key=$2 OR (COALESCE(approval_num,'')=$3 AND approved_at=$4 AND abs(amount_total)=$5))`,[cardId,p.historyKey,p.approvalNum||"",p.approvedAt,Math.abs(p.amountTotal)]));
      const semanticKind=(r:Record<string,unknown>)=>{const n=normalizeCardTransaction(r);return n.kind==="unknown"?`unknown:${r.approval_type}`:n.kind;};
      const matches=candidates.filter(r=>semanticKind(r)===kind && String(r.approval_num||"")===String(p.approvalNum||"") && r.approved_at===p.approvedAt && Math.abs(Number(r.amount_total))===Math.abs(p.amountTotal));
      if (candidates.some(r=>r.history_key===p.historyKey && !matches.includes(r))) throw Object.assign(new Error("기존 카드 원천의 유형·일자·금액이 바뀌었습니다. 정정 검토가 필요합니다."),{status:409});
      if (matches.length>1) throw Object.assign(new Error("기존 카드 중복 후보를 먼저 확인하세요."),{status:409});
      if (matches.length) {
        const existing=matches[0];
        if ((!p.approvalNum && existing.history_key!==p.historyKey) || Math.abs(Number(existing.tax_amount))!==Math.abs(p.taxAmount) || Math.abs(Number(existing.service_charge||0))!==Math.abs(p.serviceCharge) || String(existing.store_corp_num||"")!==String(p.storeCorpNum||"") || (existing.store_tax_type==null?null:Number(existing.store_tax_type))!==p.storeTaxType) throw Object.assign(new Error("기존 카드 증빙 정보가 달라 자동으로 덮어쓸 수 없습니다."),{status:409});
        if (Boolean(existing.is_purchased)!==p.isPurchased) await tx.run("UPDATE card_transactions SET is_purchased=$2,updated_at=$3 WHERE card_txn_id=$1",[existing.card_txn_id,p.isPurchased?1:0,KST_NOW()]);
        continue;
      }
      await tx.run(
        `INSERT INTO card_transactions
           (card_txn_id, card_id, history_key, dedup_key, approval_type, approval_num, approved_at, use_date,
            amount_total, supply_amount, tax_amount, service_charge,
            store_corp_num, store_name, store_ceo, store_addr, store_biz_type, store_corp_type, store_tax_type,
            is_purchased, payment_plan, installment_months, use_location, is_debit, raw_json, created_at)
         VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, NULLIF($8, ''),
                 $9, $10, $11, $12,
                 NULLIF($13, ''), NULLIF($14, ''), NULLIF($15, ''), NULLIF($16, ''), NULLIF($17, ''), $18, $19,
                 $20, NULLIF($21, ''), NULLIF($22, ''), NULLIF($23, ''), $24, $25::jsonb, $26)
         ON CONFLICT (dedup_key) DO NOTHING`,
        [
          hashId("ctx", dedupKey),
          cardId,
          p.historyKey,
          dedupKey,
          p.approvalType,
          p.approvalNum,
          p.approvedAt,
          p.useDate ?? "",
          p.amountTotal,
          supply,
          p.taxAmount,
          p.serviceCharge,
          p.storeCorpNum,
          p.storeName,
          p.storeCeo,
          p.storeAddr,
          p.storeBizType,
          p.storeCorpType,
          p.storeTaxType,
          p.isPurchased ? 1 : 0,
          p.paymentPlan,
          p.installmentMonths,
          p.useLocation,
          p.isDebit ? 1 : 0,
          JSON.stringify(p.raw),
          KST_NOW(),
        ],
      );
      inserted += 1;
    }
    await tx.run(`UPDATE card_registry SET last_synced_at = $2, updated_at = $2 WHERE card_id = $1`, [cardId, KST_NOW()]);
  });
  return { fetched: purchases.length, inserted };
}

/**
 * 수집 로그 보존 — 3개월. 화면(최근 수집 로그 카드)에서 오래된 줄은 볼 일이 없고,
 * 매 수집마다 계좌·카드 수만큼 쌓여 표가 끝없이 길어진다. 수집 시작 때 한 번 정리한다.
 */
export async function purgeOldSyncLogs(): Promise<number> {
  const cutoff = new Date(Date.now() + 9 * 3600 * 1000 - 90 * 86400000).toISOString().slice(0, 19).replace("T", " ");
  let removed = 0;
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(await db.exec(`DELETE FROM finance_sync_logs WHERE started_at < $1 RETURNING sync_id`, [cutoff]));
    removed = rows.length;
  });
  return removed;
}

// ── 전체 수집 실행 (finance_sync_logs 기록 포함) ──
export interface FinanceSyncResult {
  ran: boolean;
  registry?: { accounts: number; cards: number };
  targets: Array<{ kind: string; targetId: string; fetched: number; inserted: number; error?: string }>;
}

// 바로빌이 매일 04:00(KST) 수집 → 마지막 성공이 "오늘 04:00 이후"면 최신으로 간주(skip). force로 무시.
export async function isSyncStale(): Promise<boolean> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT max(finished_at) AS last_ok FROM finance_sync_logs WHERE status = 'ok' AND kind IN ('bank', 'card')`,
    ),
  );
  const lastOk = rows[0]?.last_ok as string | null;
  if (!lastOk) return true;
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const cutoff = new Date(nowKst);
  cutoff.setUTCHours(4, 0, 0, 0);
  if (nowKst.getTime() < cutoff.getTime()) cutoff.setUTCDate(cutoff.getUTCDate() - 1); // 04시 이전이면 어제 04시 기준
  return new Date(`${String(lastOk).replace(" ", "T")}Z`).getTime() < cutoff.getTime() - 9 * 3600 * 1000;
}

let syncInFlight: Promise<FinanceSyncResult> | null = null;

// options.range: 사용자 지정 수집 기간(YYYYMMDD, 연결 관리 "지금 수집" 기간 옵션). 지정 시 증분 대신 강제 기간 수집.
export async function runFinanceSync(options?: {
  force?: boolean;
  range?: { start: string; end: string };
}): Promise<FinanceSyncResult> {
  if (syncInFlight) return syncInFlight; // 동시 실행 방지 (화면 로드 + 수동 클릭 중복)
  syncInFlight = (async () => {
    try {
      if (!options?.force && !options?.range && !(await isSyncStale())) return { ran: false, targets: [] };
      const registry = await syncRegistry();
      const db = await getDb();
      await purgeOldSyncLogs();
      const targets: FinanceSyncResult["targets"] = [];

      const accounts = rowsToObjects(
        await db.exec(`SELECT account_id, account_no FROM bank_accounts WHERE is_active = 1 AND barobill_status = 'active'`),
      );
      const cards = rowsToObjects(
        await db.exec(`SELECT card_id, card_num FROM card_registry WHERE is_active = 1 AND barobill_status = 'active'`),
      );

      for (const row of accounts) {
        const target = { kind: "bank", targetId: String(row.account_id), fetched: 0, inserted: 0 } as FinanceSyncResult["targets"][number];
        const syncId = hashId("fs", `bank:${row.account_id}:${Date.now()}`);
        await logSyncStart(syncId, "bank", String(row.account_id));
        try {
          const r = await syncBankAccount(String(row.account_id), String(row.account_no), options?.range);
          Object.assign(target, r);
          await logSyncFinish(syncId, "ok", r.fetched, r.inserted);
        } catch (err) {
          target.error = err instanceof Error ? err.message : String(err);
          await logSyncFinish(syncId, "error", 0, 0, target.error);
        }
        targets.push(target);
      }
      for (const row of cards) {
        const target = { kind: "card", targetId: String(row.card_id), fetched: 0, inserted: 0 } as FinanceSyncResult["targets"][number];
        const syncId = hashId("fs", `card:${row.card_id}:${Date.now()}`);
        await logSyncStart(syncId, "card", String(row.card_id));
        try {
          const r = await syncCard(String(row.card_id), String(row.card_num), options?.range);
          Object.assign(target, r);
          await logSyncFinish(syncId, "ok", r.fetched, r.inserted);
        } catch (err) {
          target.error = err instanceof Error ? err.message : String(err);
          await logSyncFinish(syncId, "error", 0, 0, target.error);
        }
        targets.push(target);
      }
      return { ran: true, registry, targets };
    } finally {
      syncInFlight = null;
    }
  })();
  return syncInFlight;
}

async function logSyncStart(syncId: string, kind: string, targetId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO finance_sync_logs (sync_id, kind, target_id, status, started_at) VALUES ($1, $2, $3, 'running', $4)
       ON CONFLICT (sync_id) DO NOTHING`,
      [syncId, kind, targetId, KST_NOW()],
    );
  });
}

async function logSyncFinish(syncId: string, status: "ok" | "error", fetched: number, inserted: number, error?: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE finance_sync_logs SET status = $2, fetched = $3, inserted = $4, error = $5, finished_at = $6 WHERE sync_id = $1`,
      [syncId, status, fetched, inserted, error ?? null, KST_NOW()],
    );
  });
}
