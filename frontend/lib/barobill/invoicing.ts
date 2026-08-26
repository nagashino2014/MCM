// 전자세금계산서 발행 도메인 (P4 F5) — 프리필 · 발행 · 상태 갱신 · 취소
// 발행 성공 시 기존 수금 모델을 그대로 갱신한다(milestone.invoice_issued/at/amount) → 미수금·발행요청 화면 무수정 호환.

import { createHash } from "node:crypto";
import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";
import { getCompanyProfile } from "@/lib/company/profile";
import {
  registAndIssueTaxInvoice,
  registModifyTaxInvoice,
  getTaxInvoiceState,
  getTaxInvoicePopUpUrl,
  deleteTaxInvoice,
  checkCertValid,
  toPlainCompanyName,
  type TaxInvoiceInput,
} from "@/lib/barobill/tax-invoice";
import { getBarobillConfig } from "@/lib/barobill/client";
import { archiveTaxInvoicePdf } from "@/lib/barobill/invoice-archive";
import { sendNotifyEmail } from "@/lib/notify/email-ses";

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
  /** 사업장 담당자에 지정된 업무 분류 태그(계약/환경/계산서 — 187). */
  deptTypes: string[];
  /** '계산서' 태그가 켜진 담당자 = 이 사업장의 기본 계산서 수신처. */
  billing: boolean;
}

export interface IssuePrefill {
  contractId: string;
  milestoneId: string;
  contractTitle: string;
  stageLabel: string;
  /** 단계 금액 원본 — 부가세 포함 여부는 사용자가 화면에서 고른다(§8 논점 3). */
  stageAmount: number;
  /** 계약 총액 — 단계 비중(%) 산출 기준. */
  contractAmount: number;
  /** 비고 기본값 — "단계명 : 계약금액 대비 비중%". 품목에는 계약명만 남긴다. */
  defaultRemark: string;
  writeDate: string; // YYYY-MM-DD (오늘)
  invoicer: { corpNum: string; corpName: string; ceoName: string; addr: string; bizClass: string; bizType: string; tel: string; contactId: string; contactName: string; email: string };
  invoicee: { facilityId: string | null; corpNum: string; corpName: string; ceoName: string; addr: string; bizType: string; bizClass: string };
  contacts: IssuePrefillContact[];
  /** 저장해 둔 발행 담당자 이메일(188) — 모달 목록에서 골라 쓴다. env 기본값이 항상 첫 항목. */
  issuerEmails: Array<{ email: string; label: string | null }>;
  /** 이미 발행된 계산서(재발행 경고용). */
  existing: TaxInvoiceRow[];
  /**
   * 이 계약의 미청구 단계 목록(2026-08-24) — 복수 단계를 한 장으로 묶어 발행할 때
   * '청구 단계 추가' 선택지로 쓴다. 현재 열려 있는 단계도 포함된다.
   */
  openStages: Array<{ milestoneId: string; stageLabel: string; amount: number }>;
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

/**
 * 단계 비중(%) — amount_ratio 는 0~1 비율이지만 실데이터 대부분이 비어 있어(2026-08-18 실측)
 * 단계 금액 ÷ 계약 총액을 우선 쓴다. 소수 둘째 자리까지만 남긴다(30 / 33.33).
 */
function stageRatioPct(row: Record<string, unknown>): number | null {
  const contractAmount = Number(row.contract_amount ?? 0);
  const stageAmount = Number(row.invoice_amount ?? row.amount ?? 0);
  const pct =
    contractAmount > 0 && stageAmount > 0
      ? (stageAmount / contractAmount) * 100
      : row.amount_ratio != null
        ? Number(row.amount_ratio) * 100
        : NaN;
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return Math.round(pct * 100) / 100;
}

/** 비고 표기 — "준공금 : 100%". 비중을 못 구하면 단계명만 남긴다. */
function stageRemark(stageLabel: string, pct: number | null): string {
  const label = stageLabel.trim();
  if (!label) return "";
  return pct == null ? label : `${label} : ${pct}%`;
}

/** 저장된 발행 담당자 이메일 — env 기본값을 항상 맨 앞에 두고, 나머지는 최근 사용순. */
export async function listIssuerEmails(): Promise<Array<{ email: string; label: string | null }>> {
  const fallback = (process.env.BAROBILL_INVOICER_EMAIL || "").trim();
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT email, label FROM tax_invoice_issuer_emails
        ORDER BY COALESCE(used_at, created_at) DESC, email`,
    ),
  ).map((r) => ({ email: String(r.email ?? ""), label: r.label ? String(r.label) : null }));
  const saved = rows.filter((r) => r.email && r.email.toLowerCase() !== fallback.toLowerCase());
  return fallback ? [{ email: fallback, label: "기본(환경설정)" }, ...saved] : saved;
}

/** 발행 담당자 이메일 저장 — 같은 주소면 라벨만 갱신한다. */
export async function saveIssuerEmail(email: string, label: string | null, actorUserId: string | null): Promise<void> {
  const address = email.trim();
  if (!/.+@.+\..+/.test(address)) throw Object.assign(new Error("이메일 형식이 아닙니다."), { status: 400 });
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO tax_invoice_issuer_emails (email, label, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET label = EXCLUDED.label`,
      [address, label?.trim() || null, actorUserId],
    );
  });
}

