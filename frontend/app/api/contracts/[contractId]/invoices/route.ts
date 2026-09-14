import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import {
  deleteContractDocument,
  getInvoiceStorageKey,
  putContractDocument,
  sanitizeFilename,
} from "@/lib/storage/contract-document-storage";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
    const form = await req.formData();
    const file = form.get("file");
    const issueDate = String(form.get("issueDate") ?? "").trim();
    const milestoneId = String(form.get("milestoneId") ?? "").trim() || null;
    // 복수 등록 — 하나의 세금계산서를 여러 대금 지급 단계에 함께 등록한다(발행일·PDF·지급조건 공통).
    // 발행금액은 대표 단계만 입력값을 쓰고 나머지는 각 단계 금액을 그대로 쓴다. 수금 정보도 대표 단계에만 남긴다.
    const extraMilestoneIds = String(form.get("milestoneIds") ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v && v !== milestoneId);
    const invoiceAmount = toNullableNumber(form.get("invoiceAmount"));
    const supplyAmount = toNullableNumber(form.get("supplyAmount"));
    const vatAmount = toNullableNumber(form.get("vatAmount"));
    const paymentCollected = String(form.get("paymentCollected") ?? "0") === "1";
    const paymentCollectedAt = String(form.get("paymentCollectedAt") ?? "").trim() || null;
    const collectionRatio = toNullableNumber(form.get("collectionRatio"));
    const collectedAmount = toNullableNumber(form.get("collectedAmount"));
    const paymentTerms = String(form.get("paymentTerms") ?? "").trim() || null;
    const partialPaymentMemo = String(form.get("partialPaymentMemo") ?? "").trim() || null;
    // 실적 정산(준공금 등 최종 단계 전용). 폼에 키가 없으면 기존 값을 유지한다.
    const settlementAmount = form.has("settlementAmount") ? toNullableNumber(form.get("settlementAmount")) : undefined;
    const memo = String(form.get("memo") ?? "").trim() || null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "세금계산서 PDF 파일이 필요합니다." }, { status: 400 });
    }
    if (!issueDate || Number.isNaN(new Date(issueDate + "T00:00:00").getTime())) {
      return NextResponse.json({ error: "계산서 발행일이 필요합니다." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "세금계산서 PDF는 20MB 이하만 업로드할 수 있습니다." }, { status: 400 });
    }
    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const originalName = sanitizeFilename(file.name || "invoice.pdf");

    // Look up the contract title (and optional stage label) so the stored
    // filename mirrors the V:\계약\매출계산서 naming convention:
    //   (YYYY-MM-DD){contractTitle} {stageLabel} 세금계산서.pdf
    const db = await getDb();
    const contractRows = rowsToObjects(
      await db.exec("SELECT contract_title FROM contracts WHERE contract_id = $1", [contractId])
    );
    if (contractRows.length === 0) {
      return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    }
    const contractTitle = String(contractRows[0]?.contract_title ?? "").trim();

    // 대표 단계(모달을 연 단계) + 추가 선택 단계. 단계 미지정 업로드(계약 단위)도 그대로 지원한다.
    const targets: Array<{ id: string | null; isPrimary: boolean }> = [
      { id: milestoneId, isPrimary: true },
      ...extraMilestoneIds.map((id) => ({ id, isPrimary: false })),
    ];
    const results: Array<{ milestoneId: string | null; invoiceId: string; documentId: string; publicPath: string }> = [];

    for (const target of targets) {
      const targetMilestoneId = target.id;
      let targetStageLabel: string | null = null;
      // 발행금액 — 대표 단계는 화면 입력값, 함께 등록하는 단계는 각자의 단계 금액을 쓴다.
      let targetInvoiceAmount = invoiceAmount;
      if (targetMilestoneId) {
        const milestoneRows = rowsToObjects(
          await db.exec(
            "SELECT stage_label, amount, invoice_amount FROM contract_payment_milestones WHERE milestone_id = $1 AND contract_id = $2",
            [targetMilestoneId, contractId]
          )
        );
        if (milestoneRows.length === 0) continue; // 다른 계약의 단계가 섞여 들어온 경우
        targetStageLabel = String(milestoneRows[0]?.stage_label ?? "").trim() || null;
        if (!target.isPrimary) {
          const amt = milestoneRows[0]?.invoice_amount ?? milestoneRows[0]?.amount;
          targetInvoiceAmount = amt == null ? null : Number(amt);
        }
      }
      // 수금·실적 정산은 대표 단계에만 반영한다(단계마다 수금일·금액이 달라 일괄 적용하면 원장이 틀어진다).
      const applyCollection = target.isPrimary && paymentCollected;

      // 같은 대금지급단위(milestone)의 기존 계산서는 교체 대상 — 기존 파일의 storage_key 수집(S3 정리용)
      const priorStorageKeys: string[] = [];
      if (targetMilestoneId) {
        const priorDocs = rowsToObjects(
          await db.exec(
            `SELECT storage_key FROM contract_documents
              WHERE contract_id = $1 AND milestone_id = $2 AND document_type = 'tax_invoice'`,
            [contractId, targetMilestoneId]
          )
        );
        for (const r of priorDocs) {
          const k = r.storage_key != null ? String(r.storage_key) : "";
          if (k) priorStorageKeys.push(k);
        }
      }

      const { storageKey, fileName: storedName } = getInvoiceStorageKey({
        issueDate,
        contractTitle,
        stageLabel: targetStageLabel,
      });
      const stored = await putContractDocument(storageKey, buffer, file.type || "application/pdf");
      const documentId = "doc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const invoiceId = "inv_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const now = new Date().toISOString();
      const date = new Date(issueDate + "T00:00:00");
      const fiscalYear = date.getFullYear();
      const fiscalQuarter = Math.floor(date.getMonth() / 3) + 1;
      const partialPaymentJson = applyCollection
        ? JSON.stringify([
            {
              id: "invoice_" + invoiceId.slice(-12),
              collectedAt: paymentCollectedAt,
              amount: collectedAmount ?? targetInvoiceAmount ?? 0,
              ratio: collectionRatio ?? null,
              memo: partialPaymentMemo,
              recordedBy: actor.userId,
              recordedAt: now,
            },
          ])
        : null;

      await withDbWrite(async (db2) => {
        // 같은 대금지급단위의 기존 계산서(인보이스+문서)는 삭제 후 새 파일로 교체
        if (targetMilestoneId) {
          await db2.run(
            "DELETE FROM contract_invoices WHERE contract_id = $1 AND milestone_id = $2",
            [contractId, targetMilestoneId]
          );
          await db2.run(
            "DELETE FROM contract_documents WHERE contract_id = $1 AND milestone_id = $2 AND document_type = 'tax_invoice'",
            [contractId, targetMilestoneId]
          );
        }
        await db2.run(
          `INSERT INTO contract_documents
            (document_id, contract_id, milestone_id, document_type, display_name,
             original_filename, content_type, byte_size, sha256,
             storage_provider, storage_bucket, storage_key, public_path, source,
             created_by, created_at, updated_at)
           VALUES
            ($1, $2, $3, 'tax_invoice', $4,
             $5, $6, $7, $8,
             $9, $10, $11, $12, 'manual_upload',
             $13, $14, $15)`,
          [
            documentId,
            contractId,
            targetMilestoneId,
            storedName,
            originalName,
            file.type || "application/pdf",
            file.size,
            hash,
            stored.storageProvider,
            stored.storageBucket,
            stored.storageKey,
            stored.publicPath,
            actor.userId,
            now,
            now,
          ]
        );
        await db2.run(
          `INSERT INTO contract_invoices
            (invoice_id, contract_id, milestone_id, document_id, issue_date,
             fiscal_year, fiscal_quarter, invoice_amount, supply_amount, vat_amount,
             payment_collected, payment_collected_at, issued_via, memo,
             created_by, created_at, updated_at)
           VALUES
            ($1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10,
             $11, $12, 'manual_pdf', $13,
             $14, $15, $16)`,
          [
            invoiceId,
            contractId,
            targetMilestoneId,
            documentId,
            issueDate,
            fiscalYear,
            fiscalQuarter,
            targetInvoiceAmount,
            target.isPrimary ? supplyAmount : null,
            target.isPrimary ? vatAmount : null,
            applyCollection ? 1 : 0,
            applyCollection ? paymentCollectedAt : null,
            memo,
            actor.userId,
            now,
            now,
          ]
        );
        if (targetMilestoneId) {
          await db2.run(
            `UPDATE contract_payment_milestones
             SET invoice_issued = 1,
                 invoice_issued_at = $1,
                 invoice_amount = COALESCE($2, invoice_amount, amount),
                 payment_collected = $3,
                 payment_collected_at = COALESCE($4, payment_collected_at),
                 collection_ratio = CASE WHEN $3 = 1 THEN COALESCE($5, collection_ratio, 1.0) ELSE collection_ratio END,
                 collected_amount = CASE WHEN $3 = 1 THEN COALESCE($6, $2, collected_amount, amount) ELSE collected_amount END,
                payment_terms = COALESCE($7, payment_terms),
                partial_payments_json = CASE
                  WHEN $3 = 1 AND $8::jsonb IS NOT NULL
                    THEN COALESCE(partial_payments_json, '[]'::jsonb) || $8::jsonb
                  ELSE partial_payments_json
                END,
                settlement_amount = CASE WHEN $12::boolean THEN $13 ELSE settlement_amount END,
                updated_at = $9
             WHERE milestone_id = $10
               AND contract_id = $11`,
            [
              issueDate,
              targetInvoiceAmount,
              applyCollection ? 1 : 0,
              applyCollection ? paymentCollectedAt : null,
              applyCollection ? collectionRatio : null,
              applyCollection ? collectedAmount : null,
              paymentTerms,
              partialPaymentJson,
              now,
              targetMilestoneId,
              contractId,
              target.isPrimary && settlementAmount !== undefined,
              settlementAmount ?? null,
            ]
          );
        }
        await recordAuditLogInline(db2, {
          actorUserId: actor.userId,
          action: "contract_invoice_upload",
          targetTable: "contract_invoices",
          targetId: invoiceId,
          after: {
            contractId,
            milestoneId: targetMilestoneId,
            issueDate,
            invoiceAmount: targetInvoiceAmount,
            documentId,
            storageKey,
            partialPaymentMemo,
            bulk: targets.length > 1,
          },
        });
      });

      // 교체된 기존 파일의 S3/로컬 객체 정리 (새 파일과 키가 같으면 건너뜀 — 방금 올린 파일 보호)
      for (const oldKey of priorStorageKeys) {
        if (oldKey !== stored.storageKey) await deleteContractDocument(oldKey);
      }

      results.push({ milestoneId: targetMilestoneId, invoiceId, documentId, publicPath: stored.publicPath });
    }

    if (results.length === 0) {
      return NextResponse.json({ error: "등록 대상 대금 지급 단계를 찾을 수 없습니다." }, { status: 400 });
    }
    return NextResponse.json({ ...results[0], results, count: results.length });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function toNullableNumber(value: FormDataEntryValue | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
