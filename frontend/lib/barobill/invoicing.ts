// 전자세금계산서 발행 도메인 (P4 F5) — 프리필 · 발행 · 상태 갱신 · 취소
// 발행 성공 시 기존 수금 모델을 그대로 갱신한다(milestone.invoice_issued/at/amount) → 미수금·발행요청 화면 무수정 호환.

import { createHash } from "node:crypto";
import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";
import { getCompanyProfile } from "@/lib/company/profile";
import {
  registAndIssueTaxInvoice,
  getTaxInvoiceState,
  getTaxInvoicePopUpUrl,
  deleteTaxInvoice,
  checkCertValid,
  toPlainCompanyName,
  type TaxInvoiceInput,
} from "@/lib/barobill/tax-invoice";
import { getBarobillConfig } from "@/lib/barobill/client";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
const ymd = (isoDate: string) => isoDate.replace(/[^0-9]/g, "").slice(0, 8);

/** 연동사 부여 문서번호(≤24자, 계정 내 유일). 재발행·취소 후 재시도를 위해 시각 해시를 섞는다. */
function newMgtKey(milestoneId: string): string {
  const stamp = KST_NOW().replace(/[^0-9]/g, "").slice(2, 12); // YYMMDDHHMM
  const tail = createHash("sha256").update(`${milestoneId}:${stamp}`).digest("hex").slice(0, 6).toUpperCase();
  return `MCM${stamp}${tail}`; // 3 + 10 + 6 = 19자
}

export interface IssuePrefillContact {
  name: string;
  title: string | null;
  email: string | null;
  tel: string | null;
  mobile: string | null;
}

export interface IssuePrefill {
  contractId: string;
  milestoneId: string;
  contractTitle: string;
  stageLabel: string;
  /** 단계 금액 원본 — 부가세 포함 여부는 사용자가 화면에서 고른다(§8 논점 3). */
  stageAmount: number;
  writeDate: string; // YYYY-MM-DD (오늘)
  invoicer: { corpNum: string; corpName: string; ceoName: string; addr: string; bizClass: string; bizType: string; tel: string; contactId: string; contactName: string; email: string };
  invoicee: { facilityId: string | null; corpNum: string; corpName: string; ceoName: string; addr: string };
  contacts: IssuePrefillContact[];
  /** 이미 발행된 계산서(재발행 경고용). */
  existing: TaxInvoiceRow[];
  cert: { ok: boolean; message: string };
}

export interface TaxInvoiceRow {
  invoiceId: string;
  mgtKey: string;
  milestoneId: string | null;
  writeDate: string;
  amountTotal: number;
  taxTotal: number;
  totalAmount: number;
  invoiceeCorpName: string | null;
  invoiceeEmail: string | null;
  barobillState: number | null;
  ntsSendState: number | null;
  ntsSendKey: string | null;
  issuedAt: string | null;
  canceledAt: string | null;
}

function mapInvoice(r: Record<string, unknown>): TaxInvoiceRow {
  return {
    invoiceId: String(r.invoice_id),
    mgtKey: String(r.mgt_key),
    milestoneId: r.milestone_id ? String(r.milestone_id) : null,
    writeDate: String(r.write_date ?? ""),
    amountTotal: Number(r.amount_total || 0),
    taxTotal: Number(r.tax_total || 0),
    totalAmount: Number(r.total_amount || 0),
    invoiceeCorpName: r.invoicee_corp_name ? String(r.invoicee_corp_name) : null,
    invoiceeEmail: r.invoicee_email ? String(r.invoicee_email) : null,
    barobillState: r.barobill_state == null ? null : Number(r.barobill_state),
    ntsSendState: r.nts_send_state == null ? null : Number(r.nts_send_state),
    ntsSendKey: r.nts_send_key ? String(r.nts_send_key) : null,
    issuedAt: r.issued_at ? String(r.issued_at) : null,
    canceledAt: r.canceled_at ? String(r.canceled_at) : null,
  };
}

