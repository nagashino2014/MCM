import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { BonusPeriod } from "@/lib/bonus/source";
import {
  resolveBonusCategory,
  type BonusSettings,
  type BonusTargetRow,
  type BonusTargetStage,
} from "@/lib/bonus/shared";

/**
 * 성과급 산정 — 지급 대상 LIST 서버 쿼리 (docs/bonus-calculation-blueprint.md §4)
 * - 대상 = 해당 반기 세금계산서 발행 실적이 있는 용역(계약). 수행부서 미지정 계약도 포함한다
 *   (분류 귀속은 service_type 우선이라 가능 — 미지정은 화면에서 배지로 안내, 참여도·평점 입력에는 지정 필요).
 * - 제비용: 외주금액은 contract_outsourcing SUM(amount) 자동 집계(수동 입력 불가 확정),
 *   영업비용만 bonus_contract_costs 에 수동 입력.
 * - 단계별 제비용 반영액 = (용역금액 - Σ제비용) × 단계금액 / 용역금액 (비례 배분, 엑셀 W열 실측 산식).
 * 상수·타입은 shared.ts(클라이언트 공용).
 */

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function listBonusTargets(p: BonusPeriod): Promise<BonusTargetRow[]> {
  const db = await getDb();
  const contractsResult = await db.exec(
    `SELECT c.contract_id, c.contract_title, c.contract_date, c.service_type,
            c.owning_dept_id, d.dept_name AS owning_dept_name, d.dept_kind,
            cp.company_name AS counterparty_name,
            COALESCE(c.current_amount, c.contract_amount, 0) AS contract_amount,
            COALESCE(o.total_amount, 0) AS outsourcing_amount,
            COALESCE(bc.sales_cost_amount, 0) AS sales_cost_amount
       FROM contracts c
       LEFT JOIN departments d ON d.dept_id = c.owning_dept_id
       LEFT JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
       LEFT JOIN (SELECT contract_id, SUM(COALESCE(amount, 0)) AS total_amount
                    FROM contract_outsourcing GROUP BY contract_id) o
              ON o.contract_id = c.contract_id
       LEFT JOIN bonus_contract_costs bc ON bc.contract_id = c.contract_id
      WHERE c.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM contract_payment_milestones m
                     WHERE m.contract_id = c.contract_id
                       AND m.invoice_issued = 1
                       AND m.invoice_issued_at IS NOT NULL
                       AND m.invoice_issued_at >= $1 AND m.invoice_issued_at <= $2)
      ORDER BY c.contract_date NULLS LAST, c.contract_title`,
    [p.from, p.to]
  );
  const contracts = rowsToObjects(contractsResult);
  if (!contracts.length) return [];

  const ids = contracts.map((row) => String(row.contract_id ?? ""));
  const milestonesResult = await db.exec(
    `SELECT contract_id, stage_label, stage_order, amount, invoice_amount,
            invoice_issued, invoice_issued_at
       FROM contract_payment_milestones
      WHERE contract_id = ANY($1::text[])
      ORDER BY contract_id, stage_order`,
    [ids]
  );
  const milestonesByContract = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rowsToObjects(milestonesResult)) {
    const cid = String(row.contract_id ?? "");
    const list = milestonesByContract.get(cid) ?? [];
    list.push(row);
    milestonesByContract.set(cid, list);
  }

  return contracts.map((row) => {
    const contractId = String(row.contract_id ?? "");
    const contractAmount = toNum(row.contract_amount);
    const outsourcingAmount = toNum(row.outsourcing_amount);
    const salesCostAmount = toNum(row.sales_cost_amount);
    // 제비용 비례 계수 — 용역금액이 0이면 반영 불가(엑셀 IFERROR 와 동일하게 0 처리)
    const netFactor =
      contractAmount > 0
        ? Math.max(0, (contractAmount - outsourcingAmount - salesCostAmount) / contractAmount)
        : 0;

    let appliedInPeriod = 0;
    const stages: BonusTargetStage[] = (milestonesByContract.get(contractId) ?? []).map((m) => {
      const amount = toNum(m.amount);
      const invoiceAmount = m.invoice_amount != null ? toNum(m.invoice_amount) : null;
      const invoiceIssued = Number(m.invoice_issued ?? 0) === 1;
      const issuedAt = m.invoice_issued_at != null ? String(m.invoice_issued_at) : null;
      const inPeriod =
        invoiceIssued && issuedAt != null && issuedAt >= p.from && issuedAt <= `${p.to}T23:59:59`;
      // 반기 적용액은 실발행액 우선(정산 반영), 표시용 netAmount 는 단계 계약금액 기준(엑셀 W열)
      if (inPeriod) appliedInPeriod += (invoiceAmount ?? amount) * netFactor;
      return {
        stageOrder: Number(m.stage_order ?? 0),
        stageLabel: m.stage_label != null ? String(m.stage_label) : "",
        amount,
        invoiceAmount,
        invoiceIssued,
        issuedAt,
        netAmount: amount * netFactor,
        inPeriod,
      };
    });

    const owningDeptId = row.owning_dept_id != null ? String(row.owning_dept_id) : null;
    const serviceType = row.service_type != null ? String(row.service_type) : null;
    return {
      contractId,
      contractTitle: String(row.contract_title ?? ""),
      counterpartyName: row.counterparty_name != null ? String(row.counterparty_name) : null,
      contractDate: row.contract_date != null ? String(row.contract_date) : null,
      serviceType,
      owningDeptId,
      owningDeptName: row.owning_dept_name != null ? String(row.owning_dept_name) : null,
      category: resolveBonusCategory(
        serviceType,
        owningDeptId,
        row.dept_kind != null ? String(row.dept_kind) : null
      ),
      contractAmount,
      outsourcingAmount,
      salesCostAmount,
      stages,
      appliedInPeriod,
    };
  });
}

