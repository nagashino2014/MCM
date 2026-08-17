// 개인카드 영수증 스톡 — 저장·조회·결재문서 연동 (블루프린트 accounting-expansion §2, P1)
// 소유 규칙: 영수증은 촬영자 본인 것만 조회·사용한다(owner_user_id 강제 — 별도 권한키 없음).
// 귀속 규약: card_transactions 와 동일 — 표 행의 _receiptId 로 doc_id 마킹/해제, 이중 기입 차단.
// 환급 정산: 급여 합산 금지·별도 이체(사용자 확정) — 이체 실행은 P1 범위 밖(문서 승인 후 수동).

import { createHash } from "node:crypto";
import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";
import { putContractDocument, deleteContractDocument, sanitizePathSegment } from "@/lib/storage/contract-document-storage";
import { classifyMany, loadCategories, isPgMerchant } from "@/lib/barobill/classify";
import { buildReceiptPdf } from "@/lib/finance/receipt-pdf";
import type { ReceiptFields } from "@/lib/finance/receipt-parser";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

const hashId = (prefix: string, source: string) =>
  `${prefix}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;

export interface PersonalReceipt {
  receiptId: string;
  ownerUserId: string;
  paidAt: string | null;
  storeName: string | null;
  storeCorpNum: string | null;
  totalAmount: number;
  supplyAmount: number | null;
  taxAmount: number | null;
  cardLast4: string | null;
  approvalNum: string | null;
  items: string[];
  categoryKey: string | null;
  categorySource: string | null;
  imageKey: string;
  pdfKey: string;
  docId: string | null;
  docFormId: string | null;
  excluded: boolean;
  memo: string | null;
  createdAt: string;
}

function toReceipt(r: Record<string, unknown>): PersonalReceipt {
  return {
    receiptId: String(r.receipt_id),
    ownerUserId: String(r.owner_user_id),
    paidAt: r.paid_at ? String(r.paid_at) : null,
    storeName: r.store_name ? String(r.store_name) : null,
    storeCorpNum: r.store_corp_num ? String(r.store_corp_num) : null,
    totalAmount: Number(r.total_amount ?? 0),
    supplyAmount: r.supply_amount == null ? null : Number(r.supply_amount),
    taxAmount: r.tax_amount == null ? null : Number(r.tax_amount),
    cardLast4: r.card_last4 ? String(r.card_last4) : null,
    approvalNum: r.approval_num ? String(r.approval_num) : null,
    items: (r.items_json as string[] | null) ?? [],
    categoryKey: r.category_key ? String(r.category_key) : null,
    categorySource: r.category_source ? String(r.category_source) : null,
    imageKey: String(r.image_key),
    pdfKey: String(r.pdf_key),
    docId: r.doc_id ? String(r.doc_id) : null,
    docFormId: r.doc_form_id ? String(r.doc_form_id) : null,
    excluded: Boolean(Number(r.excluded ?? 0)),
    memo: r.memo ? String(r.memo) : null,
    createdAt: String(r.created_at),
  };
}

/** 저장 전 소프트 중복 감지 — 승인번호 일치 또는 (거래일 ±1일 & 금액 일치). 차단 아님(지류 재발행 허용). */
export async function findDuplicateReceipts(
  ownerUserId: string,
  fields: { approvalNum: string | null; paidAt: string | null; totalAmount: number | null },
): Promise<PersonalReceipt[]> {
  const db = await getDb();
  const conds: string[] = [];
  const params: unknown[] = [ownerUserId];
  if (fields.approvalNum) {
    params.push(fields.approvalNum);
    conds.push(`approval_num = $${params.length}`);
  }
  if (fields.paidAt && fields.totalAmount != null) {
    params.push(fields.totalAmount, fields.paidAt.slice(0, 10));
    conds.push(`(total_amount = $${params.length - 1} AND abs((substr(paid_at,1,10))::date - $${params.length}::date) <= 1)`);
  }
  if (!conds.length) return [];
  const rows = rowsToObjects(
    await db.exec(
      `SELECT * FROM personal_receipts WHERE owner_user_id = $1 AND excluded = 0 AND (${conds.join(" OR ")}) LIMIT 5`,
      params,
    ),
  );
  return rows.map(toReceipt);
}

/** 촬영 확정 저장 — 이미지(JPEG)·증빙 PDF 스토리지 적재 + 자동분류 프리셋 + INSERT. */
export async function saveReceipt(params: {
  ownerUserId: string;
  ownerLabel: string; // PDF 스탬프 표시용(이메일 등)
  fields: ReceiptFields; // 사용자 확인·수정을 거친 값
  parsed: unknown; // LLM 파싱 원본(감사용, null 가능)
  image: Buffer; // 정규화된 JPEG
  memo?: string | null;
}): Promise<PersonalReceipt> {
  const now = KST_NOW();
  const receiptId = hashId("rcp", `${params.ownerUserId}:${now}:${Math.random()}`);
  const ym = now.slice(0, 7).replace("-", "");
  const nameSeg = sanitizePathSegment(params.fields.storeName ?? "영수증").slice(0, 40) || "영수증";
  const base = `receipts/${ym}/${receiptId.slice(4)}_영수증_${nameSeg}`;
  const imageKey = `${base}.jpg`;
  const pdfKey = `${base}.pdf`;

  const pdf = await buildReceiptPdf(params.image, {
    storeName: params.fields.storeName,
    paidAt: params.fields.paidAt,
    totalAmount: params.fields.totalAmount,
    capturedBy: params.ownerLabel,
    capturedAt: now,
  });
  await putContractDocument(imageKey, params.image, "image/jpeg");
  await putContractDocument(pdfKey, pdf, "application/pdf");

  // 자동분류 프리셋 — 법인카드와 동일 4단 파이프라인(업태 정보는 없으므로 규칙 단계는 사실상 상호·사업자번호 기반).
  const [cls] = await classifyMany([
    { storeCorpNum: params.fields.storeCorpNum, storeBizType: null, storeName: params.fields.storeName },
  ]);

  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO personal_receipts
         (receipt_id, owner_user_id, paid_at, store_name, store_corp_num,
          total_amount, supply_amount, tax_amount, card_last4, approval_num,
          items_json, parsed_json, category_key, category_source,
          image_key, pdf_key, excluded, memo, created_at)
       VALUES ($1, $2, NULLIF($3,''), NULLIF($4,''), NULLIF($5,''),
               $6, $7, $8, NULLIF($9,''), NULLIF($10,''),
               $11::jsonb, $12::jsonb, $13, $14,
               $15, $16, 0, NULLIF($17,''), $18)`,
      [
        receiptId,
        params.ownerUserId,
        params.fields.paidAt ?? "",
        params.fields.storeName ?? "",
        params.fields.storeCorpNum ?? "",
        params.fields.totalAmount ?? 0,
        params.fields.supplyAmount,
        params.fields.taxAmount,
        params.fields.cardLast4 ?? "",
        params.fields.approvalNum ?? "",
        JSON.stringify(params.fields.items ?? []),
        params.parsed == null ? null : JSON.stringify(params.parsed),
        cls?.categoryKey ?? null,
        cls?.source ?? null,
        imageKey,
        pdfKey,
        params.memo ?? "",
        now,
      ],
    );
  });

  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM personal_receipts WHERE receipt_id = $1`, [receiptId]));
  return toReceipt(rows[0]);
}

/** 내 영수증 목록 — 기본 미제외 전체, unusedOnly 로 미귀속(기안 피커용)만. */
export async function listMyReceipts(params: {
  ownerUserId: string;
  unusedOnly?: boolean;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<PersonalReceipt[]> {
  const db = await getDb();
  const conds = ["owner_user_id = $1", "excluded = 0"];
  const sqlParams: unknown[] = [params.ownerUserId];
  if (params.unusedOnly) conds.push("doc_id IS NULL");
  if (params.from) {
    sqlParams.push(params.from);
    conds.push(`paid_at >= $${sqlParams.length}`);
  }
  if (params.to) {
    sqlParams.push(params.to + " 23:59");
    conds.push(`paid_at <= $${sqlParams.length}`);
  }
  const limit = Math.min(Math.max(Number(params.limit ?? 100) || 100, 1), 200);
  const rows = rowsToObjects(
    await db.exec(
      `SELECT * FROM personal_receipts WHERE ${conds.join(" AND ")} ORDER BY paid_at DESC NULLS LAST, created_at DESC LIMIT ${limit}`,
      sqlParams,
    ),
  );
  return rows.map(toReceipt);
}

export async function getReceipt(receiptId: string): Promise<PersonalReceipt | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM personal_receipts WHERE receipt_id = $1`, [receiptId]));
  return rows.length ? toReceipt(rows[0]) : null;
}