export async function listContractInvoices(contractId: string): Promise<TaxInvoiceRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT invoice_id, mgt_key, milestone_id, write_date, amount_total, tax_total, total_amount,
              invoicee_corp_name, invoicee_email, barobill_state, nts_send_state, nts_send_key, issued_at, canceled_at
         FROM tax_invoices WHERE contract_id = $1 ORDER BY created_at DESC`,
      [contractId],
    ),
  );
  return rows.map(mapInvoice);
}

export interface TaxInvoiceListRow extends TaxInvoiceRow {
  contractId: string | null;
  contractTitle: string | null;
  stageLabel: string | null;
}

/** 재무 보드 세금계산서 탭 — 최근 발행분 전체(계약·단계 라벨 포함). */
export async function listRecentInvoices(limit = 100): Promise<TaxInvoiceListRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT t.invoice_id, t.mgt_key, t.milestone_id, t.write_date, t.amount_total, t.tax_total, t.total_amount,
              t.invoicee_corp_name, t.invoicee_email, t.barobill_state, t.nts_send_state, t.nts_send_key,
              t.issued_at, t.canceled_at, t.contract_id,
              c.contract_title, m.stage_label
         FROM tax_invoices t
         LEFT JOIN contracts c ON c.contract_id = t.contract_id
         LEFT JOIN contract_payment_milestones m ON m.milestone_id = t.milestone_id
        ORDER BY t.created_at DESC
        LIMIT ${Math.min(limit, 300)}`,
    ),
  );
  return rows.map((r) => ({
    ...mapInvoice(r),
    contractId: r.contract_id ? String(r.contract_id) : null,
    contractTitle: r.contract_title ? String(r.contract_title) : null,
    stageLabel: r.stage_label ? String(r.stage_label) : null,
  }));
}

