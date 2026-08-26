// 전자발행 세금계산서 PDF 자동 보관 (2026-08-25).
//
// 바로빌은 PDF 다운로드 API 가 없다(조회/인쇄 URL 만 제공 — 실측).
// 주 경로(2026-08-25 사용자 확정): **바로빌 인쇄 화면(GetTaxInvoicePrintURL)을 converter 의
// headless Chromium 으로 그대로 PDF 캡처** — 국세청 양식과 동일한 모습이 보장된다.
// 캡처 실패 시 홈택스 양식 XLSX(tax-invoice-xlsx)→LibreOffice 변환, 그다음 pdf-lib 렌더 폴백.
// 저장 자리는 수동 발행과 동일(contract_documents 'tax_invoice' + contract_invoices)
// → 문서함·계약 화면이 무수정으로 호환된다.
//  - 발행 직후: issueTaxInvoice 가 호출(실패해도 발행은 유지 — soft).
//  - 국세청 전송 완료 시: refreshInvoiceStates 가 승인번호를 반영해 재생성(force).
//  - 기존 발행분: backfillInvoicePdfs — 재무 화면의 상태 갱신(refresh) 흐름에 얹혀 자동 백필.
// 사용자가 수동 업로드한 계산서(manual_upload)가 있으면 건드리지 않는다(수동본 우선).

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getCompanyProfile } from "@/lib/company/profile";
import { getInvoiceStorageKey, putContractDocument } from "@/lib/storage/contract-document-storage";
import { renderTaxInvoicePdf } from "@/lib/barobill/tax-invoice-pdf";
import { buildTaxInvoiceXlsx } from "@/lib/barobill/tax-invoice-xlsx";
import { getTaxInvoicePrintUrl } from "@/lib/barobill/tax-invoice";
import { convertOfficeToPdf, renderUrlToPdf } from "@/lib/agreement/convert";

const MODIFY_REASON_LABELS: Record<string, string> = {
  "1": "기재사항착오정정",
  "2": "공급가액변동",
  "3": "환입",
  "4": "계약의 해제",
  "5": "내국신용장 사후개설",
  "6": "착오에 의한 이중발급",
};

interface LineItem {
  purchaseExpiry?: string;
  name?: string;
  chargeableUnit?: string;
  unitPrice?: string;
  amount?: string;
  tax?: string;
  description?: string;
}

function toPlainCompanyName(name: string): string {
  return name.replace(/\s*(주식회사|\(주\)|㈜)\s*/g, " ").trim() || name;
}

/**
 * 발행 1건의 보관용 PDF 를 생성해 계약 문서함에 저장한다.
 *  - force=false: 이미 해당 단계에 세금계산서 문서가 있으면 건너뛴다(수동본·기존 자동본 유지).
 *  - force=true: 자동 생성본을 교체한다(승인번호 반영 재생성·캡처본 업그레이드). 수동본이 있으면 여전히 건너뛴다.
 *  - requireCapture=true: 바로빌 인쇄 화면 캡처가 성공했을 때만 저장(양식 렌더본→캡처본 업그레이드용 —
 *    캡처가 안 되면 기존 것을 유지한다).
 */
