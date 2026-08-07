// 계약 → 착수계·준공계 자동 채움값 산출 (서버 전용 — DB 접근).
// 설계: docs/contract-deliverables-blueprint.md §3(바인딩 카탈로그·기성 집계 규칙).
// 산출된 값은 contract_deliverables.field_values 에 확정 저장되고, 사용자가 잠금 해제한
// 항목(unlocked)은 재산출 시 덮어쓰지 않는다.

import { getDb, rowsToObjects } from "@/lib/db";
import { getCompanyProfile } from "@/lib/company/profile";
import { COMPANY_ADDRESS, COMPANY_BIZ_NO, COMPANY_CEO, COMPANY_KO } from "@/lib/letter/types";
import { DEFAULT_VAT_NOTE } from "./format";
import type { DeliverableKind, DeliverableValues } from "./types";

export interface MilestoneInfo {
  milestoneId: string;
  stageKey: string; // advance | mid1..3 | completion | stage_N_xxxx(커스텀)
  stageLabel: string;
  stageOrder: number;
  amount: number | null;
  invoiceIssued: boolean;
  invoiceIssuedAt: string | null;
  collected: boolean;
}

export interface ContractContext {
  contractId: string;
  title: string;
  ordererName: string; // 발주처(계약 상대) 법인명
  siteName: string; // 통합허가 대상 사업장명
  siteAddress: string;
  contractDate: string;
  startedAt: string;
  endedAt: string;
  amount: number | null;
  serviceType: string;
  serviceSubtype: string;
  orderNo: string; // 발주처 부여 번호(있으면)
  milestones: MilestoneInfo[];
}

const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * 공급가액·부가세 산출.
 * 계약금액이 VAT 별도(기본, 계약관리 입력 관행)면 그 값이 곧 공급가액이고 부가세를 가산한다.
 * VAT 포함으로 입력된 계약만 총액에서 역산한다(예: 91,154,823 → 82,868,021 / 8,286,802).
 */
export function splitVat(total: number, vatIncluded: boolean): { supply: number; vat: number; total: number } {
  if (!vatIncluded) {
    const supply = Math.round(total);
    return { supply, vat: Math.round(supply * 0.1), total: supply + Math.round(supply * 0.1) };
  }
  const supply = Math.round(total / 1.1);
  return { supply, vat: Math.round(total) - supply, total: Math.round(total) };
}

