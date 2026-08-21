/**
 * 쇼핑몰 전표 스톡 — 저장·조회 (infra/aws/196_shop_receipts.sql)
 *
 * 수집은 개인 PC 에서만 되지만(로그인 세션·브라우저가 거기 있다), 부가세 신고는 스테이징에서 한다.
 * 그래서 각자 PC 의 대장·PDF 를 여기로 올려 두고 신고 화면에서 함께 본다.
 * 같은 주문의 같은 종류 전표는 몇 번을 올려도 한 행이다(receipt_id 가 그 조합의 해시).
 */

import { createHash } from "node:crypto";

import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";

export interface ShopReceiptInput {
  site: string;
  orderNo: string;
  orderDate: string;
  title: string;
  amount: number;
  receiptType: string;
  method: string;
  storageKey: string | null;
  fileName: string | null;
  collectedAt: string;
}

export interface ShopReceipt extends ShopReceiptInput {
  receiptId: string;
  uploadedBy: string | null;
  uploadedAt: string;
}

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

export function shopReceiptId(site: string, orderNo: string, receiptType: string): string {
  const source = `${site}|${orderNo}|${receiptType}`;
  return `shr-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;
}

/** "32,000원" → 32000. 숫자를 못 찾으면 0. */
export function parseAmount(raw: string): number {
  const digits = (raw || "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

/**
 * 대장 행을 올린다. 이미 있는 건은 값을 갱신한다 —
 * 품목·금액이 나중에 enrich 로 채워지는 일이 있어 덮어쓰는 편이 맞다.
 * 단 storage_key 는 새 값이 없을 때 기존 것을 지우지 않는다.
 */
export async function upsertShopReceipts(rows: ShopReceiptInput[], uploadedBy: string | null): Promise<number> {
  if (rows.length === 0) return 0;
  const now = KST_NOW();

  return withDbWrite(async (db) => {
    for (const row of rows) {
      await db.run(
        `INSERT INTO shop_receipts
           (receipt_id, site, order_no, order_date, title, amount, receipt_type, method,
            storage_key, file_name, collected_at, uploaded_by, uploaded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (receipt_id) DO UPDATE SET
           order_date  = EXCLUDED.order_date,
           title       = EXCLUDED.title,
           amount      = EXCLUDED.amount,
           method      = EXCLUDED.method,
           storage_key = COALESCE(EXCLUDED.storage_key, shop_receipts.storage_key),
           file_name   = COALESCE(EXCLUDED.file_name, shop_receipts.file_name),
           collected_at = EXCLUDED.collected_at,
           uploaded_by = EXCLUDED.uploaded_by,
           uploaded_at = EXCLUDED.uploaded_at`,
        [
          shopReceiptId(row.site, row.orderNo, row.receiptType),
          row.site,
          row.orderNo,
          row.orderDate || null,
          row.title || null,
          row.amount,
          row.receiptType,
          row.method || null,
          row.storageKey,
          row.fileName,
          row.collectedAt || null,
          uploadedBy,
          now,
        ]
      );
    }
    return rows.length;
  });
}

/** 이미 올라간 전표의 storage_key 목록 — 같은 PDF 를 다시 올리지 않으려고 본다. */
export async function loadUploadedKeys(site: string): Promise<Set<string>> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT DISTINCT storage_key FROM shop_receipts WHERE site = $1 AND storage_key IS NOT NULL`, [site])
  );
  return new Set(rows.map((r) => String(r.storage_key)));
}

export interface ShopReceiptQuery {
  from?: string;
  to?: string;
  site?: string;
  limit?: number;
}

export async function listShopReceipts(q: ShopReceiptQuery): Promise<ShopReceipt[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  // 주문일이 비어 있는 건(전표에서 날짜를 못 읽은 건)은 기간을 걸어도 빠지지 않게 남긴다.
  if (q.from) {
    params.push(q.from);
    where.push(`(order_date IS NULL OR order_date >= $${params.length})`);
  }
  if (q.to) {
    params.push(q.to);
    where.push(`(order_date IS NULL OR order_date <= $${params.length})`);
  }
  if (q.site) {
    params.push(q.site);
    where.push(`site = $${params.length}`);
  }

  params.push(Math.min(Math.max(q.limit ?? 500, 1), 2000));

  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT * FROM shop_receipts
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY order_date DESC NULLS LAST, site, order_no
        LIMIT $${params.length}`,
      params
    )
  );

  return rows.map((r) => ({
    receiptId: String(r.receipt_id),
    site: String(r.site),
    orderNo: String(r.order_no),
    orderDate: r.order_date ? String(r.order_date) : "",
    title: r.title ? String(r.title) : "",
    amount: Number(r.amount ?? 0),
    receiptType: String(r.receipt_type),
    method: r.method ? String(r.method) : "",
    storageKey: r.storage_key ? String(r.storage_key) : null,
    fileName: r.file_name ? String(r.file_name) : null,
    collectedAt: r.collected_at ? String(r.collected_at) : "",
    uploadedBy: r.uploaded_by ? String(r.uploaded_by) : null,
    uploadedAt: String(r.uploaded_at),
  }));
}
