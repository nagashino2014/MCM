/**
 * 쇼핑몰 전표 ↔ 법인카드 원장 매칭 (infra/aws/197_shop_receipt_match.sql)
 *
 * 부가세 신고에서 필요한 것은 "원장의 결제 건마다 품목이 나오는 전표가 붙어 있는가" 다.
 * 전표에 찍힌 승인번호·카드끝4·금액·날짜로 card_transactions 와 잇는다.
 *
 * 자동 매칭 단계(위가 강하고, **유일 후보일 때만** 확정한다):
 *   1. approval  — 승인번호 + 금액 일치
 *   2. card      — 카드끝4 + 금액 + 날짜(±1일)
 *   3. order-sum — 같은 주문의 전표 합계 = 원장 1건 + 날짜(±1일)  (11번가 상품별 분할 전표)
 *   4. amount    — 금액 + 날짜(±1일) + 가맹점명이 쇼핑몰/PG 키워드 → 이건 확정하지 않고 후보로만 제시
 */

import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";

/**
 * 원장에서 "쇼핑몰 결제" 로 볼 가맹점명 키워드.
 * 실측: 온라인 결제는 가맹점이 PG/플랫폼 명의로 잡힌다(lib/barobill/card.ts 주석).
 */
export const SHOP_STORE_KEYWORDS = [
  "쿠팡", "coupang",
  "지마켓", "G마켓", "gmarket", "지마켓글로벌",
  "옥션", "auction",
  "11번가", "십일번가", "일레븐", "SK pay", "SK플래닛",
  "네이버", "naver", "스마트스토어",
];

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

/** 원장 후보 한 건 — 화면 표시와 매칭 판정에 필요한 최소 필드 */
export interface CardTxnCandidate {
  cardTxnId: string;
  approvedAt: string;   // YYYY-MM-DD HH:MI:SS
  approvedDate: string; // YYYY-MM-DD
  amountTotal: number;
  approvalNum: string;
  storeName: string;
  cardAlias: string;
  cardCompany: string;
  cardLast4: string;
  matchedCount: number; // 이 원장 건에 이미 붙어 있는 전표 수
}

function toCandidate(r: Record<string, unknown>): CardTxnCandidate {
  const cardNum = String(r.card_num ?? "");
  return {
    cardTxnId: String(r.card_txn_id),
    approvedAt: String(r.approved_at ?? ""),
    approvedDate: String(r.approved_at ?? "").slice(0, 10),
    amountTotal: Number(r.amount_total ?? 0),
    approvalNum: r.approval_num ? String(r.approval_num) : "",
    storeName: r.store_name ? String(r.store_name) : "",
    cardAlias: r.card_alias ? String(r.card_alias) : "",
    cardCompany: r.card_company_name ? String(r.card_company_name) : String(r.card_company ?? ""),
    cardLast4: cardNum.slice(-4),
    matchedCount: Number(r.matched_count ?? 0),
  };
}

const CANDIDATE_SELECT = `
  SELECT ct.card_txn_id, ct.approved_at, ct.amount_total, ct.approval_num, ct.store_name,
         cr.card_num, cr.card_alias, cr.card_company, cr.card_company_name,
         (SELECT count(*) FROM shop_receipts sr WHERE sr.matched_txn_id = ct.card_txn_id) AS matched_count
    FROM card_transactions ct
    JOIN card_registry cr ON cr.card_id = ct.card_id
   WHERE ct.approval_type = '승인' AND ct.excluded = 0`;

