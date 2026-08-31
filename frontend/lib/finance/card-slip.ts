// 법인카드 전자 전표 생성 — 야간 배치(card-slip-tick)와 온디맨드 폴백의 공용 구현.
// 규약은 개인 영수증(receipts.ts)의 pdf_key 와 같다: 스토리지에 PDF 를 두고 key 를 원장에 기록,
// 기안 화면은 그 key 를 file_attachments 에 그대로 넣는다(재업로드 없음).
// 설계: docs/barobill-finance-blueprint.md — 지출결의 자동작성 P1 의 증빙 축.

import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { putContractDocument, sanitizePathSegment } from "@/lib/storage/contract-document-storage";
import { loadCategories } from "@/lib/barobill/classify";
import { getCompanyProfile } from "@/lib/company/profile";
// 브랜치 통합(2026-08-28) — 사전 생성 전용 렌더러는 card-slip-pre-pdf 로 분리 보존(card-slip-pdf 는 지출결의 첨부용).
import { buildCardSlipPdf, type CardSlipData } from "@/lib/finance/card-slip-pre-pdf";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

/** 전표 첨부 표시명 — 결재자가 목록에서 무슨 전표인지 알아볼 수 있게. */
export function cardSlipName(storeName: string | null, approvedAt: string): string {
  const store = (storeName ?? "미상").slice(0, 30);
  return `법인카드전표_${store}_${approvedAt.slice(0, 10)}.pdf`;
}

interface SlipSourceRow {
  card_txn_id: string;
  card_num: string | null;
  card_alias: string | null;
  card_company_name: string | null;
  approval_type: string;
  approval_num: string | null;
  approved_at: string;
  use_date: string | null;
  installment_months: string | null;
  is_purchased: number;
  store_name: string | null;
  store_corp_num: string | null;
  store_ceo: string | null;
  store_biz_type: string | null;
  store_addr: string | null;
  amount_total: string | number;
  supply_amount: string | number | null;
  tax_amount: string | number | null;
  service_charge: string | number | null;
  category_key: string | null;
}

const SELECT_COLS = `t.card_txn_id, c.card_num, c.card_alias, c.card_company_name,
       t.approval_type, t.approval_num, t.approved_at, t.use_date, t.installment_months, t.is_purchased,
       t.store_name, t.store_corp_num, t.store_ceo, t.store_biz_type, t.store_addr,
       t.amount_total, t.supply_amount, t.tax_amount, t.service_charge, t.category_key`;

const num = (v: string | number | null | undefined): number | null => (v == null ? null : Number(v));

/** 전표 1건 생성 → 스토리지 저장 + 원장 기록. 이미 있으면 그대로 두고 key 만 돌려준다. */
async function renderAndStore(
  row: SlipSourceRow,
  ctx: { companyName: string; companyCorpNum: string | null; categoryLabels: Map<string, string> },
): Promise<string> {
  const now = KST_NOW();
  const data: CardSlipData = {
    cardTxnId: row.card_txn_id,
    cardLabel: [row.card_company_name, row.card_alias].filter(Boolean).join(" · "),
    cardNum: row.card_num,
    approvalType: row.approval_type,
    approvalNum: row.approval_num,
    approvedAt: row.approved_at,
    useDate: row.use_date,
    installment: row.installment_months,
    isPurchased: Number(row.is_purchased ?? 0) === 1,
    storeName: row.store_name,
    storeCorpNum: row.store_corp_num,
    storeCeo: row.store_ceo,
    storeBizType: row.store_biz_type,
    storeAddr: row.store_addr,
    amountTotal: Number(row.amount_total ?? 0),
    supplyAmount: num(row.supply_amount),
    taxAmount: num(row.tax_amount),
    serviceCharge: num(row.service_charge),
    categoryLabel: row.category_key ? ctx.categoryLabels.get(row.category_key) ?? null : null,
    companyName: ctx.companyName,
    companyCorpNum: ctx.companyCorpNum,
    issuedAt: now,
  };
  const pdf = await buildCardSlipPdf(data);
  const ym = row.approved_at.slice(0, 7).replace("-", "") || now.slice(0, 7).replace("-", "");
  const nameSeg = sanitizePathSegment(row.store_name ?? "카드전표").slice(0, 40) || "카드전표";
  const slipKey = `card-slips/${ym}/${row.card_txn_id.replace(/^ctx-/, "")}_카드전표_${nameSeg}.pdf`;
  await putContractDocument(slipKey, pdf, "application/pdf");
  await withDbWrite(async (db) => {
    await db.run(`UPDATE card_transactions SET slip_key = $2, slip_at = $3 WHERE card_txn_id = $1`, [
      row.card_txn_id,
      slipKey,
      now,
    ]);
  });
  return slipKey;
}

async function slipContext() {
  const [profile, categories] = await Promise.all([getCompanyProfile(), loadCategories()]);
  return {
    companyName: profile.companyName || "회사",
    companyCorpNum: profile.bizRegNo || null,
    categoryLabels: new Map(categories.map((c) => [c.categoryKey, c.label])),
  };
}

/**
 * 전표가 없는 승인 건을 일괄 생성한다(야간 배치). 1회 상한 이내로 오래된 건부터 소진하고,
 * 개별 실패는 건너뛴다 — 실패 건은 slip_key 가 비어 있으므로 다음 회차에 다시 시도된다.
 */
export async function generateMissingCardSlips(limit = 500): Promise<{ created: number; failed: number }> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ${SELECT_COLS}
         FROM card_transactions t JOIN card_registry c ON c.card_id = t.card_id
        WHERE t.slip_key IS NULL AND t.approval_type = '승인'
        ORDER BY t.approved_at ASC
        LIMIT ${Math.max(1, Math.min(limit, 2000))}`,
    ),
  ) as unknown as SlipSourceRow[];
  if (!rows.length) return { created: 0, failed: 0 };

  const ctx = await slipContext();
  let created = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await renderAndStore(row, ctx);
      created += 1;
    } catch (err) {
      failed += 1;
      console.warn("[card-slip] 생성 실패", row.card_txn_id, (err as Error).message);
    }
  }
  return { created, failed };
}

/**
 * 단건 보장 — 기안 화면이 아직 배치가 훑지 않은 최신 건을 선택했을 때의 폴백.
 * 이미 전표가 있으면 그대로 쓴다(대부분의 경우 여기서 끝난다).
 */
export async function ensureCardSlips(cardTxnIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!cardTxnIds.length) return out;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT t.slip_key, ${SELECT_COLS}
         FROM card_transactions t JOIN card_registry c ON c.card_id = t.card_id
        WHERE t.card_txn_id = ANY($1::text[])`,
      [cardTxnIds],
    ),
  );
  const pending: SlipSourceRow[] = [];
  for (const r of rows) {
    if (r.slip_key) out.set(String(r.card_txn_id), String(r.slip_key));
    else pending.push(r as unknown as SlipSourceRow);
  }
  if (!pending.length) return out;

  const ctx = await slipContext();
  for (const row of pending) {
    try {
      out.set(row.card_txn_id, await renderAndStore(row, ctx));
    } catch (err) {
      console.warn("[card-slip] 온디맨드 생성 실패", row.card_txn_id, (err as Error).message);
    }
  }
  return out;
}