/** 발행 모달 프리필 — 공급자는 회사 프로필, 공급받는자는 계약 발주처(facilities) + 담당자 연락처. */
export async function buildIssuePrefill(contractId: string, milestoneId: string): Promise<IssuePrefill> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT m.milestone_id, m.stage_label, m.amount, m.invoice_amount,
              c.contract_title, c.counterparty_facility_id,
              f.company_name, f.normalized_company_name, f.business_registration_no, f.representative_name, f.site_address
         FROM contract_payment_milestones m
         JOIN contracts c ON c.contract_id = m.contract_id
         LEFT JOIN facilities f ON f.facility_id = c.counterparty_facility_id
        WHERE m.milestone_id = $1 AND m.contract_id = $2`,
      [milestoneId, contractId],
    ),
  );
  if (!rows.length) throw Object.assign(new Error("계약 단계를 찾을 수 없습니다."), { status: 404 });
  const row = rows[0];
  const facilityId = row.counterparty_facility_id ? String(row.counterparty_facility_id) : null;

  const contactRows = facilityId
    ? rowsToObjects(
        await db.exec(
          `SELECT person_name, title, email, office_phone, mobile_phone
             FROM facility_contact_people
            WHERE facility_id = $1 AND status = 'active'
            ORDER BY (email IS NULL), person_name`,
          [facilityId],
        ),
      )
    : [];

  const [profile, cert] = await Promise.all([
    getCompanyProfile(),
    checkCertValid().catch((err) => ({ ok: false, code: null, message: (err as Error).message })),
  ]);
  const cfg = getBarobillConfig();

  return {
    contractId,
    milestoneId,
    contractTitle: String(row.contract_title ?? ""),
    stageLabel: String(row.stage_label ?? ""),
    stageAmount: Number(row.invoice_amount ?? row.amount ?? 0),
    writeDate: new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10),
    invoicer: {
      corpNum: (profile.bizRegNo || cfg.corpNum).replace(/[^0-9]/g, ""),
      corpName: toPlainCompanyName(profile.companyName),
      ceoName: profile.ceoName ?? "",
      addr: profile.address ?? "",
      bizClass: profile.mainBusiness ?? "",
      bizType: profile.bizField ?? "",
      tel: profile.phone ?? "",
      contactId: cfg.id,
      contactName: profile.ceoName ?? "",
      email: process.env.BAROBILL_INVOICER_EMAIL || "",
    },
    invoicee: {
      facilityId,
      corpNum: String(row.business_registration_no ?? "").replace(/[^0-9]/g, ""),
      corpName: toPlainCompanyName(String(row.normalized_company_name || row.company_name || "")),
      ceoName: String(row.representative_name ?? ""),
      addr: String(row.site_address ?? ""),
    },
    contacts: contactRows.map((c) => ({
      name: String(c.person_name ?? ""),
      title: c.title ? String(c.title) : null,
      email: c.email ? String(c.email) : null,
      tel: c.office_phone ? String(c.office_phone) : null,
      mobile: c.mobile_phone ? String(c.mobile_phone) : null,
    })),
    existing: (await listContractInvoices(contractId)).filter((inv) => inv.milestoneId === milestoneId),
    cert: { ok: cert.ok, message: cert.message },
  };
}

export interface IssueParams {
  contractId: string;
  milestoneId: string;
  writeDate: string; // YYYY-MM-DD
  supplyDate?: string; // 공급일자(품목) — 미지정 시 작성일자
  amountTotal: number; // 공급가액
  taxTotal: number;
  totalAmount: number;
  taxType?: number;
  purposeType?: number;
  itemName: string;
  itemDescription?: string;
  remark1?: string;
  invoicee: { facilityId?: string | null; corpNum: string; corpName: string; ceoName?: string; addr?: string; contactName?: string; email: string; tel?: string; hp?: string };
  invoicer: { corpNum: string; corpName: string; ceoName?: string; addr?: string; bizClass?: string; bizType?: string; contactName?: string; tel?: string; email: string };
  sendSms?: boolean;
  forceIssue?: boolean;
}

/** 발행 — 바로빌 호출 성공 후에만 DB에 남긴다(실패 시 흔적 없음). */
export async function issueTaxInvoice(params: IssueParams, actorUserId: string | null): Promise<{ invoiceId: string; mgtKey: string }> {
  if (!/^\d{10}$/.test(params.invoicee.corpNum)) throw Object.assign(new Error("공급받는자 사업자번호가 10자리가 아닙니다."), { status: 400 });
  if (!/^\d{10}$/.test(params.invoicer.corpNum)) throw Object.assign(new Error("공급자 사업자번호가 10자리가 아닙니다."), { status: 400 });
  if (!params.invoicee.email) throw Object.assign(new Error("공급받는자 이메일이 필요합니다(계산서 수신처)."), { status: 400 });
  if (!params.invoicer.email) throw Object.assign(new Error("공급자 이메일이 필요합니다(바로빌 필수값)."), { status: 400 });
  if (Math.round(params.amountTotal + params.taxTotal) !== Math.round(params.totalAmount)) {
    throw Object.assign(new Error("공급가액 + 세액이 합계금액과 맞지 않습니다."), { status: 400 });
  }
  if (params.totalAmount <= 0) throw Object.assign(new Error("금액이 0원입니다."), { status: 400 });

  const mgtKey = newMgtKey(params.milestoneId);
  const writeDate = ymd(params.writeDate);
  const supplyDate = ymd(params.supplyDate || params.writeDate);
  const amount = String(Math.round(params.amountTotal));
  const tax = String(Math.round(params.taxTotal));
  const total = String(Math.round(params.totalAmount));

  const input: TaxInvoiceInput = {
    invoicer: {
      contactId: getBarobillConfig().id,
      corpNum: params.invoicer.corpNum,
      mgtNum: mgtKey, // 정발급은 공급자 측 문서번호가 곧 MgtKey
      corpName: params.invoicer.corpName,
      ceoName: params.invoicer.ceoName,
      addr: params.invoicer.addr,
      bizClass: params.invoicer.bizClass,
      bizType: params.invoicer.bizType,
      contactName: params.invoicer.contactName,
      tel: params.invoicer.tel,
      email: params.invoicer.email,
    },
    invoicee: {
      corpNum: params.invoicee.corpNum,
      corpName: params.invoicee.corpName,
      ceoName: params.invoicee.ceoName,
      addr: params.invoicee.addr,
      contactName: params.invoicee.contactName,
      tel: params.invoicee.tel,
      hp: params.invoicee.hp,
      email: params.invoicee.email,
    },
    taxType: params.taxType ?? 1,
    purposeType: params.purposeType ?? 2,
    writeDate,
    amountTotal: amount,
    taxTotal: tax,
    totalAmount: total,
    remark1: params.remark1,
    items: [
      {
        purchaseExpiry: supplyDate,
        name: params.itemName.slice(0, 100),
        chargeableUnit: "1",
        unitPrice: amount,
        amount,
        tax,
        description: params.itemDescription?.slice(0, 100),
      },
    ],
  };

  await registAndIssueTaxInvoice(input, {
    sendSms: params.sendSms,
    forceIssue: params.forceIssue,
    mailTitle: `[세금계산서] ${params.invoicer.corpName} → ${params.invoicee.corpName}`,
  });

  const invoiceId = `ti-${createHash("sha256").update(mgtKey).digest("hex").slice(0, 12)}`;
  const now = KST_NOW();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO tax_invoices
         (invoice_id, mgt_key, contract_id, milestone_id, direction, write_date,
          amount_total, tax_total, total_amount, tax_type, purpose_type,
          invoicee_facility_id, invoicee_corp_num, invoicee_corp_name, invoicee_email,
          line_items, barobill_state, issued_by, issued_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'sales', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, 3014, $16, $17, $17, $17)`,
      [
        invoiceId,
        mgtKey,
        params.contractId,
        params.milestoneId,
        params.writeDate,
        Math.round(params.amountTotal),
        Math.round(params.taxTotal),
        Math.round(params.totalAmount),
        params.taxType ?? 1,
        params.purposeType ?? 2,
        params.invoicee.facilityId ?? null,
        params.invoicee.corpNum,
        params.invoicee.corpName,
        params.invoicee.email,
        JSON.stringify(input.items),
        actorUserId,
        now,
      ],
    );
    // 기존 수금 모델 반영 — 발행요청 해소·미수금 집계가 그대로 따라온다.
    await db.run(
      `UPDATE contract_payment_milestones
          SET invoice_issued = 1, invoice_issued_at = $2, invoice_amount = $3, updated_at = $4
        WHERE milestone_id = $1`,
      [params.milestoneId, params.writeDate, Math.round(params.totalAmount), new Date().toISOString()],
    );
  });

  return { invoiceId, mgtKey };
}