export async function deleteIssuerEmail(email: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM tax_invoice_issuer_emails WHERE email = $1`, [email.trim()]);
  });
}

/** 발행 모달 프리필 — 공급자는 회사 프로필, 공급받는자는 계약 발주처(facilities) + 담당자 연락처. */
export async function buildIssuePrefill(contractId: string, milestoneId: string): Promise<IssuePrefill> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT m.milestone_id, m.stage_label, m.amount, m.invoice_amount, m.amount_ratio,
              c.contract_title, c.contract_amount, c.counterparty_facility_id,
              f.company_name, f.normalized_company_name, f.business_registration_no, f.representative_name, f.site_address,
              -- 공급받는자 업태·종목(2026-08-26) — 사업자등록증 파싱 값. 없으면 빈 값으로 발행된다.
              f.business_certificate_business_type, f.business_certificate_business_item
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
          `SELECT person_name, title, email, office_phone, mobile_phone,
                  COALESCE(NULLIF(dept_types, '{}'), CASE WHEN dept_type IS NULL THEN '{}' ELSE ARRAY[dept_type] END) AS dept_types
             FROM facility_contact_people
            WHERE facility_id = $1 AND status = 'active'
            ORDER BY (NOT ('billing' = ANY(COALESCE(dept_types, '{}')))), (email IS NULL), person_name`,
          [facilityId],
        ),
      )
    : [];

  const [profile, cert, issuerEmails] = await Promise.all([
    getCompanyProfile(),
    checkCertValid().catch((err) => ({ ok: false, code: null, message: (err as Error).message })),
    listIssuerEmails().catch(() => []),
  ]);
  const cfg = getBarobillConfig();

  return {
    contractId,
    milestoneId,
    contractTitle: String(row.contract_title ?? ""),
    stageLabel: String(row.stage_label ?? ""),
    stageAmount: Number(row.invoice_amount ?? row.amount ?? 0),
    contractAmount: Number(row.contract_amount ?? 0),
    defaultRemark: stageRemark(String(row.stage_label ?? ""), stageRatioPct(row)),
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
      // 바로빌 규약: BizType=업태 / BizClass=종목(공급자 매핑과 동일).
      bizType: String(row.business_certificate_business_type ?? ""),
      bizClass: String(row.business_certificate_business_item ?? ""),
    },
    issuerEmails,
    openStages: rowsToObjects(
      await db.exec(
        `SELECT milestone_id, stage_label, amount, invoice_amount
           FROM contract_payment_milestones
          WHERE contract_id = $1 AND COALESCE(invoice_issued, 0) = 0
          ORDER BY stage_order ASC`,
        [contractId],
      ),
    ).map((m) => ({
      milestoneId: String(m.milestone_id),
      stageLabel: String(m.stage_label ?? ""),
      amount: Number(m.invoice_amount ?? m.amount ?? 0),
    })),
    contacts: contactRows.map((c) => {
      const deptTypes = Array.isArray(c.dept_types) ? (c.dept_types as unknown[]).map((v) => String(v)) : [];
      return {
        name: String(c.person_name ?? ""),
        title: c.title ? String(c.title) : null,
        email: c.email ? String(c.email) : null,
        tel: c.office_phone ? String(c.office_phone) : null,
        mobile: c.mobile_phone ? String(c.mobile_phone) : null,
        deptTypes,
        billing: deptTypes.includes("billing"),
      };
    }),
    existing: (await listContractInvoices(contractId)).filter((inv) => inv.milestoneId === milestoneId),
    cert: { ok: cert.ok, message: cert.message },
  };
}

export interface IssueParams {
  contractId: string;
  milestoneId: string;
  /**
   * 묶음 발행(2026-08-24) — 이 계산서 한 장이 커버하는 단계 전체(milestoneId 포함).
   * 발행 성공 시 전부 발행 완료로 마킹된다(invoice_amount 는 각 단계 자체 금액).
   * 미지정이면 milestoneId 한 단계만 마킹(기존 동작).
   */
  milestoneIds?: string[];
  writeDate: string; // YYYY-MM-DD
  supplyDate?: string; // 공급일자(품목) — 미지정 시 작성일자
  amountTotal: number; // 공급가액
  taxTotal: number;
  totalAmount: number;
  taxType?: number;
  purposeType?: number;
  itemName: string;
  itemDescription?: string;
  /**
   * 품목 행 — 홈택스처럼 여러 줄로 발행할 때 쓴다(품목명·규격·수량·단가·공급가액).
   * 미지정이면 itemName + 총 공급가액으로 1행을 만든다(기존 단일 품목 동작).
   */
  items?: Array<{ name: string; spec?: string; qty?: number; unitPrice?: number; amount: number; tax?: number }>;
  remark1?: string;
  /** email = 대표 수신처(바로빌이 메일 발송), ccEmails = 추가 수신처(발행 후 앱이 안내 메일 발송). */
  invoicee: { facilityId?: string | null; corpNum: string; corpName: string; ceoName?: string; addr?: string; bizType?: string; bizClass?: string; contactName?: string; email: string; tel?: string; hp?: string; ccEmails?: string[] };
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
  const lines = (params.items ?? []).filter((it) => it.name.trim() && Math.round(it.amount) !== 0);
  if (lines.length) {
    const lineSupply = lines.reduce((acc, it) => acc + Math.round(it.amount), 0);
    if (lineSupply !== Math.round(params.amountTotal)) {
      throw Object.assign(new Error("품목 공급가액 합계가 총 공급가액과 맞지 않습니다."), { status: 400 });
    }
  }

  // 추가 수신처 — 바로빌은 공급받는자 이메일을 1개만 받으므로(InvoiceeParty.Email),
  // 대표 수신처 외에는 발행 성공 후 앱(SES)이 안내 메일을 따로 보낸다.
  const ccEmails = Array.from(
    new Set(
      (params.invoicee.ccEmails ?? [])
        .map((e) => String(e).trim())
        .filter((e) => /.+@.+\..+/.test(e) && e.toLowerCase() !== params.invoicee.email.trim().toLowerCase()),
    ),
  );

  // 공급받는자 업태·종목 보강(2026-08-26 사용자 확정) — 사업장 마스터에 사업자등록증 기반
  // 업태·종목이 있으면 반드시 계산서에 실린다. 화면이 값을 안 보내던 회귀가 있어(한일스틸 실사례)
  // 서버에서 사업장(facilityId 우선, 없으면 사업자번호)으로 직접 조회해 채운다.
  let inBizType = String(params.invoicee.bizType ?? "").trim();
  let inBizClass = String(params.invoicee.bizClass ?? "").trim();
  if (!inBizType || !inBizClass) {
    try {
      const db = await getDb();
      const facilityId = params.invoicee.facilityId ? String(params.invoicee.facilityId) : null;
      const found = rowsToObjects(
        facilityId
          ? await db.exec(
              `SELECT business_certificate_business_type AS t, business_certificate_business_item AS i
                 FROM facilities WHERE facility_id = $1`,
              [facilityId],
            )
          : await db.exec(
              `SELECT business_certificate_business_type AS t, business_certificate_business_item AS i
                 FROM facilities
                WHERE regexp_replace(COALESCE(business_registration_no, ''), '[^0-9]', '', 'g') = $1
                  AND (business_certificate_business_type IS NOT NULL OR business_certificate_business_item IS NOT NULL)
                LIMIT 1`,
              [params.invoicee.corpNum],
            ),
      );
      if (found.length) {
        if (!inBizType) inBizType = String(found[0].t ?? "").trim();
        if (!inBizClass) inBizClass = String(found[0].i ?? "").trim();
      }
    } catch (err) {
      console.warn("[tax-invoice] 공급받는자 업태·종목 보강 실패:", (err as Error).message);
    }
  }

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
      bizType: inBizType || undefined,
      bizClass: inBizClass || undefined,
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
    items: lines.length
      ? lines.map((it, i) => {
          // 행 세액은 반올림 오차가 생기므로 마지막 행에서 총 세액과 맞춘다(바로빌은 합계 일치를 본다).
          const rowTax =
            i === lines.length - 1
              ? Math.round(params.taxTotal) - lines.slice(0, -1).reduce((acc, r) => acc + Math.round(r.tax ?? 0), 0)
              : Math.round(it.tax ?? 0);
          return {
            purchaseExpiry: supplyDate,
            name: it.name.trim().slice(0, 100),
            chargeableUnit: String(it.qty ?? 1),
            unitPrice: String(Math.round(it.unitPrice ?? it.amount)),
            amount: String(Math.round(it.amount)),
            tax: String(rowTax),
            description: (it.spec ?? "").trim().slice(0, 100) || undefined,
          };
        })
      : [
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
          invoicee_facility_id, invoicee_corp_num, invoicee_corp_name, invoicee_email, invoicee_cc_emails,
          line_items, barobill_state, issued_by, issued_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'sales', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, 3014, $17, $18, $18, $18)`,
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
        ccEmails.length ? ccEmails.join(", ") : null,
        JSON.stringify(input.items),
        actorUserId,
        now,
      ],
    );
    // 기존 수금 모델 반영 — 발행요청 해소·미수금 집계가 그대로 따라온다.
    // 묶음 발행(milestoneIds)이면 포함된 단계 전부 마킹하고, 각 단계의 invoice_amount 는
    // 계산서 총액이 아니라 단계 자체 금액으로 남긴다(단계별 미수금 집계가 어긋나지 않게).
    const targetIds = Array.from(new Set([params.milestoneId, ...(params.milestoneIds ?? [])].filter(Boolean)));
    if (targetIds.length > 1) {
      const ph = targetIds.map((_, i) => `$${i + 3}`).join(",");
      await db.run(
        `UPDATE contract_payment_milestones
            SET invoice_issued = 1, invoice_issued_at = $1,
                invoice_amount = COALESCE(amount, invoice_amount), updated_at = $2
          WHERE milestone_id IN (${ph})`,
        [params.writeDate, new Date().toISOString(), ...targetIds],
      );
    } else {
      await db.run(
        `UPDATE contract_payment_milestones
            SET invoice_issued = 1, invoice_issued_at = $2, invoice_amount = $3, updated_at = $4
          WHERE milestone_id = $1`,
        [params.milestoneId, params.writeDate, Math.round(params.totalAmount), new Date().toISOString()],
      );
    }
  });

  // 발행에 쓴 담당자 이메일을 최근 사용으로 올린다(목록 정렬용) — 저장된 주소가 아니면 아무 일도 하지 않는다.
  await withDbWrite(async (db) => {
    await db.run(`UPDATE tax_invoice_issuer_emails SET used_at = $2 WHERE email = $1`, [params.invoicer.email.trim(), now]);
  }).catch(() => {});

  // 추가 수신처 안내 메일 — 발행 자체는 이미 끝났으므로 실패해도 예외로 올리지 않는다(로그만).
  if (ccEmails.length) {
    const total = Math.round(params.totalAmount).toLocaleString("ko-KR");
    const result = await sendNotifyEmail({
      to: ccEmails,
      subject: `[세금계산서 발행] ${params.invoicer.corpName} → ${params.invoicee.corpName} ${total}원`,
      text: [
        `${params.invoicee.corpName} 담당자님께,`,
        "",
        `${params.invoicer.corpName}에서 아래와 같이 전자세금계산서를 발행했습니다.`,
        "",
        `  작성일자   ${params.writeDate}`,
        `  품목       ${params.itemName}`,
        `  공급가액   ${Math.round(params.amountTotal).toLocaleString("ko-KR")}원`,
        `  세액       ${Math.round(params.taxTotal).toLocaleString("ko-KR")}원`,
        `  합계금액   ${total}원`,
        "",
        `계산서 원본은 대표 수신처(${params.invoicee.email})로 발송된 바로빌 메일에서 확인하실 수 있습니다.`,
        "이 메일은 계산서 수신 담당자로 함께 지정되어 발송된 안내 메일입니다.",
      ].join("\n"),
    });
    if (!result.ok) console.warn("[tax-invoice] 추가 수신처 안내 메일 실패:", result.error ?? result.skipped);
  }

  // 보관용 PDF 자동 생성(2026-08-25) — 발행 자체는 이미 끝났으므로 실패해도 예외로 올리지 않는다.
  // 국세청 전송 완료 시 refreshInvoiceStates 가 승인번호를 반영해 재생성한다.
  try {
    const archived = await archiveTaxInvoicePdf(invoiceId);
    if (!archived.saved) console.warn("[tax-invoice] 보관 PDF 생성 건너뜀:", invoiceId, archived.reason);
  } catch (err) {
    console.warn("[tax-invoice] 보관 PDF 생성 실패:", invoiceId, (err as Error).message);
  }

  return { invoiceId, mgtKey };
}

