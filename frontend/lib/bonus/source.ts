import { getDb, rowsToObjects } from "@/lib/db";

/**
 * 성과급 산정 별도 앱이 read-only 로 참조하는 데이터 계약. (블루프린트 §6.7.4)
 * MCM 의 계약·발행·참여·평점을 반기(period) 기준으로 제공한다.
 * service_costs(공제비용)는 전자결재 모듈 보류로 이번 범위에서 제외.
 */

export interface BonusPeriod {
  year: number;
  half: "H1" | "H2";
  from: string;
  to: string;
}

export function parsePeriod(period: string): BonusPeriod | null {
  const m = /^(\d{4})-(H1|H2)$/.exec(period.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const half = m[2] as "H1" | "H2";
  return half === "H1"
    ? { year, half, from: `${year}-01-01`, to: `${year}-06-30` }
    : { year, half, from: `${year}-07-01`, to: `${year}-12-31` };
}

export async function listBonusContracts(p: BonusPeriod) {
  const db = await getDb();
  const result = await db.exec(
    `SELECT c.contract_id, c.contract_title, c.owning_dept_id, d.dept_name AS owning_dept_name,
            c.service_type, COALESCE(c.current_amount, c.contract_amount) AS contract_amount,
            COALESCE((SELECT SUM(COALESCE(m.invoice_amount, m.amount, 0))
                        FROM contract_payment_milestones m
                       WHERE m.contract_id = c.contract_id
                         AND m.invoice_issued = 1
                         AND m.invoice_issued_at IS NOT NULL
                         AND m.invoice_issued_at >= $1 AND m.invoice_issued_at <= $2), 0) AS issued_in_period
       FROM contracts c
       LEFT JOIN departments d ON d.dept_id = c.owning_dept_id
      WHERE c.owning_dept_id IS NOT NULL AND c.deleted_at IS NULL
      ORDER BY c.owning_dept_id, c.contract_title`,
    [p.from, p.to]
  );
  return rowsToObjects(result).map((row) => ({
    contractId: String(row.contract_id ?? ""),
    contractTitle: String(row.contract_title ?? ""),
    owningDeptId: row.owning_dept_id != null ? String(row.owning_dept_id) : null,
    owningDeptName: row.owning_dept_name != null ? String(row.owning_dept_name) : null,
    serviceType: row.service_type != null ? String(row.service_type) : null,
    contractAmount: Number(row.contract_amount ?? 0),
    issuedInPeriod: Number(row.issued_in_period ?? 0),
  }));
}

export async function listBonusMilestones(contractId: string, p: BonusPeriod) {
  const db = await getDb();
  const result = await db.exec(
    `SELECT stage_order, stage_label, amount, invoice_amount, invoice_issued_at
       FROM contract_payment_milestones
      WHERE contract_id = $1 AND invoice_issued = 1
        AND invoice_issued_at IS NOT NULL AND invoice_issued_at >= $2 AND invoice_issued_at <= $3
      ORDER BY stage_order`,
    [contractId, p.from, p.to]
  );
  return rowsToObjects(result).map((row) => ({
    stageOrder: Number(row.stage_order ?? 0),
    stageLabel: row.stage_label != null ? String(row.stage_label) : null,
    amount: Number(row.amount ?? 0),
    invoiceAmount: row.invoice_amount != null ? Number(row.invoice_amount) : null,
    issuedAt: row.invoice_issued_at != null ? String(row.invoice_issued_at) : null,
  }));
}

export async function listBonusSpans(contractId: string, p: BonusPeriod) {
  const db = await getDb();
  // 해당 반기와 겹치는 span (span_from <= to AND (span_to IS NULL OR span_to >= from))
  const result = await db.exec(
    `SELECT employee_id, role_label, span_from, span_to, participation_pct
       FROM service_participation_spans
      WHERE contract_id = $1 AND span_from <= $3 AND (span_to IS NULL OR span_to >= $2)
      ORDER BY span_from`,
    [contractId, p.from, p.to]
  );
  return rowsToObjects(result).map((row) => ({
    employeeId: String(row.employee_id ?? ""),
    roleLabel: String(row.role_label ?? ""),
    spanFrom: row.span_from != null ? String(row.span_from) : null,
    spanTo: row.span_to != null ? String(row.span_to) : null,
    participationPct: Number(row.participation_pct ?? 0),
  }));
}

export async function listBonusEvaluations(p: BonusPeriod) {
  const db = await getDb();
  const result = await db.exec(
    `SELECT contract_id, employee_id, participation_pct, rating, finalized_at
       FROM service_evaluations
      WHERE period_year = $1 AND period_half = $2
      ORDER BY contract_id, employee_id`,
    [p.year, p.half]
  );
  return rowsToObjects(result).map((row) => ({
    contractId: String(row.contract_id ?? ""),
    employeeId: String(row.employee_id ?? ""),
    participationPct: Number(row.participation_pct ?? 0),
    rating: Number(row.rating ?? 0),
    maxRating: 5,
    finalized: row.finalized_at != null,
  }));
}