/** 기간 내 승인 건(±여유 padDays)을 통째로 읽는다 — 매칭은 메모리에서 돌리는 편이 단순하다. */
export async function loadCardTxns(from: string, to: string, padDays = 3): Promise<CardTxnCandidate[]> {
  const db = await getDb();
  const pad = (d: string, days: number) => {
    const dt = new Date(d + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  };

  const rows = rowsToObjects(
    await db.exec(`${CANDIDATE_SELECT} AND ct.approved_at >= $1 AND ct.approved_at <= $2 ORDER BY ct.approved_at`, [
      `${pad(from, -padDays)} 00:00:00`,
      `${pad(to, padDays)} 23:59:59`,
    ])
  );
  return rows.map(toCandidate);
}

export function isShopStore(storeName: string): boolean {
  const name = (storeName || "").toLowerCase().replace(/\s+/g, "");
  return SHOP_STORE_KEYWORDS.some((k) => name.includes(k.toLowerCase().replace(/\s+/g, "")));
}

function dayDiff(a: string, b: string): number {
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  const ms = Math.abs(new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime());
  return Math.round(ms / 86400000);
}

interface ReceiptForMatch {
  receiptId: string;
  site: string;
  orderNo: string;
  orderDate: string;
  amount: number;
  approvalNum: string;
  cardLast4: string;
}

export interface MatchDecision {
  receiptId: string;
  cardTxnId: string;
  basis: "approval" | "card" | "order-sum";
}

/**
 * 자동 매칭 판정(순수 함수 — DB 반영은 applyMatches 가 한다).
 * 원장 한 건에는 전표 여러 장이 붙을 수 있지만(order-sum), 전표 한 장은 원장 한 건에만 붙는다.
 */
export function decideMatches(receipts: ReceiptForMatch[], txns: CardTxnCandidate[]): MatchDecision[] {
  const decisions: MatchDecision[] = [];
  const taken = new Set<string>(); // 이번 판에서 이미 배정된 전표

  // 1단계 — 승인번호 + 금액
  const byApproval = new Map<string, CardTxnCandidate[]>();
  for (const t of txns) {
    if (!t.approvalNum) continue;
    const list = byApproval.get(t.approvalNum) ?? [];
    list.push(t);
    byApproval.set(t.approvalNum, list);
  }
  for (const r of receipts) {
    if (!r.approvalNum || !r.amount) continue;
    const hits = (byApproval.get(r.approvalNum) ?? []).filter((t) => t.amountTotal === r.amount);
    if (hits.length === 1) {
      decisions.push({ receiptId: r.receiptId, cardTxnId: hits[0].cardTxnId, basis: "approval" });
      taken.add(r.receiptId);
    }
  }

  // 2단계 — 카드끝4 + 금액 + 날짜(±1일), 유일 후보만
  for (const r of receipts) {
    if (taken.has(r.receiptId) || !r.cardLast4 || !r.amount || !r.orderDate) continue;
    const hits = txns.filter(
      (t) => t.cardLast4 === r.cardLast4 && t.amountTotal === r.amount && dayDiff(t.approvedDate, r.orderDate) <= 1
    );
    if (hits.length === 1) {
      decisions.push({ receiptId: r.receiptId, cardTxnId: hits[0].cardTxnId, basis: "card" });
      taken.add(r.receiptId);
    }
  }

  // 3단계 — 주문 합산: 같은 주문번호(#순번 제거)의 전표 합계 = 원장 1건 (11번가 상품별 분할)
  const orders = new Map<string, ReceiptForMatch[]>();
  for (const r of receipts) {
    if (taken.has(r.receiptId) || !r.amount) continue;
    const orderKey = `${r.site}::${r.orderNo.split("#")[0]}`;
    const list = orders.get(orderKey) ?? [];
    list.push(r);
    orders.set(orderKey, list);
  }
  for (const group of orders.values()) {
    const sum = group.reduce((s, r) => s + r.amount, 0);
    const date = group.find((r) => r.orderDate)?.orderDate ?? "";
    if (!sum || !date) continue;

    const hits = txns.filter((t) => t.amountTotal === sum && dayDiff(t.approvedDate, date) <= 1);
    if (hits.length === 1) {
      // 그룹 1건짜리는 2단계 실패(카드번호 불일치 등)로 내려온 것 — 가맹점명이 쇼핑몰일 때만 붙인다.
      if (group.length === 1 && !isShopStore(hits[0].storeName)) continue;
      for (const r of group) {
        decisions.push({ receiptId: r.receiptId, cardTxnId: hits[0].cardTxnId, basis: "order-sum" });
        taken.add(r.receiptId);
      }
    }
  }

  return decisions;
}

export async function runAutoMatch(from: string, to: string): Promise<{ matched: number; total: number }> {
  const db = await getDb();
  const receipts = rowsToObjects(
    await db.exec(
      `SELECT receipt_id, site, order_no, order_date, amount, approval_num, card_last4
         FROM shop_receipts
        WHERE matched_txn_id IS NULL AND excluded = 0
          AND (order_date IS NULL OR (order_date >= $1 AND order_date <= $2))`,
      [from, to]
    )
  ).map((r) => ({
    receiptId: String(r.receipt_id),
    site: String(r.site),
    orderNo: String(r.order_no),
    orderDate: r.order_date ? String(r.order_date) : "",
    amount: Number(r.amount ?? 0),
    approvalNum: r.approval_num ? String(r.approval_num) : "",
    cardLast4: r.card_last4 ? String(r.card_last4) : "",
  }));

  const txns = await loadCardTxns(from, to);
  const decisions = decideMatches(receipts, txns);

  if (decisions.length > 0) {
    const now = KST_NOW();
    await withDbWrite(async (tx) => {
      for (const d of decisions) {
        await tx.run(
          `UPDATE shop_receipts
              SET matched_txn_id = $1, match_status = 'auto', match_basis = $2, matched_at = $3
            WHERE receipt_id = $4 AND matched_txn_id IS NULL`,
          [d.cardTxnId, d.basis, now, d.receiptId]
        );
      }
    });
  }

  return { matched: decisions.length, total: receipts.length };
}

/** 수동 연결(txnId 지정) / 해제(null) */
export async function setManualMatch(receiptId: string, cardTxnId: string | null): Promise<void> {
  await withDbWrite(async (tx) => {
    if (cardTxnId) {
      await tx.run(
        `UPDATE shop_receipts
            SET matched_txn_id = $1, match_status = 'manual', match_basis = 'manual', matched_at = $2
          WHERE receipt_id = $3`,
        [cardTxnId, KST_NOW(), receiptId]
      );
    } else {
      await tx.run(
        `UPDATE shop_receipts
            SET matched_txn_id = NULL, match_status = NULL, match_basis = NULL, matched_at = NULL
          WHERE receipt_id = $1`,
        [receiptId]
      );
    }
  });
}

/**
 * 매칭 제외 표시 / 복원.
 * 개인카드 결제 등 원장에 상대가 없는 전표를 걷어낸다. 제외하면 기존 연결도 함께 푼다
 * (잘못 연결해 두고 제외하는 경우를 막기 위해). 복원은 표시만 되돌린다 — 매칭은 다시
 * [자동 매칭] 이나 [연결] 로 잇는다.
 */
export async function setExcluded(receiptId: string, excluded: boolean): Promise<void> {
  await withDbWrite(async (tx) => {
    if (excluded) {
      await tx.run(
        `UPDATE shop_receipts
            SET excluded = 1, matched_txn_id = NULL, match_status = NULL, match_basis = NULL, matched_at = NULL
          WHERE receipt_id = $1`,
        [receiptId]
      );
    } else {
      await tx.run(`UPDATE shop_receipts SET excluded = 0 WHERE receipt_id = $1`, [receiptId]);
    }
  });
}

/**
 * 한 전표의 수동 연결 후보 — 금액이 같거나, 날짜 ±3일 내 쇼핑몰 결제.
 * 가까운 날짜·같은 금액이 위로 오게 정렬한다.
 */
export async function listCandidates(receiptId: string): Promise<CardTxnCandidate[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT order_date, amount FROM shop_receipts WHERE receipt_id = $1`, [receiptId])
  );
  if (rows.length === 0) return [];

  const orderDate = rows[0].order_date ? String(rows[0].order_date) : "";
  const amount = Number(rows[0].amount ?? 0);
  if (!orderDate && !amount) return [];

  const from = orderDate || "1900-01-01";
  const txns = orderDate ? await loadCardTxns(from, from, 3) : [];
  const byAmount =
    amount > 0
      ? rowsToObjects(
          await db.exec(`${CANDIDATE_SELECT} AND ct.amount_total = $1 ORDER BY ct.approved_at DESC LIMIT 20`, [amount])
        ).map(toCandidate)
      : [];

  const seen = new Set<string>();
  const merged = [...txns.filter((t) => amount === 0 || t.amountTotal === amount || isShopStore(t.storeName)), ...byAmount]
    .filter((t) => (seen.has(t.cardTxnId) ? false : (seen.add(t.cardTxnId), true)))
    .sort((a, b) => {
      const scoreOf = (t: CardTxnCandidate) =>
        (t.amountTotal === amount ? 0 : 10) + Math.min(dayDiff(t.approvedDate, orderDate), 9);
      return scoreOf(a) - scoreOf(b);
    });

  return merged.slice(0, 20);
}

/** 원장 기준 커버리지 — 쇼핑몰 결제로 보이는데 전표가 안 붙은 건(수집 누락 확인용). */
export async function listUncoveredShopTxns(from: string, to: string): Promise<CardTxnCandidate[]> {
  const txns = await loadCardTxns(from, to, 0);
  return txns.filter((t) => isShopStore(t.storeName) && t.matchedCount === 0);
}