/** 계약 1건 + 기성 회차 로드. 삭제된 계약은 null. */
export async function loadContractContext(contractId: string): Promise<ContractContext | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id, c.contract_title, c.service_type, c.service_subtype,
              c.contract_amount, c.current_amount, c.contract_date, c.started_at, c.ended_at,
              c.legacy_contract_no,
              cp.company_name AS orderer_name,
              COALESCE(tf.company_name, f.company_name) AS site_name,
              COALESCE(tf.site_address, f.site_address) AS site_address
         FROM contracts c
         LEFT JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
         LEFT JOIN facilities f ON f.facility_id = c.facility_id
         LEFT JOIN LATERAL (
           SELECT f2.facility_id, f2.company_name, f2.site_address
             FROM contract_facilities cf
             JOIN facilities f2 ON f2.facility_id = cf.facility_id
            WHERE cf.contract_id = c.contract_id
              AND cf.relation_type = 'integrated_permit_target'
            ORDER BY f2.company_name ASC
            LIMIT 1
         ) tf ON true
        WHERE c.contract_id = $1
          AND c.deleted_at IS NULL
        LIMIT 1`,
      [contractId]
    )
  );
  const c = rows[0];
  if (!c) return null;

  const ms = rowsToObjects(
    await db.exec(
      `SELECT milestone_id, stage_key, stage_label, stage_order, amount, invoice_issued, invoice_issued_at, payment_collected
         FROM contract_payment_milestones
        WHERE contract_id = $1
        ORDER BY stage_order ASC`,
      [contractId]
    )
  );

  return {
    contractId: s(c.contract_id),
    title: s(c.contract_title),
    ordererName: s(c.orderer_name),
    siteName: s(c.site_name),
    siteAddress: s(c.site_address),
    contractDate: s(c.contract_date),
    startedAt: s(c.started_at),
    endedAt: s(c.ended_at),
    amount: num(c.current_amount) ?? num(c.contract_amount),
    serviceType: s(c.service_type),
    serviceSubtype: s(c.service_subtype),
    orderNo: s(c.legacy_contract_no),
    milestones: ms.map((m) => ({
      milestoneId: s(m.milestone_id),
      stageKey: s(m.stage_key),
      stageLabel: s(m.stage_label),
      stageOrder: Number(m.stage_order ?? 0),
      amount: num(m.amount),
      invoiceIssued: Number(m.invoice_issued ?? 0) === 1,
      invoiceIssuedAt: m.invoice_issued_at != null ? s(m.invoice_issued_at) : null,
      collected: Number(m.payment_collected ?? 0) === 1,
    })),
  };
}

export interface AutoValueOptions {
  /** 준공 금회 회차. 미지정 시 마지막 회차(stage_order 최대) */
  milestoneId?: string | null;
  /** 실준공일. 미지정 시 계약 종료일 */
  actualDate?: string | null;
  /** 작성일. 미지정 시 오늘 */
  issueDate?: string | null;
  /** VAT 표기. 미지정 시 'VAT 포함'(실물 기본) */
  vatNote?: string | null;
}

/** 준공(잔금) 회차 판정 — 계약관리 대금지급단계의 stage_key/라벨 관례. */
function isCompletionStage(m: MilestoneInfo): boolean {
  return m.stageKey === "completion" || /준공|잔금/.test(m.stageLabel);
}

/**
 * 준공금액 표 앞열 제목 — 사용자 확정(2026-08-07):
 * 대금지급단계가 딱 2단계면 "전회", 3단계 이상이면 "기지급"(준공금·잔금 외 기존 청구액 전부).
 */
export function priorColumnLabel(stageCount: number): string {
  return stageCount >= 3 ? "기지급" : "전회";
}

/**
 * 준공금액 표 6칸 산출 — 기지급(전회) / 금회 / 누계.
 * 금회 = 준공(잔금) 회차. 없으면 마지막 회차. 기지급 = 금회보다 앞선 모든 회차 합.
 */
export function computeCompletionAmounts(
  milestones: MilestoneInfo[],
  currentMilestoneId: string | null,
  vatIncluded: boolean
): {
  current: number;
  cumulative: number;
  prev: { supply: number; vat: number; total: number };
  cur: { supply: number; vat: number; total: number };
  cum: { supply: number; vat: number; total: number };
  currentMilestoneId: string | null;
  priorLabel: string;
} {
  const sorted = [...milestones].sort((a, b) => a.stageOrder - b.stageOrder);
  const fallback = [...sorted].reverse().find(isCompletionStage) ?? sorted[sorted.length - 1];
  const target = currentMilestoneId
    ? sorted.find((m) => m.milestoneId === currentMilestoneId) ?? fallback
    : fallback;
  const currentTotal = target?.amount ?? 0;
  const prevTotal = target
    ? sorted.filter((m) => m.stageOrder < target.stageOrder).reduce((sum, m) => sum + (m.amount ?? 0), 0)
    : 0;
  const cumTotal = prevTotal + currentTotal;
  return {
    current: currentTotal,
    cumulative: cumTotal,
    prev: splitVat(prevTotal, vatIncluded),
    cur: splitVat(currentTotal, vatIncluded),
    cum: splitVat(cumTotal, vatIncluded),
    currentMilestoneId: target?.milestoneId ?? null,
    priorLabel: priorColumnLabel(sorted.length),
  };
}

/**
 * 자동 채움값 생성. 기성 회차가 없는 계약은 계약금액 전액을 금회로 놓는다
 * (사용자가 작성 화면에서 잠금 해제해 보정).
 */
export async function buildAutoValues(
  ctx: ContractContext,
  kind: DeliverableKind,
  opts: AutoValueOptions = {}
): Promise<DeliverableValues> {
  const profile = await getCompanyProfile().catch(() => null);
  const vatNote = (opts.vatNote ?? DEFAULT_VAT_NOTE).trim() || DEFAULT_VAT_NOTE;
  const vatIncluded = !vatNote.includes("별도");
  const today = new Date().toISOString().slice(0, 10);

  const values: DeliverableValues = {
    "contract.title": ctx.title,
    "contract.amount": ctx.amount,
    "contract.date": ctx.contractDate,
    "contract.startDate": ctx.startedAt,
    "contract.endDate": ctx.endedAt,
    "contract.period": ctx.startedAt && ctx.endedAt ? `${ctx.startedAt}~${ctx.endedAt}` : "",
    "contract.orderNo": ctx.orderNo,
    "site.name": ctx.siteName,
    "site.address": ctx.siteAddress,
    "orderer.name": ctx.ordererName,
    "company.name": profile?.companyName || COMPANY_KO,
    "company.address": profile?.address || COMPANY_ADDRESS,
    "company.ceo": profile?.ceoName || COMPANY_CEO,
    "company.bizNo": profile?.bizRegNo || COMPANY_BIZ_NO,
    "issue.date": opts.issueDate || today,
    "meta.vatNote": vatNote,
  };

  if (kind === "completion") {
    const milestones = ctx.milestones.length
      ? ctx.milestones
      : // 회차 미등록 계약 — 계약금액 전액을 1회차로 간주
        [
          {
            milestoneId: "virtual-1",
            stageKey: "completion",
            stageLabel: "준공금",
            stageOrder: 1,
            amount: ctx.amount ?? 0,
            invoiceIssued: false,
            invoiceIssuedAt: null,
            collected: false,
          } satisfies MilestoneInfo,
        ];
    const a = computeCompletionAmounts(milestones, opts.milestoneId ?? null, vatIncluded);
    values["completion.actualDate"] = opts.actualDate || ctx.endedAt;
    values["completion.currentAmount"] = a.current;
    values["completion.cumulativeAmount"] = a.cumulative;
    values["completion.prevSupply"] = a.prev.supply;
    values["completion.prevVat"] = a.prev.vat;
    values["completion.prevTotal"] = a.prev.total;
    values["completion.curSupply"] = a.cur.supply;
    values["completion.curVat"] = a.cur.vat;
    values["completion.curTotal"] = a.cur.total;
    values["completion.cumSupply"] = a.cum.supply;
    values["completion.cumVat"] = a.cum.vat;
    values["completion.cumTotal"] = a.cum.total;
    values["completion.progressRate"] = 100;
    values["completion.attachList"] = "";
    values["meta.milestoneId"] = a.currentMilestoneId;
    values["meta.priorLabel"] = a.priorLabel;
  }

  return values;
}

export interface ContractSearchRow {
  contractId: string;
  title: string;
  ordererName: string;
  siteName: string;
  amount: number | null;
  contractDate: string;
  startedAt: string;
  endedAt: string;
  serviceType: string;
}

/** 작성 화면 계약 검색 — 수주 계약(sales)만, 최근 계약 우선. */
export async function searchContracts(q: string, limit = 30): Promise<ContractSearchRow[]> {
  const db = await getDb();
  const args: unknown[] = [];
  let where = `c.deleted_at IS NULL AND COALESCE(c.contract_direction, 'sales') = 'sales'`;
  if (q.trim()) {
    args.push(`%${q.trim()}%`);
    where += ` AND (c.contract_title ILIKE $1 OR cp.company_name ILIKE $1 OR f.company_name ILIKE $1)`;
  }
  args.push(Math.min(100, Math.max(1, limit)));
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id, c.contract_title, c.contract_amount, c.current_amount, c.contract_date,
              c.started_at, c.ended_at, c.service_type,
              cp.company_name AS orderer_name, f.company_name AS site_name
         FROM contracts c
         LEFT JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
         LEFT JOIN facilities f ON f.facility_id = c.facility_id
        WHERE ${where}
        ORDER BY COALESCE(c.contract_date, c.created_at) DESC
        LIMIT $${args.length}`,
      args
    )
  );
  return rows.map((r) => ({
    contractId: s(r.contract_id),
    title: s(r.contract_title),
    ordererName: s(r.orderer_name),
    siteName: s(r.site_name),
    amount: num(r.current_amount) ?? num(r.contract_amount),
    contractDate: s(r.contract_date),
    startedAt: s(r.started_at),
    endedAt: s(r.ended_at),
    serviceType: s(r.service_type),
  }));
}