/** 상태 갱신 — 발행 후 국세청 전송은 바로빌이 일괄 처리(통상 익일)라 폴링이 필요하다. */
export async function refreshInvoiceStates(invoiceIds?: string[]): Promise<{ checked: number; updated: number }> {
  const db = await getDb();
  const rows = invoiceIds?.length
    ? rowsToObjects(await db.exec(`SELECT invoice_id, mgt_key FROM tax_invoices WHERE invoice_id = ANY($1::text[])`, [invoiceIds]))
    : rowsToObjects(
        await db.exec(
          `SELECT invoice_id, mgt_key FROM tax_invoices
            WHERE canceled_at IS NULL AND (nts_send_state IS NULL OR nts_send_state < 4)
            ORDER BY created_at DESC LIMIT 100`,
        ),
      );
  let updated = 0;
  for (const row of rows) {
    try {
      const state = await getTaxInvoiceState(String(row.mgt_key));
      await withDbWrite(async (tx) => {
        await tx.run(
          `UPDATE tax_invoices
              SET barobill_state = $2, nts_send_state = $3, nts_send_key = $4, nts_result = $5,
                  nts_send_dt = $6, is_opened = $7, raw_state_json = $8::jsonb, updated_at = $9
            WHERE invoice_id = $1`,
          [
            String(row.invoice_id),
            state.barobillState,
            state.ntsSendState,
            state.ntsSendKey,
            state.ntsSendResult,
            state.ntsSendDt,
            state.isOpened,
            JSON.stringify(state),
            KST_NOW(),
          ],
        );
      });
      updated += 1;
    } catch {
      // 개별 실패는 건너뛴다(다음 폴링에서 재시도).
    }
  }
  return { checked: rows.length, updated };
}

export async function invoicePopUpUrl(invoiceId: string): Promise<string> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT mgt_key FROM tax_invoices WHERE invoice_id = $1`, [invoiceId]));
  if (!rows.length) throw Object.assign(new Error("계산서를 찾을 수 없습니다."), { status: 404 });
  return getTaxInvoicePopUpUrl(String(rows[0].mgt_key));
}

/** 발행 취소(국세청 전송 전) — 성공 시 단계의 발행 플래그도 되돌린다. */
export async function cancelTaxInvoice(invoiceId: string): Promise<void> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT mgt_key, milestone_id, nts_send_state FROM tax_invoices WHERE invoice_id = $1`, [invoiceId]),
  );
  if (!rows.length) throw Object.assign(new Error("계산서를 찾을 수 없습니다."), { status: 404 });
  if (Number(rows[0].nts_send_state ?? 0) >= 4) {
    throw Object.assign(new Error("국세청 전송이 끝난 계산서는 취소할 수 없습니다(수정세금계산서로 정정)."), { status: 400 });
  }
  await deleteTaxInvoice(String(rows[0].mgt_key));
  const now = KST_NOW();
  await withDbWrite(async (tx) => {
    await tx.run(`UPDATE tax_invoices SET canceled_at = $2, barobill_state = 5031, updated_at = $2 WHERE invoice_id = $1`, [invoiceId, now]);
    if (rows[0].milestone_id) {
      await tx.run(
        `UPDATE contract_payment_milestones
            SET invoice_issued = 0, invoice_issued_at = NULL, updated_at = $2
          WHERE milestone_id = $1`,
        [String(rows[0].milestone_id), new Date().toISOString()],
      );
    }
  });
}