/** 필드 수정(본인·미귀속만) / excluded·memo 는 귀속 여부와 무관하게 본인이 수정 가능. */
export async function updateReceipt(
  receiptId: string,
  ownerUserId: string,
  patch: {
    paidAt?: string | null;
    storeName?: string | null;
    totalAmount?: number;
    excluded?: boolean;
    memo?: string | null;
  },
): Promise<void> {
  const existing = await getReceipt(receiptId);
  if (!existing || existing.ownerUserId !== ownerUserId) {
    throw Object.assign(new Error("영수증을 찾을 수 없습니다."), { status: 404 });
  }
  const fieldPatch = patch.paidAt !== undefined || patch.storeName !== undefined || patch.totalAmount !== undefined;
  if (fieldPatch && existing.docId) {
    throw Object.assign(new Error("결의서에 사용된 영수증은 내용을 수정할 수 없습니다."), { status: 400 });
  }
  const now = KST_NOW();
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE personal_receipts SET
         paid_at = CASE WHEN $3 THEN NULLIF($4,'') ELSE paid_at END,
         store_name = CASE WHEN $5 THEN NULLIF($6,'') ELSE store_name END,
         total_amount = COALESCE($7, total_amount),
         excluded = COALESCE($8, excluded),
         memo = CASE WHEN $9 THEN NULLIF($10,'') ELSE memo END,
         updated_at = $2
       WHERE receipt_id = $1`,
      [
        receiptId,
        now,
        patch.paidAt !== undefined,
        patch.paidAt ?? "",
        patch.storeName !== undefined,
        patch.storeName ?? "",
        patch.totalAmount ?? null,
        patch.excluded === undefined ? null : patch.excluded ? 1 : 0,
        patch.memo !== undefined,
        patch.memo ?? "",
      ],
    );
  });
}

/** 삭제(본인·미귀속만) — 스토리지 정리는 best-effort. */
export async function deleteReceipt(receiptId: string, ownerUserId: string): Promise<void> {
  const existing = await getReceipt(receiptId);
  if (!existing || existing.ownerUserId !== ownerUserId) {
    throw Object.assign(new Error("영수증을 찾을 수 없습니다."), { status: 404 });
  }
  if (existing.docId) {
    throw Object.assign(new Error("결의서에 사용된 영수증은 삭제할 수 없습니다. 문서에서 먼저 제거하세요."), { status: 400 });
  }
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM personal_receipts WHERE receipt_id = $1`, [receiptId]);
  });
  await deleteContractDocument(existing.imageKey);
  await deleteContractDocument(existing.pdfKey);
}