/** 상태 갱신 — 발행 후 국세청 전송은 바로빌이 일괄 처리(통상 익일)라 폴링이 필요하다. */
export async function refreshInvoiceStates(invoiceIds?: string[]): Promise<{ checked: number; updated: number }> {
  const db = await getDb();
  const rows = invoiceIds?.length
    ? rowsToObjects(
        await db.exec(`SELECT invoice_id, mgt_key, nts_send_state, nts_send_key FROM tax_invoices WHERE invoice_id = ANY($1::text[])`, [invoiceIds]),
      )
    : rowsToObjects(
        await db.exec(
          `SELECT invoice_id, mgt_key, nts_send_state, nts_send_key FROM tax_invoices
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
      // 국세청 전송이 이번 갱신에서 완료된 건은 보관 PDF 를 전송 완료본으로 재생성한다(자동 생성본만 교체).
      // ⚠승인번호(nts_send_key) 유무로 전이를 판정하면 안 된다 — 바로빌은 발행 즉시 승인번호를
      // 부여하고 국세청 전송만 익일이라, 번호는 처음부터 있고 상태(nts_send_state)만 나중에 4로
      // 바뀐다(2026-08-26 실사례: "미전송" 문구 캡처본이 전송 완료 후에도 교체되지 않았다).
      const wasSent = Number(row.nts_send_state ?? 0) >= 4;
      if (!wasSent && Number(state.ntsSendState ?? 0) >= 4) {
        await archiveTaxInvoicePdf(String(row.invoice_id), { force: true }).catch((err) =>
          console.warn("[tax-invoice] 전송 완료 PDF 재생성 실패:", String(row.invoice_id), (err as Error).message),
        );
      }
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

export interface ModifyParams {
  originalInvoiceId: string;
  modifyCode: string; // 1 기재착오 / 2 공급가액 변동 / 3 환입 / 4 계약해제 / 5 내국신용장 / 6 이중발급
  writeDate: string; // YYYY-MM-DD
  /** 음수 허용 — 환입(3)·계약해제(4)·이중발급(6)은 마이너스 발행이 원칙. */
  amountTotal: number;
  taxTotal: number;
  totalAmount: number;
  itemName: string;
  remark1?: string;
  invoiceeEmail?: string; // 미지정 시 원본 수신처
}

/**
 * 수정세금계산서 발행 (P5) — 발급분은 취소가 불가하므로(실측 -21003) 정정은 이 경로뿐이다.
 * 원본의 국세청 승인번호(NTSSendKey)가 필요해 **국세청 전송이 끝난 건만** 수정 발행할 수 있다.
 * milestone 자동 갱신은 하지 않는다 — 수정 유형(증감/환입/취소)마다 회계 처리가 달라
 * 단계 금액 정정은 사용자가 계약 화면에서 직접 확인·수정하는 것이 안전하다.
 */
export async function issueModifiedTaxInvoice(params: ModifyParams, actorUserId: string | null): Promise<{ invoiceId: string; mgtKey: string }> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT contract_id, milestone_id, mgt_key, nts_send_key, nts_send_state, tax_type, purpose_type,
              invoicee_facility_id, invoicee_corp_num, invoicee_corp_name, invoicee_email, line_items
         FROM tax_invoices WHERE invoice_id = $1`,
      [params.originalInvoiceId],
    ),
  );
  if (!rows.length) throw Object.assign(new Error("원본 계산서를 찾을 수 없습니다."), { status: 404 });
  const origin = rows[0];
  if (!origin.nts_send_key || Number(origin.nts_send_state ?? 0) < 4) {
    throw Object.assign(new Error("국세청 전송이 완료된 계산서만 수정 발행할 수 있습니다(승인번호 필요). 상태 갱신 후 다시 시도하세요."), { status: 400 });
  }
  if (Math.round(params.amountTotal + params.taxTotal) !== Math.round(params.totalAmount)) {
    throw Object.assign(new Error("공급가액 + 세액이 합계금액과 맞지 않습니다."), { status: 400 });
  }

  const profile = await getCompanyProfile();
  const cfg = getBarobillConfig();
  const milestoneId = origin.milestone_id ? String(origin.milestone_id) : "modify";
  const mgtKey = newMgtKey(milestoneId);
  const writeDate = ymd(params.writeDate);
  const email = params.invoiceeEmail || (origin.invoicee_email ? String(origin.invoicee_email) : "");
  if (!email) throw Object.assign(new Error("수신 이메일이 필요합니다."), { status: 400 });

  // 공급받는자 업태·종목(2026-08-26) — 정발행과 동일하게 사업장 마스터에서 채운다.
  const modBiz = rowsToObjects(
    origin.invoicee_facility_id
      ? await db.exec(
          `SELECT business_certificate_business_type AS t, business_certificate_business_item AS i
             FROM facilities WHERE facility_id = $1`,
          [String(origin.invoicee_facility_id)],
        )
      : await db.exec(
          `SELECT business_certificate_business_type AS t, business_certificate_business_item AS i
             FROM facilities
            WHERE regexp_replace(COALESCE(business_registration_no, ''), '[^0-9]', '', 'g') = $1
              AND (business_certificate_business_type IS NOT NULL OR business_certificate_business_item IS NOT NULL)
            LIMIT 1`,
          [String(origin.invoicee_corp_num ?? "").replace(/[^0-9]/g, "")],
        ),
  );

  // 음수 금액은 바로빌에 "-" 붙은 문자열로 그대로 전달한다(수정분 규칙).
  const amount = String(Math.round(params.amountTotal));
  const tax = String(Math.round(params.taxTotal));
  const total = String(Math.round(params.totalAmount));

  await registModifyTaxInvoice(
    {
      invoicer: {
        contactId: cfg.id,
        corpNum: (profile.bizRegNo || cfg.corpNum).replace(/[^0-9]/g, ""),
        mgtNum: mgtKey,
        corpName: toPlainCompanyName(profile.companyName),
        ceoName: profile.ceoName,
        addr: profile.address,
        bizClass: profile.mainBusiness,
        bizType: profile.bizField,
        tel: profile.phone,
        email: process.env.BAROBILL_INVOICER_EMAIL || "",
      },
      invoicee: {
        corpNum: String(origin.invoicee_corp_num ?? ""),
        corpName: String(origin.invoicee_corp_name ?? ""),
        bizType: modBiz.length && modBiz[0].t ? String(modBiz[0].t) : undefined,
        bizClass: modBiz.length && modBiz[0].i ? String(modBiz[0].i) : undefined,
        email,
      },
      taxType: origin.tax_type == null ? 1 : Number(origin.tax_type),
      purposeType: origin.purpose_type == null ? 2 : Number(origin.purpose_type),
      modifyCode: params.modifyCode,
      writeDate,
      amountTotal: amount,
      taxTotal: tax,
      totalAmount: total,
      remark1: params.remark1,
      items: [
        {
          purchaseExpiry: writeDate,
          name: params.itemName.slice(0, 100),
          chargeableUnit: "1",
          unitPrice: amount,
          amount,
          tax,
        },
      ],
    },
    String(origin.nts_send_key),
  );

  const invoiceId = `ti-${createHash("sha256").update(mgtKey).digest("hex").slice(0, 12)}`;
  const now = KST_NOW();
  await withDbWrite(async (tx) => {
    await tx.run(
      `INSERT INTO tax_invoices
         (invoice_id, mgt_key, contract_id, milestone_id, direction, write_date,
          amount_total, tax_total, total_amount, tax_type, purpose_type,
          invoicee_facility_id, invoicee_corp_num, invoicee_corp_name, invoicee_email,
          line_items, barobill_state, modify_code, original_invoice_id, issued_by, issued_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'sales', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, 3014, $16, $17, $18, $19, $19, $19)`,
      [
        invoiceId,
        mgtKey,
        origin.contract_id ? String(origin.contract_id) : null,
        origin.milestone_id ? String(origin.milestone_id) : null,
        params.writeDate,
        Math.round(params.amountTotal),
        Math.round(params.taxTotal),
        Math.round(params.totalAmount),
        origin.tax_type == null ? 1 : Number(origin.tax_type),
        origin.purpose_type == null ? 2 : Number(origin.purpose_type),
        origin.invoicee_facility_id ? String(origin.invoicee_facility_id) : null,
        String(origin.invoicee_corp_num ?? ""),
        String(origin.invoicee_corp_name ?? ""),
        email,
        JSON.stringify([{ name: params.itemName, amount, tax }]),
        params.modifyCode,
        params.originalInvoiceId,
        actorUserId,
        now,
      ],
    );
  });
  return { invoiceId, mgtKey };
}