export async function archiveTaxInvoicePdf(
  invoiceId: string,
  opts: { force?: boolean; requireCapture?: boolean } = {}
): Promise<{ saved: boolean; reason?: string }> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT t.invoice_id, t.mgt_key, t.contract_id, t.milestone_id, t.write_date,
              t.amount_total, t.tax_total, t.total_amount, t.tax_type, t.purpose_type,
              t.invoicee_facility_id, t.invoicee_corp_num, t.invoicee_corp_name, t.invoicee_email,
              t.line_items, t.nts_send_key, t.issued_at, t.issued_by, t.canceled_at, t.modify_code,
              c.contract_title, m.stage_label
         FROM tax_invoices t
         LEFT JOIN contracts c ON c.contract_id = t.contract_id
         LEFT JOIN contract_payment_milestones m ON m.milestone_id = t.milestone_id
        WHERE t.invoice_id = $1`,
      [invoiceId]
    )
  );
  if (!rows.length) return { saved: false, reason: "not-found" };
  const inv = rows[0];
  if (inv.canceled_at) return { saved: false, reason: "canceled" };
  const contractId = inv.contract_id ? String(inv.contract_id) : null;
  if (!contractId) return { saved: false, reason: "no-contract" };
  const milestoneId = inv.milestone_id ? String(inv.milestone_id) : null;

  // 기존 문서 판정 — 수동 업로드본이 있으면 절대 건드리지 않는다.
  const AUTO_SOURCES = new Set(["barobill_auto", "barobill_print"]);
  const priorDocs = rowsToObjects(
    await db.exec(
      `SELECT document_id, storage_key, source FROM contract_documents
        WHERE contract_id = $1 AND COALESCE(milestone_id, '') = COALESCE($2, '')
          AND document_type = 'tax_invoice'`,
      [contractId, milestoneId]
    )
  );
  if (priorDocs.some((d) => !AUTO_SOURCES.has(String(d.source ?? "")))) return { saved: false, reason: "manual-exists" };
  if (priorDocs.length && !opts.force) return { saved: false, reason: "already" };

  // 공급받는자 상세(대표자·주소)는 tax_invoices 에 없다 — 사업장 마스터에서 보강.
  const facilityId = inv.invoicee_facility_id ? String(inv.invoicee_facility_id) : null;
  const facilityRows = facilityId
    ? rowsToObjects(
        await db.exec(
          `SELECT representative_name, site_address FROM facilities WHERE facility_id = $1`,
          [facilityId]
        )
      )
    : [];
  const profile = await getCompanyProfile();

  const rawItems = typeof inv.line_items === "string" ? JSON.parse(inv.line_items) : inv.line_items;
  const items = (Array.isArray(rawItems) ? (rawItems as LineItem[]) : []).map((it) => ({
    date: it.purchaseExpiry ? String(it.purchaseExpiry) : undefined,
    name: String(it.name ?? ""),
    spec: it.description ? String(it.description) : undefined,
    qty: it.chargeableUnit ? String(it.chargeableUnit) : undefined,
    unitPrice: it.unitPrice != null && it.unitPrice !== "" ? Number(it.unitPrice) : undefined,
    amount: Number(it.amount ?? 0),
    tax: Number(it.tax ?? 0),
  }));

  const renderInput = {
    ntsSendKey: inv.nts_send_key ? String(inv.nts_send_key) : null,
    mgtKey: String(inv.mgt_key),
    writeDate: String(inv.write_date),
    amountTotal: Number(inv.amount_total ?? 0),
    taxTotal: Number(inv.tax_total ?? 0),
    totalAmount: Number(inv.total_amount ?? 0),
    taxType: Number(inv.tax_type ?? 1),
    purposeType: Number(inv.purpose_type ?? 2),
    modifyReason: inv.modify_code ? MODIFY_REASON_LABELS[String(inv.modify_code)] ?? "수정발급" : null,
    invoicer: {
      corpNum: profile.bizRegNo,
      corpName: toPlainCompanyName(profile.companyName),
      ceoName: profile.ceoName,
      addr: profile.address,
      bizType: profile.bizField,
      bizClass: profile.mainBusiness,
      email: process.env.BAROBILL_INVOICER_EMAIL || undefined,
    },
    invoicee: {
      corpNum: String(inv.invoicee_corp_num ?? ""),
      corpName: String(inv.invoicee_corp_name ?? ""),
      ceoName: facilityRows.length ? String(facilityRows[0].representative_name ?? "") : undefined,
      addr: facilityRows.length ? String(facilityRows[0].site_address ?? "") : undefined,
      email: inv.invoicee_email ? String(inv.invoicee_email) : undefined,
    },
    items,
    issuedAt: inv.issued_at ? String(inv.issued_at) : null,
  };
  // 주 경로: 바로빌 인쇄 화면을 Chromium 으로 그대로 PDF 캡처(국세청 양식과 동일).
  let buffer: Buffer | null = null;
  let viaCapture = false;
  try {
    const printUrl = await getTaxInvoicePrintUrl(String(inv.mgt_key));
    const captured = await renderUrlToPdf(printUrl);
    if (captured) {
      buffer = Buffer.from(captured);
      viaCapture = true;
    }
  } catch (err) {
    console.warn("[tax-invoice] 바로빌 인쇄 화면 캡처 실패 — 양식 폴백:", (err as Error).message);
  }
  // 업그레이드 모드(양식 렌더본 교체)는 캡처가 성공했을 때만 진행 — 실패 시 기존 것을 유지한다.
  if (!buffer && opts.requireCapture) return { saved: false, reason: "capture-failed" };
  // 폴백 1: 홈택스 양식 XLSX → converter(LibreOffice) PDF 변환.
  if (!buffer) {
    try {
      const xlsx = await buildTaxInvoiceXlsx(renderInput);
      const converted = await convertOfficeToPdf(
        xlsx,
        "tax-invoice.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      if (converted) buffer = Buffer.from(converted);
    } catch (err) {
      console.warn("[tax-invoice] XLSX 생성 실패 — pdf-lib 폴백:", (err as Error).message);
    }
  }
  // 폴백 2: pdf-lib 직접 렌더.
  if (!buffer) buffer = Buffer.from(await renderTaxInvoicePdf(renderInput));

  const issueDate = String(inv.write_date);
  const { storageKey, fileName: storedName } = getInvoiceStorageKey({
    issueDate,
    contractTitle: String(inv.contract_title ?? "").trim(),
    stageLabel: inv.stage_label ? String(inv.stage_label).trim() : null,
  });
  const stored = await putContractDocument(storageKey, buffer, "application/pdf");
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const documentId = "doc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const recordId = "inv_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const now = new Date().toISOString();
  const date = new Date(issueDate + "T00:00:00");
  const fiscalYear = date.getFullYear();
  const fiscalQuarter = Math.floor(date.getMonth() / 3) + 1;

  await withDbWrite(async (tx) => {
    // 기존 자동 생성본 교체(수동본은 위에서 이미 걸렀다) — 함수 초입 스냅샷(priorDocs)이 아니라
    // 트랜잭션 안에서 조건으로 지운다. 화면 갱신이 겹쳐 backfill 이 동시 실행되면 스냅샷 방식은
    // 서로의 새 문서를 못 보고 각자 INSERT 해 계산서가 중복으로 남았다(2026-08-26 실사례).
    await tx.run(
      `DELETE FROM contract_invoices WHERE document_id IN (
         SELECT document_id FROM contract_documents
          WHERE contract_id = $1 AND COALESCE(milestone_id, '') = COALESCE($2, '')
            AND document_type = 'tax_invoice' AND source IN ('barobill_auto', 'barobill_print'))`,
      [contractId, milestoneId]
    );
    await tx.run(
      `DELETE FROM contract_documents
        WHERE contract_id = $1 AND COALESCE(milestone_id, '') = COALESCE($2, '')
          AND document_type = 'tax_invoice' AND source IN ('barobill_auto', 'barobill_print')`,
      [contractId, milestoneId]
    );
    await tx.run(
      `INSERT INTO contract_documents
        (document_id, contract_id, milestone_id, document_type, display_name,
         original_filename, content_type, byte_size, sha256,
         storage_provider, storage_bucket, storage_key, public_path, source,
         created_by, created_at, updated_at)
       VALUES
        ($1, $2, $3, 'tax_invoice', $4,
         $5, 'application/pdf', $6, $7,
         $8, $9, $10, $11, '${viaCapture ? "barobill_print" : "barobill_auto"}',
         $12, $13, $13)`,
      [
        documentId,
        contractId,
        milestoneId,
        storedName,
        storedName,
        buffer.length,
        hash,
        stored.storageProvider,
        stored.storageBucket,
        stored.storageKey,
        stored.publicPath,
        inv.issued_by ? String(inv.issued_by) : null,
        now,
      ]
    );
    await tx.run(
      `INSERT INTO contract_invoices
        (invoice_id, contract_id, milestone_id, document_id, issue_date,
         fiscal_year, fiscal_quarter, invoice_amount, supply_amount, vat_amount,
         payment_collected, payment_collected_at, issued_via, memo,
         created_by, created_at, updated_at)
       VALUES
        ($1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         0, NULL, '${viaCapture ? "barobill_print" : "barobill_auto"}', NULL,
         $11, $12, $12)`,
      [
        recordId,
        contractId,
        milestoneId,
        documentId,
        issueDate,
        fiscalYear,
        fiscalQuarter,
        Math.round(Number(inv.total_amount ?? 0)),
        Math.round(Number(inv.amount_total ?? 0)),
        Math.round(Number(inv.tax_total ?? 0)),
        inv.issued_by ? String(inv.issued_by) : null,
        now,
      ]
    );
  });
  return { saved: true };
}

/**
 * PDF 미보관 발행분 일괄 생성 + 양식 렌더본(barobill_auto)의 바로빌 캡처본 업그레이드.
 * 재무 화면의 상태 갱신(refresh) 흐름에 얹혀 실행된다.
 * 해당 단계에 수동본이 있으면 대상에서 빠지고, 업그레이드는 캡처 성공 시에만 교체된다.
 */
export async function backfillInvoicePdfs(limit = 50): Promise<{ checked: number; saved: number }> {
  const db = await getDb();
  const missing = rowsToObjects(
    await db.exec(
      `SELECT t.invoice_id FROM tax_invoices t
        WHERE t.canceled_at IS NULL AND t.contract_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM contract_documents d
             WHERE d.contract_id = t.contract_id
               AND COALESCE(d.milestone_id, '') = COALESCE(t.milestone_id, '')
               AND d.document_type = 'tax_invoice')
        ORDER BY t.created_at ASC LIMIT $1`,
      [limit]
    )
  );
  // 양식 렌더본으로 저장된 건 — 바로빌 인쇄 화면 캡처본으로 교체 대상(barobill_print 는 이미 최종).
  const upgradable = rowsToObjects(
    await db.exec(
      `SELECT t.invoice_id FROM tax_invoices t
        WHERE t.canceled_at IS NULL AND t.contract_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM contract_documents d
             WHERE d.contract_id = t.contract_id
               AND COALESCE(d.milestone_id, '') = COALESCE(t.milestone_id, '')
               AND d.document_type = 'tax_invoice' AND d.source = 'barobill_auto')
        ORDER BY t.created_at ASC LIMIT $1`,
      [limit]
    )
  );
  let saved = 0;
  for (const row of missing) {
    try {
      const result = await archiveTaxInvoicePdf(String(row.invoice_id));
      if (result.saved) saved += 1;
    } catch (err) {
      console.warn("[tax-invoice] PDF 백필 실패:", String(row.invoice_id), (err as Error).message);
    }
  }
  for (const row of upgradable) {
    try {
      const result = await archiveTaxInvoicePdf(String(row.invoice_id), { force: true, requireCapture: true });
      if (result.saved) saved += 1;
    } catch (err) {
      console.warn("[tax-invoice] 캡처본 업그레이드 실패:", String(row.invoice_id), (err as Error).message);
    }
  }
  return { checked: missing.length + upgradable.length, saved };
}