// ─────────────────────────────────────────────
// 결재문서 ↔ 영수증 연동 — classify.ts 의 _cardTxnId 규약과 동일한 형제 구현(_receiptId).
// ─────────────────────────────────────────────

/** field_values 안의 모든 표(행 배열)에서 { _receiptId, category } 를 수집한다. */
export function collectReceiptRefs(fieldValues: Record<string, unknown>): Array<{ receiptId: string; categoryOption: string | null }> {
  const out: Array<{ receiptId: string; categoryOption: string | null }> = [];
  for (const value of Object.values(fieldValues)) {
    if (!Array.isArray(value)) continue;
    for (const row of value) {
      if (!row || typeof row !== "object") continue;
      const receiptId = (row as Record<string, unknown>)._receiptId;
      if (typeof receiptId === "string" && receiptId) {
        const category = (row as Record<string, unknown>).category;
        out.push({ receiptId, categoryOption: typeof category === "string" && category ? category : null });
      }
    }
  }
  return out;
}

/**
 * 문서 저장/상신 시 호출 — 이 문서의 영수증 연결을 현재 field_values 기준으로 동기화한다.
 * 표에 남은 건 doc_id 마킹 + 분류 확정 + 학습(card_merchant_links — 사업자번호 있는 건만),
 * 표에서 빠진 건 doc_id 해제. 소유자 검증: 기안자(actor) 본인 영수증만 귀속시킨다.
 */