/**
 * 임시저장 문서 삭제.
 * ★실측(2026-08-16 테스트베드): `DeleteTaxInvoice` 는 **임시저장(BarobillState 1000) 전용**이다.
 *   즉시발행으로 발급완료(3014)된 건은 국세청 전송 전이라도 -21003("삭제 가능한 상태가 아닙니다")로 거부된다.
 *   → 발급된 계산서의 정정은 **수정세금계산서(RegistModifyTaxInvoice + ModifyCode)** 로만 가능(P5 범위).
 *   우리 앱은 RegistAndIssue(즉시발행)만 쓰므로 이 경로는 사실상 방어용이다.
 */
export async function cancelTaxInvoice(invoiceId: string): Promise<void> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT mgt_key, milestone_id, nts_send_state, barobill_state FROM tax_invoices WHERE invoice_id = $1`, [invoiceId]),
  );
  if (!rows.length) throw Object.assign(new Error("계산서를 찾을 수 없습니다."), { status: 404 });
  if (Number(rows[0].barobill_state ?? 0) >= 3000) {
    throw Object.assign(
      new Error("이미 발급된 계산서는 삭제할 수 없습니다. 정정이 필요하면 수정세금계산서를 발행해야 합니다(바로빌 홈페이지 또는 후속 기능)."),
      { status: 400 },
    );
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