const DEFAULT_SETTINGS: Omit<BonusSettings, "periodYear" | "periodHalf" | "exists"> = {
  applyRate: 4,
  contribSupportPct: 0,
  contribExecPct: 0,
  deptHeadRates: {},
  calcMethod: "base",
  salaryApplyRate: null,
  salaryMultiplier: 1,
  profitApplyRate: null,
  operatingProfit: null,
  absoluteGrading: false,
  gradeCaps: {},
  status: "draft",
};

function parseJsonRecord(v: unknown): Record<string, number> {
  if (v == null) return {};
  const obj = typeof v === "string" ? JSON.parse(v) : v;
  if (typeof obj !== "object" || obj === null) return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(obj as Record<string, unknown>)) {
    const n = Number(val);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export async function getBonusSettings(year: number, half: "H1" | "H2"): Promise<BonusSettings> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT * FROM bonus_period_settings WHERE period_year = $1 AND period_half = $2`,
    [year, half]
  );
  const row = rowsToObjects(result)[0];
  if (!row) return { periodYear: year, periodHalf: half, exists: false, ...DEFAULT_SETTINGS };
  return {
    periodYear: year,
    periodHalf: half,
    exists: true,
    applyRate: toNum(row.apply_rate) || 4,
    contribSupportPct: toNum(row.contrib_support_pct),
    contribExecPct: toNum(row.contrib_exec_pct),
    deptHeadRates: parseJsonRecord(row.dept_head_rates_json),
    calcMethod: (String(row.calc_method ?? "base") as BonusSettings["calcMethod"]) || "base",
    salaryApplyRate: row.salary_apply_rate != null ? toNum(row.salary_apply_rate) : null,
    salaryMultiplier: row.salary_multiplier != null ? toNum(row.salary_multiplier) : 1,
    profitApplyRate: row.profit_apply_rate != null ? toNum(row.profit_apply_rate) : null,
    operatingProfit: row.operating_profit != null ? toNum(row.operating_profit) : null,
    absoluteGrading: Number(row.absolute_grading ?? 0) === 1,
    gradeCaps: parseJsonRecord(row.grade_cap_json),
    status: (String(row.status ?? "draft") as BonusSettings["status"]) || "draft",
  };
}

export interface BonusSettingsInput {
  applyRate: number;
  contribSupportPct: number;
  contribExecPct: number;
  deptHeadRates: Record<string, number>;
  absoluteGrading?: boolean;
  gradeCaps?: Record<string, number>;
  /** 산정방식(BS-P4) — 'salary' 는 인건비 반영 산정. 미지정이면 기존 값 유지 */
  calcMethod?: BonusSettings["calcMethod"];
  salaryApplyRate?: number | null;
  salaryMultiplier?: number;
}

export async function saveBonusSettings(
  actorUserId: string,
  year: number,
  half: "H1" | "H2",
  input: BonusSettingsInput
): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO bonus_period_settings
         (period_year, period_half, apply_rate, contrib_support_pct, contrib_exec_pct,
          dept_head_rates_json, absolute_grading, grade_cap_json,
          calc_method, salary_apply_rate, salary_multiplier, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb,
               COALESCE($9, 'base'), $10, COALESCE($11, 1.0), $12, now()::text)
       ON CONFLICT (period_year, period_half) DO UPDATE SET
         apply_rate = EXCLUDED.apply_rate,
         contrib_support_pct = EXCLUDED.contrib_support_pct,
         contrib_exec_pct = EXCLUDED.contrib_exec_pct,
         dept_head_rates_json = EXCLUDED.dept_head_rates_json,
         absolute_grading = EXCLUDED.absolute_grading,
         grade_cap_json = EXCLUDED.grade_cap_json,
         calc_method = COALESCE($9, bonus_period_settings.calc_method),
         salary_apply_rate = COALESCE($10, bonus_period_settings.salary_apply_rate),
         salary_multiplier = COALESCE($11, bonus_period_settings.salary_multiplier),
         updated_by = EXCLUDED.updated_by,
         updated_at = EXCLUDED.updated_at`,
      [
        year,
        half,
        input.applyRate,
        input.contribSupportPct,
        input.contribExecPct,
        JSON.stringify(input.deptHeadRates ?? {}),
        input.absoluteGrading ? 1 : 0,
        JSON.stringify(input.gradeCaps ?? {}),
        input.calcMethod ?? null,
        input.salaryApplyRate ?? null,
        input.salaryMultiplier ?? null,
        actorUserId,
      ]
    );
  });
}

export async function saveSalesCosts(
  actorUserId: string,
  rows: Array<{ contractId: string; salesCostAmount: number }>
): Promise<void> {
  await withDbWrite(async (db) => {
    for (const row of rows) {
      if (!row.contractId) continue;
      await db.run(
        `INSERT INTO bonus_contract_costs (contract_id, sales_cost_amount, updated_by, updated_at)
         VALUES ($1, $2, $3, now()::text)
         ON CONFLICT (contract_id) DO UPDATE SET
           sales_cost_amount = EXCLUDED.sales_cost_amount,
           updated_by = EXCLUDED.updated_by,
           updated_at = EXCLUDED.updated_at`,
        [row.contractId, toNum(row.salesCostAmount), actorUserId]
      );
    }
  });
}