export async function syncDocReceiptLinks(
  docId: string,
  formId: string,
  fieldValues: Record<string, unknown>,
  actorUserId: string,
): Promise<void> {
  const refs = collectReceiptRefs(fieldValues);
  const categories = await loadCategories();
  const optionToKey = new Map<string, string>();
  for (const cat of categories) {
    const option = cat.formOptionMap[formId];
    if (option) optionToKey.set(option, cat.categoryKey);
    optionToKey.set(cat.label, cat.categoryKey);
  }

  const now = KST_NOW();
  await withDbWrite(async (db) => {
    const keepIds = refs.map((r) => r.receiptId);
    await db.run(
      keepIds.length
        ? `UPDATE personal_receipts SET doc_id = NULL, doc_form_id = NULL, updated_at = $2
            WHERE doc_id = $1 AND NOT (receipt_id = ANY($3::text[]))`
        : `UPDATE personal_receipts SET doc_id = NULL, doc_form_id = NULL, updated_at = $2 WHERE doc_id = $1`,
      keepIds.length ? [docId, now, keepIds] : [docId, now],
    );

    for (const ref of refs) {
      const categoryKey = ref.categoryOption ? optionToKey.get(ref.categoryOption) ?? null : null;
      await db.run(
        `UPDATE personal_receipts
            SET doc_id = $2, doc_form_id = $3,
                category_key = COALESCE($4, category_key),
                category_source = CASE WHEN $4 IS NOT NULL THEN 'manual' ELSE category_source END,
                updated_at = $5
          WHERE receipt_id = $1 AND owner_user_id = $6`,
        [ref.receiptId, docId, formId, categoryKey, now, actorUserId],
      );
      if (categoryKey) {
        const rows = rowsToObjects(
          await db.exec(`SELECT store_corp_num, store_name FROM personal_receipts WHERE receipt_id = $1`, [ref.receiptId]),
        );
        const corpNum = rows[0]?.store_corp_num ? String(rows[0].store_corp_num) : null;
        if (corpNum && !isPgMerchant(null)) {
          await db.run(
            `INSERT INTO card_merchant_links (store_corp_num, category_key, store_name_snapshot, confirm_count, last_confirmed_at, created_at)
             VALUES ($1, $2, $3, 1, $4, $4)
             ON CONFLICT (store_corp_num) DO UPDATE SET
               category_key = EXCLUDED.category_key,
               store_name_snapshot = EXCLUDED.store_name_snapshot,
               confirm_count = card_merchant_links.confirm_count + 1,
               last_confirmed_at = EXCLUDED.last_confirmed_at`,
            [corpNum, categoryKey, rows[0]?.store_name ? String(rows[0].store_name) : null, now],
          );
        }
      }
    }
  });
}

/** 문서 삭제 시 — 연결된 영수증 전부 해제. */
export async function unlinkDocReceipts(docId: string): Promise<void> {
  const now = KST_NOW();
  await withDbWrite(async (db) => {
    await db.run(`UPDATE personal_receipts SET doc_id = NULL, doc_form_id = NULL, updated_at = $2 WHERE doc_id = $1`, [docId, now]);
  });
}
