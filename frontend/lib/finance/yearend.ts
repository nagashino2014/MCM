// 연말정산 계산 엔진 (블루프린트 P8) — 총급여 → 근로소득공제 → 소득공제 → 과세표준 → 산출세액
// → 세액공제 → 결정세액 → 기납부 차감(환급/추납). 세율·공제 기준은 yearend_tax_params 시드(§7 T4).
// 모든 단계를 브레이크다운으로 반환해 산출 근거를 보존한다(§7 T5).
// 총급여·기납부·국민연금·건강/고용보험료는 확정 급여대장에서 자동 집계, 나머지 공제는 입력(간소화 파싱 포함).
// 인정상여(소득처분)는 대장에 없으므로 입력(deemedBonus)으로 총급여에 가산한다 — 2025 귀속 세무법인 대사: docs/yearend-2025-reconciliation.md

import { createHash } from "node:crypto";
import { getDb, withDbWrite, rowsToObjects, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
const hashId = (prefix: string, source: string) =>
  `${prefix}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;

// ── 파라미터 ──

type Bracket = [number | null, number, number] | [number | null, number, number, number];

export interface EarnedCreditCap {
  through: number | null;
  base: number;
  start: number;
  numerator: number;
  denominator: number;
  floor: number;
}

export interface YearendRuleEvidence {
  targetYear: number;
  ruleVersion: string;
  reviewedScope: string[];
  baseParamsYear: number;
  baseParamsHash: string;
  policyHash: string;
  policy: {
    earnedCreditCaps: EarnedCreditCap[];
    earnedCreditCalculation: { threshold: number; lowNumerator: number; highNumerator: number; denominator: number };
    standardCredit: number;
  };
  sources: unknown[];
  baseParams: Record<string, unknown>;
}

export interface YearendParams {
  basicBrackets: Bracket[]; // [상한, 세율, 누진공제]
  earnedIncomeDeduction: Bracket[]; // [상한, 율, 구간시작 누적, 구간시작]
  earnedIncomeDeductionCap: number;
  personalDeductionPer: number;
  elderlyExtra: number;
  disabledExtra: number;
  earnedTaxCredit: { threshold: number; rateLow: number; rateHigh: number; caps: Array<[number | null, number]> };
  pensionAccountCredit: { rateLow: number; rateHigh: number; grossThreshold: number; cap: number };
  insuranceCredit: { rate: number; cap: number };
  medicalCredit: { rate: number; grossFloorRate: number; dependentCap: number };
  educationCredit: { rate: number };
  donationCredit: { rate: number; highRate: number; highThreshold: number };
  monthlyRentCredit: { rate: number; rateLow: number; grossThreshold: number; cap: number; grossLimit: number };
  cardDeduction: {
    floorRate: number;
    creditRate: number;
    checkCashRate: number;
    traditionalTransitRate: number;
    baseCap: Array<[number | null, number]>;
    extraCap: number;
  };
  childCredit: number[];
  standardCredit: number;
  localRate: number;
  ruleEvidence?: YearendRuleEvidence;
}

export async function loadYearendParams(targetYear: number, transaction?: PgDatabase): Promise<YearendParams> {
  const db = transaction ?? await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT r.target_year, r.rule_version, r.base_params_year, r.reviewed_scope, r.policy, r.sources, b.params
         FROM yearend_rule_policies r JOIN yearend_tax_params b ON b.target_year = r.base_params_year
        WHERE r.target_year = $1${transaction ? " FOR SHARE OF r, b" : ""}`,
      [targetYear],
    ),
  );
  if (!rows.length) throw Object.assign(new Error(`${targetYear}년의 검증된 계산 규칙이 없습니다. 다른 연도 규칙으로 대신 계산하지 않았습니다.`), { status: 422 });
  const r = rows[0];
  const parse = (v: unknown) => typeof v === "string" ? JSON.parse(v) : v;
  const baseParams = parse(r.params) as Record<string, unknown>;
  const policyIdentity = {
    targetYear: Number(r.target_year), ruleVersion: String(r.rule_version),
    reviewedScope: parse(r.reviewed_scope) as string[], baseParamsYear: Number(r.base_params_year),
    policy: parse(r.policy) as YearendRuleEvidence["policy"], sources: parse(r.sources) as unknown[],
  };
  const ruleEvidence: YearendRuleEvidence = {
    ...policyIdentity, policyHash: valueHash(policyIdentity), baseParamsHash: valueHash(baseParams), baseParams,
  };
  return { ...baseParams, ruleEvidence } as unknown as YearendParams;
}

// ── 공제 입력 (관리자 입력 + 간소화 PDF 파싱) ──

export interface YearendInputs {
  deemedBonus?: number; // 인정상여(법인세 소득처분 — 급여대장에 없어 총급여에 가산, 원천징수 없음 → 결정세액 전액 정산)
  deemedBonusWithheld?: number; // 인정상여에 대해 소득금액변동통지로 이미 원천징수한 소득세(있으면 기납부에 가산)
  nationalPensionPaid?: number; // 국민연금 납부액(간소화·납부확인서) — 입력 시 급여대장 공제액 대신 사용
  healthInsurancePaid?: number; // 건강+장기요양 납부액(간소화 공단 고지, 정산분 포함) — 입력 시 대장값 대신
  employmentInsurancePaid?: number; // 고용보험 납부액 — 입력 시 대장값 대신(세무법인 실무는 대장 공제액)
  dependents?: number; // 기본공제 대상 부양가족 수(본인 제외)
  elderly?: number; // 경로우대(70세 이상) 수
  disabled?: number; // 장애인 수
  children?: number; // 자녀세액공제 대상(8세 이상) 수
  housingLoanDeduction?: number; // 주택자금 소득공제(원리금·이자 계산액 — 입력)
  cardCredit?: number; // 신용카드 사용액
  cardCheckCash?: number; // 직불·현금영수증
  cardTraditionalTransit?: number; // 전통시장+대중교통
  pensionAccount?: number; // 연금저축+IRP 납입액
  insurancePremium?: number; // 보장성 보험료
  medicalExpense?: number; // 의료비 총액
  educationExpense?: number; // 교육비
  donation?: number; // 일반 기부금
  monthlyRent?: number; // 월세 지급액
  otherIncomeDeduction?: number; // 기타 소득공제(수동 보정)
  otherTaxCredit?: number; // 기타 세액공제(수동 보정)
  otherIncomeDeductionType?: "independent" | "special";
  otherIncomeDeductionReason?: string;
  otherTaxCreditType?: "independent" | "special" | "politicalDonation" | "hometownDonation" | "employeeStockDonation";
  otherTaxCreditReason?: string;
}

/** 기존 합계 호출과 main의 분리 집계를 모두 받되 둘을 중복 합산하지 않는다. */
export type YearendAuto = { nationalPension: number } & (
  | { healthInsurance: number; employmentInsurance: number; healthEmployment?: number }
  | { healthEmployment: number; healthInsurance?: never; employmentInsurance?: never }
);

export interface BreakdownLine {
  label: string;
  amount: number;
  note?: string;
}

export interface YearendResult {
  grossPay: number; // 총급여 = 급여대장 과세 지급 합 + 인정상여
  deemedBonus: number;
  earnedIncomeDeduction: number;
  earnedIncome: number; // 근로소득금액
  incomeDeductions: BreakdownLine[];
  incomeDeductionTotal: number;
  taxBase: number; // 과세표준
  calculatedTax: number; // 산출세액
  taxCredits: BreakdownLine[];
  taxCreditTotal: number;
  determinedTax: number; // 결정세액
  prepaidTax: number;
  balance: number; // 결정 - 기납부 (음수 = 환급)
  localTax: number; // 지방소득세 차감징수(10%)
  usedStandardCredit: boolean;
  ruleEvidence?: YearendRuleEvidence; // Absent on historical saved results; never backfilled.
  choice?: {
    selected: "standard" | "special";
    reason: string;
    candidates: Record<"standard" | "special", {
      taxBase: number; calculatedTax: number; earnedTaxCredit: number;
      incomeDeductionTotal: number; taxCreditTotal: number; determinedTax: number;
    }>;
  };
}

const floorWon = (n: number) => Math.max(0, Math.floor(n));

function bracketAmount(brackets: Bracket[], value: number): { rate: number; result: number } {
  for (const b of brackets) {
    const [cap, rate, acc, start] = [b[0], b[1], b[2], (b as number[])[3]];
    if (cap == null || value <= cap) {
      if (start !== undefined) return { rate, result: acc + (value - (start as number)) * rate }; // 누적식(근로소득공제)
      return { rate, result: value * rate - acc }; // 누진공제식(기본세율)
    }
  }
  return { rate: 0, result: 0 };
}

function capFor(caps: Array<[number | null, number]>, gross: number): number {
  for (const [cap, v] of caps) if (cap == null || gross <= cap) return v;
  return 0;
}

/**
 * 연말정산 계산 — 자동 집계값(gross/prepaid/공적보험)과 공제 입력으로 결정세액·환급액 산출.
 * @param auto 급여대장 자동 집계: nationalPension(국민연금 본인), healthInsurance(건강+장기요양), employmentInsurance(고용).
 *   입력에 *Paid 값이 있으면(간소화·납부확인서) 그 값이 대장값을 대체한다 — 세무법인 실무는 건강·요양·연금 = 간소화, 고용 = 대장.
 */
function computeYearendPath(
  grossPay: number,
  prepaidTax: number,
  auto: YearendAuto,
  inputs: YearendInputs,
  p: YearendParams,
  path: "standard" | "special",
): YearendResult {
  const deemedBonus = floorWon(inputs.deemedBonus ?? 0);
  const gross = floorWon(grossPay) + deemedBonus; // ⑮ 인정상여는 급여대장 밖 소득처분 — 총급여에 가산(2025 귀속 실증: 이재영)

  // 1) 근로소득공제 → 근로소득금액
  const eid = Math.min(floorWon(bracketAmount(p.earnedIncomeDeduction, gross).result), p.earnedIncomeDeductionCap);
  const earnedIncome = floorWon(gross - eid);

  // 2) 소득공제
  const incomeDeductions: BreakdownLine[] = [];
  const push = (label: string, amount: number, note?: string) => {
    if (amount > 0) incomeDeductions.push({ label, amount: floorWon(amount), note });
  };
  push("인적공제 — 본인", p.personalDeductionPer);
  push("인적공제 — 부양가족", (inputs.dependents ?? 0) * p.personalDeductionPer, `${inputs.dependents ?? 0}명`);
  push("추가공제 — 경로우대", (inputs.elderly ?? 0) * p.elderlyExtra);
  push("추가공제 — 장애인", (inputs.disabled ?? 0) * p.disabledExtra);
  const paidOr = (paid: number | undefined, fallback: number): [number, string] =>
    paid != null && paid > 0 ? [floorWon(paid), "납부액 입력"] : [fallback, "급여대장 자동"];
  const [npsAmt, npsNote] = paidOr(inputs.nationalPensionPaid, auto.nationalPension);
  push("연금보험료 — 국민연금", npsAmt, npsNote);
  if (path === "special") {
    if (auto.healthInsurance !== undefined && auto.employmentInsurance !== undefined) {
      const [healthAmt, healthNote] = paidOr(inputs.healthInsurancePaid, auto.healthInsurance);
      const [eiAmt, eiNote] = paidOr(inputs.employmentInsurancePaid, auto.employmentInsurance);
      push("특별소득공제 — 건강·장기요양보험료", healthAmt, healthNote);
      push("특별소득공제 — 고용보험료", eiAmt, eiNote);
    } else {
      // 기존 합계 입력의 항목·금액을 유지하고 건강/고용으로 임의 분리하지 않는다.
      push("특별소득공제 — 건강·고용보험료", auto.healthEmployment!, "급여대장 자동");
    }
    push("특별소득공제 — 주택자금", inputs.housingLoanDeduction ?? 0);
  }
  // 신용카드 등 — 총급여 25% 초과 사용분
  {
    const c = p.cardDeduction;
    const totalUse = (inputs.cardCredit ?? 0) + (inputs.cardCheckCash ?? 0) + (inputs.cardTraditionalTransit ?? 0);
    const floor = gross * c.floorRate;
    if (totalUse > floor) {
      // 초과분을 공제율 낮은 항목(신용카드)부터 소진하는 국세청 방식 근사
      const credit = inputs.cardCredit ?? 0;
      const checkCash = inputs.cardCheckCash ?? 0;
      const tt = inputs.cardTraditionalTransit ?? 0;
      const usedFloorFromCredit = Math.min(credit, floor);
      const usedFloorFromCheck = Math.min(checkCash, Math.max(0, floor - usedFloorFromCredit));
      const usedFloorFromTt = Math.max(0, floor - usedFloorFromCredit - usedFloorFromCheck);
      const deduct =
        (credit - usedFloorFromCredit) * c.creditRate +
        (checkCash - usedFloorFromCheck) * c.checkCashRate +
        (tt - usedFloorFromTt) * c.traditionalTransitRate;
      const capped = Math.min(floorWon(deduct), capFor(c.baseCap, gross) + Math.min(floorWon(tt * c.traditionalTransitRate), c.extraCap));
      push("신용카드 등 사용금액", capped, `사용 합계 ${totalUse.toLocaleString("ko-KR")}`);
    }
  }
  if (path === "special" || inputs.otherIncomeDeductionType === "independent") {
    push(inputs.otherIncomeDeductionType === "special" ? "특별소득공제 — 기타 확인액" : "기타 소득공제 — 병용 가능 확인액",
      inputs.otherIncomeDeduction ?? 0, inputs.otherIncomeDeductionReason);
  }
  const incomeDeductionTotal = incomeDeductions.reduce((a, l) => a + l.amount, 0);

  // 3) 과세표준 → 산출세액
  const taxBase = floorWon(earnedIncome - incomeDeductionTotal);
  const calculatedTax = floorWon(bracketAmount(p.basicBrackets, taxBase).result);

  // 4) 세액공제
  const taxCredits: BreakdownLine[] = [];
  const pushCredit = (label: string, amount: number, note?: string) => {
    if (amount > 0) taxCredits.push({ label, amount: floorWon(amount), note });
  };
  // 근로소득세액공제
  pushCredit("근로소득세액공제", calculateEarnedTaxCredit(gross, calculatedTax, p));
  // 자녀
  {
    const n = inputs.children ?? 0;
    let sum = 0;
    for (let i = 0; i < Math.min(n, p.childCredit.length); i += 1) sum += p.childCredit[i];
    if (n > p.childCredit.length) sum += (n - p.childCredit.length) * p.childCredit[p.childCredit.length - 1];
    pushCredit("자녀세액공제", sum, n ? `${n}명` : undefined);
  }
  // 연금계좌
  {
    const pa = p.pensionAccountCredit;
    const base = Math.min(inputs.pensionAccount ?? 0, pa.cap);
    pushCredit("연금계좌", base * (gross <= pa.grossThreshold ? pa.rateLow : pa.rateHigh));
  }
  // The two legal paths are calculated independently, including their different income deductions.
  const specials: BreakdownLine[] = [];
  {
    const ins = Math.min(inputs.insurancePremium ?? 0, p.insuranceCredit.cap);
    if (ins > 0) specials.push({ label: "보험료", amount: floorWon(ins * p.insuranceCredit.rate) });
    const medFloor = gross * p.medicalCredit.grossFloorRate;
    const med = Math.max(0, Math.min(inputs.medicalExpense ?? 0, p.medicalCredit.dependentCap + medFloor) - medFloor);
    if (med > 0) specials.push({ label: "의료비", amount: floorWon(med * p.medicalCredit.rate), note: `총급여 3%(${floorWon(medFloor).toLocaleString("ko-KR")}) 초과분` });
    const edu = inputs.educationExpense ?? 0;
    if (edu > 0) specials.push({ label: "교육비", amount: floorWon(edu * p.educationCredit.rate) });
    const don = inputs.donation ?? 0;
    if (don > 0) {
      const d = p.donationCredit;
      const amount = don <= d.highThreshold ? don * d.rate : d.highThreshold * d.rate + (don - d.highThreshold) * d.highRate;
      specials.push({ label: "기부금", amount: floorWon(amount) });
    }
    const rent = p.monthlyRentCredit;
    if ((inputs.monthlyRent ?? 0) > 0 && gross <= rent.grossLimit) {
      const base = Math.min(inputs.monthlyRent ?? 0, rent.cap);
      specials.push({ label: "월세", amount: floorWon(base * (gross <= rent.grossThreshold ? rent.rateLow : rent.rate)) });
    }
  }
  const usedStandardCredit = path === "standard";
  if (usedStandardCredit) pushCredit("표준세액공제", p.ruleEvidence!.policy.standardCredit, "특별소득·특별세액·월세 공제 미적용");
  else for (const s of specials) pushCredit(`특별세액공제 — ${s.label}`, s.amount, s.note);
  if (path === "special" || inputs.otherTaxCreditType !== "special") {
    const labels = { independent: "기타 세액공제 — 병용 가능 확인액", special: "특별세액공제 — 기타 확인액",
      politicalDonation: "정치자금 기부금 세액공제 확인액", hometownDonation: "고향사랑 기부금 세액공제 확인액",
      employeeStockDonation: "우리사주조합 기부금 세액공제 확인액" };
    pushCredit(labels[inputs.otherTaxCreditType ?? "independent"], inputs.otherTaxCredit ?? 0, inputs.otherTaxCreditReason);
  }

  const taxCreditTotal = taxCredits.reduce((a, l) => a + l.amount, 0);

  // 5) 결정세액 → 차감징수(음수 = 환급)
  const determinedTax = floorWon(calculatedTax - taxCreditTotal);
  const prepaid = floorWon(prepaidTax) + floorWon(inputs.deemedBonusWithheld ?? 0);
  const balance = determinedTax - prepaid;
  const localTax = Math.trunc(balance * p.localRate); // 지방소득세는 동일 부호로 10%

  return {
    grossPay: gross,
    deemedBonus,
    earnedIncomeDeduction: eid,
    earnedIncome,
    incomeDeductions,
    incomeDeductionTotal,
    taxBase,
    calculatedTax,
    taxCredits,
    taxCreditTotal,
    determinedTax,
    prepaidTax: prepaid,
    balance,
    localTax,
    usedStandardCredit,
  };
}

// ── 급여대장 자동 집계 ──

export interface YearendEmployeeBase {
  employeeId: string;
  name: string;
  deptName: string | null;
  grossPay: number; // 과세 지급 합
  nonTaxablePay: number;
  prepaidTax: number; // income-tax 만 — 'settle-income'(정산-근로소득세)은 전년도 정산·소득처분 원천징수분이라 제외(2025 귀속 대사 실증)
  nationalPension: number; // 'nps' 만 — 정산열(settle-nps)은 제외
  healthInsurance: number; // nhis + ltc (정산열 제외)
  employmentInsurance: number; // ei (정산열 제외)
  healthEmployment: number; // healthInsurance + employmentInsurance (화면 호환)
  monthCount: number;
}

/**
 * 귀속연도 확정 급여대장에서 직원별 총급여·기납부·공적보험 자동 집계.
 * 정산열(settle-*)은 전년도 정산·환급이 섞여 있어 제외한다 — 2025 귀속 대사에서 2월 대장의 '정산-건강보험/국민연금' 열에
 * 전년도 연말정산 환급이 기입돼 있던 사례(마이그 222로 교정) 참고. 공단 고지액과의 차이는 *Paid 입력으로 대체.
 */
export async function buildYearendBase(targetYear: number, transaction?: PgDatabase): Promise<YearendEmployeeBase[]> {
  const db = transaction ?? await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT pe.employee_id, max(pe.name) AS name, max(pe.dept_name) AS dept_name,
              count(DISTINCT pl.ledger_id) AS month_count,
              COALESCE(SUM(CASE WHEN pid.kind = 'pay' AND COALESCE(pid.taxable, 1) = 1 THEN pel.amount END), 0) AS taxable_pay,
              COALESCE(SUM(CASE WHEN pid.kind = 'pay' AND pid.taxable = 0 THEN pel.amount END), 0) AS nontax_pay,
              COALESCE(SUM(CASE WHEN pel.item_id = 'income-tax' THEN pel.amount END), 0) AS prepaid_tax,
              COALESCE(SUM(CASE WHEN pel.item_id = 'nps' THEN pel.amount END), 0) AS nps,
              COALESCE(SUM(CASE WHEN pel.item_id IN ('nhis', 'ltc') THEN pel.amount END), 0) AS health,
              COALESCE(SUM(CASE WHEN pel.item_id = 'ei' THEN pel.amount END), 0) AS employment
         FROM payroll_ledgers pl
         JOIN payroll_entries pe ON pe.ledger_id = pl.ledger_id
         JOIN payroll_entry_lines pel ON pel.entry_id = pe.entry_id
         JOIN payroll_item_defs pid ON pid.item_id = pel.item_id
        WHERE pl.status = 'confirmed' AND pl.pay_year = $1 AND pe.employee_id IS NOT NULL
        GROUP BY pe.employee_id
        ORDER BY max(pe.name)`,
      [targetYear],
    ),
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    name: String(r.name ?? ""),
    deptName: r.dept_name ? String(r.dept_name) : null,
    grossPay: Math.round(Number(r.taxable_pay || 0)),
    nonTaxablePay: Math.round(Number(r.nontax_pay || 0)),
    prepaidTax: Math.round(Number(r.prepaid_tax || 0)),
    nationalPension: Math.round(Number(r.nps || 0)),
    healthInsurance: Math.round(Number(r.health || 0)),
    employmentInsurance: Math.round(Number(r.employment || 0)),
    healthEmployment: Math.round(Number(r.health || 0)) + Math.round(Number(r.employment || 0)),
    monthCount: Number(r.month_count || 0),
  }));
}

// ── 정산 스냅 저장/조회 ──

export interface SettlementRow extends YearendEmployeeBase {
  settleId: string | null;
  status: string;
  inputs: YearendInputs;
  result: YearendResult | null;
  memo: string | null;
}

export async function listSettlements(targetYear: number): Promise<SettlementRow[]> {
  const base = await buildYearendBase(targetYear);
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT s.settle_id, s.employee_id, s.status, s.gross_pay, s.prepaid_tax, s.inputs, s.result, s.memo,
              ep.name AS employee_name
         FROM yearend_settlements s LEFT JOIN employee_profiles ep ON ep.employee_id = s.employee_id
        WHERE s.target_year = $1`,
      [targetYear],
    ),
  );
  const byEmp = new Map(rows.map((r) => [String(r.employee_id), r]));
  // A saved confirmation remains accessible even when its source payroll is no longer in the live aggregate.
  const baseIds = new Set(base.map((b) => b.employeeId));
  for (const saved of rows) {
    const employeeId = String(saved.employee_id);
    if (saved.status !== "confirmed" || baseIds.has(employeeId)) continue;
    base.push({ employeeId, name: String(saved.employee_name ?? employeeId), deptName: null,
      grossPay: Number(saved.gross_pay), prepaidTax: Number(saved.prepaid_tax),
      nonTaxablePay: 0, nationalPension: 0, healthInsurance: 0, employmentInsurance: 0, healthEmployment: 0, monthCount: 0 });
  }
  return base.map((b) => {
    const s = byEmp.get(b.employeeId);
    const parse = (v: unknown) => {
      try {
        const parsed = typeof v === "string" ? JSON.parse(v) : v;
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        return null;
      }
    };
    return {
      ...b,
      grossPay: s?.status === "confirmed" ? Number(s.gross_pay) : b.grossPay,
      prepaidTax: s?.status === "confirmed" ? Number(s.prepaid_tax) : b.prepaidTax,
      settleId: s ? String(s.settle_id) : null,
      status: s ? String(s.status) : "draft",
      inputs: (s ? (parse(s.inputs) as YearendInputs) : null) ?? {},
      result: s ? (parse(s.result) as YearendResult | null) : null,
      memo: s?.memo ? String(s.memo) : null,
    };
  });
}

/** Serializes save/confirm even before this employee's first settlement row exists. */
async function lockSettlement(db: PgDatabase, targetYear: number, employeeId: string): Promise<Record<string, unknown> | undefined> {
  if (!Number.isInteger(targetYear) || targetYear < 1900 || targetYear > 9999 || typeof employeeId !== "string" || !employeeId.trim()) {
    throw Object.assign(new Error("올바른 귀속연도와 직원을 지정해 주세요."), { status: 400 });
  }
  await db.exec("SELECT pg_advisory_xact_lock(724302, hashtext($1))", [`${targetYear}:${employeeId}`]);
  return rowsToObjects(await db.exec(
    "SELECT settle_id, status, result, inputs, confirmed_at FROM yearend_settlements WHERE target_year = $1 AND employee_id = $2 FOR UPDATE",
    [targetYear, employeeId],
  ))[0];
}

function inputError(message: string): never { throw Object.assign(new Error(message), { status: 400 }); }

const AMOUNT_KEYS = ["deemedBonus", "deemedBonusWithheld", "nationalPensionPaid", "healthInsurancePaid", "employmentInsurancePaid", "dependents", "elderly", "disabled", "children", "housingLoanDeduction", "cardCredit",
  "cardCheckCash", "cardTraditionalTransit", "pensionAccount", "insurancePremium", "medicalExpense",
  "educationExpense", "donation", "monthlyRent", "otherIncomeDeduction", "otherTaxCredit"] as const;

function validateCalculationInputs(grossPay: number, prepaidTax: number, auto: YearendAuto, inputs: YearendInputs): void {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) inputError("공제 입력 형식이 올바르지 않습니다.");
  const hasSplitInsurance = auto?.healthInsurance !== undefined || auto?.employmentInsurance !== undefined;
  const amounts = [grossPay, prepaidTax, auto?.nationalPension,
    ...(hasSplitInsurance ? [auto.healthInsurance, auto.employmentInsurance] : [auto?.healthEmployment]),
    ...(hasSplitInsurance && auto.healthEmployment !== undefined ? [auto.healthEmployment] : []),
    ...AMOUNT_KEYS.map((key) => inputs[key] ?? 0),
    grossPay + (inputs.deemedBonus ?? 0), prepaidTax + (inputs.deemedBonusWithheld ?? 0)];
  if (amounts.some((v) => typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)) inputError("금액과 인원은 0 이상의 정수로 입력하세요. 음수 공적보험료·기납부액은 원본을 확인해 주세요.");
  if (!hasSplitInsurance && ((inputs.healthInsurancePaid ?? 0) > 0 || (inputs.employmentInsurancePaid ?? 0) > 0)) {
    inputError("건강·고용보험 납부액을 개별 대체하려면 급여대장의 분리 집계값이 필요합니다.");
  }
  const reasonValid = (v: unknown) => typeof v === "string" && v.trim().length >= 5 && v.trim().length <= 2000;
  if ((inputs.otherIncomeDeduction ?? 0) > 0 &&
    (!["independent", "special"].includes(inputs.otherIncomeDeductionType ?? "") || !reasonValid(inputs.otherIncomeDeductionReason))) {
    inputError("기타 소득공제의 표준공제 병용 여부와 법정 항목·금액 근거를 입력하세요.");
  }
  if ((inputs.otherTaxCredit ?? 0) > 0 &&
    (!["independent", "special", "politicalDonation", "hometownDonation", "employeeStockDonation"].includes(inputs.otherTaxCreditType ?? "") || !reasonValid(inputs.otherTaxCreditReason))) {
    inputError("기타 세액공제의 종류와 공제세액 산정 근거를 입력하세요. 기부 지출액을 공제세액으로 입력하지 마세요.");
  }
}

/** Exact integer arithmetic retains the decline before discarding fractions of a won. */
export function calculateEarnedTaxCredit(grossPay: number, calculatedTax: number, p: YearendParams): number {
  if (![grossPay, calculatedTax].every((v) => Number.isSafeInteger(v) && v >= 0)) inputError("총급여와 산출세액은 0 이상의 정수여야 합니다.");
  const policy = p.ruleEvidence?.policy;
  const cap = policy?.earnedCreditCaps.find((r) => r.through === null || grossPay <= r.through);
  const calc = policy?.earnedCreditCalculation;
  if (!cap || !calc || ![cap.base, cap.start, cap.numerator, cap.denominator, cap.floor,
    calc.threshold, calc.lowNumerator, calc.highNumerator, calc.denominator].every(Number.isSafeInteger)
    || cap.denominator <= 0 || calc.denominator <= 0 || cap.numerator < 0 || cap.floor < 0) {
    throw Object.assign(new Error("근로소득세액공제의 검증된 규칙이 없습니다."), { status: 422 });
  }
  const denominator = BigInt(cap.denominator);
  const declining = BigInt(cap.base) * denominator - BigInt(Math.max(0, grossPay - cap.start)) * BigInt(cap.numerator);
  const minimum = BigInt(cap.floor) * denominator;
  const capWon = (declining < minimum ? minimum : declining) / denominator;
  const tax = BigInt(calculatedTax), threshold = BigInt(calc.threshold);
  const rawNumerator = tax <= threshold ? tax * BigInt(calc.lowNumerator)
    : threshold * BigInt(calc.lowNumerator) + (tax - threshold) * BigInt(calc.highNumerator);
  const rawWon = rawNumerator / BigInt(calc.denominator);
  return Number(rawWon < capWon ? rawWon : capWon);
}

/** Compare final national income tax under two legally separate deduction paths. */
export function computeYearend(grossPay: number, prepaidTax: number,
  auto: YearendAuto, inputs: YearendInputs, p: YearendParams): YearendResult {
  validateCalculationInputs(grossPay, prepaidTax, auto, inputs);
  if (!p.ruleEvidence || p.ruleEvidence.ruleVersion !== "g00b-p010-p011-v1") {
    throw Object.assign(new Error("현재 연말정산 계산 규칙을 불러온 뒤 다시 계산하세요."), { status: 422 });
  }
  const standard = computeYearendPath(grossPay, prepaidTax, auto, inputs, p, "standard");
  const special = computeYearendPath(grossPay, prepaidTax, auto, inputs, p, "special");
  for (const r of [standard, special]) {
    if ([r.grossPay, r.earnedIncome, r.incomeDeductionTotal, r.taxBase, r.calculatedTax, r.taxCreditTotal, r.determinedTax, r.balance]
      .some((n) => !Number.isSafeInteger(n))) inputError("계산 가능한 금액 범위를 초과했습니다. 입력을 확인하세요.");
  }
  const selected = standard.determinedTax < special.determinedTax ? "standard" : "special";
  const summarize = (r: YearendResult) => ({
    taxBase: r.taxBase, calculatedTax: r.calculatedTax, incomeDeductionTotal: r.incomeDeductionTotal,
    earnedTaxCredit: r.taxCredits.find((line) => line.label === "근로소득세액공제")?.amount ?? 0,
    taxCreditTotal: r.taxCreditTotal, determinedTax: r.determinedTax,
  });
  return {
    ...(selected === "standard" ? standard : special), ruleEvidence: p.ruleEvidence,
    choice: {
      selected, reason: standard.determinedTax === special.determinedTax
        ? "결정세액이 같아 입력한 특별공제 경로를 유지했습니다."
        : "각 경로의 소득공제·세액공제를 모두 반영한 결정세액이 작은 쪽을 선택했습니다.",
      candidates: { standard: summarize(standard), special: summarize(special) },
    },
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalValue(item)]),
  );
  return value;
}
const valueHash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
const settlementHash = (row: { inputs?: unknown; result?: unknown }) =>
  createHash("sha256").update(JSON.stringify(canonicalValue({ inputs: row.inputs, result: row.result }))).digest("hex");

/** 공제 입력 저장 + 재계산 스냅. 확정본은 명시적으로 확정 취소하기 전 변경하지 않는다. */
export async function saveSettlement(targetYear: number, employeeId: string, inputs: YearendInputs, memo?: string | null, actorUserId: string | null = null): Promise<YearendResult> {
  return withDbWrite(async (db) => {
    const previous = await lockSettlement(db, targetYear, employeeId);
    if (previous && previous.status !== "draft") {
      throw Object.assign(new Error("확정된 연말정산은 다시 계산하거나 저장할 수 없습니다. 변경하려면 확정 취소 후 검토해 주세요."), { status: 409 });
    }
    const base = (await buildYearendBase(targetYear, db)).find((b) => b.employeeId === employeeId);
    if (!base) throw Object.assign(new Error("해당 연도 급여대장에 없는 직원입니다."), { status: 404 });
    const params = await loadYearendParams(targetYear, db);
    const result = computeYearend(
      base.grossPay, base.prepaidTax,
      { nationalPension: base.nationalPension, healthInsurance: base.healthInsurance, employmentInsurance: base.employmentInsurance }, inputs, params,
    );
    const settleId = hashId("ye", `${targetYear}:${employeeId}`);
    const changed = rowsToObjects(await db.exec(
      `INSERT INTO yearend_settlements (settle_id, target_year, employee_id, gross_pay, prepaid_tax, inputs, result, memo, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NULLIF($8, ''), $9, $9)
       ON CONFLICT (target_year, employee_id) DO UPDATE SET
         gross_pay = EXCLUDED.gross_pay, prepaid_tax = EXCLUDED.prepaid_tax,
         inputs = EXCLUDED.inputs, result = EXCLUDED.result, memo = COALESCE(EXCLUDED.memo, yearend_settlements.memo),
         status = 'draft', updated_at = $9
       WHERE yearend_settlements.status = 'draft'
       RETURNING settle_id`,
      [settleId, targetYear, employeeId, base.grossPay, base.prepaidTax, JSON.stringify(inputs), JSON.stringify(result), memo ?? "", KST_NOW()],
    ));
    if (!changed.length) throw Object.assign(new Error("연말정산 상태가 변경되어 저장하지 않았습니다. 새로고침 후 확인해 주세요."), { status: 409 });
    await recordAuditLogInline(db, {
      actorUserId, action: "yearend_save", targetTable: "yearend_settlements", targetId: String(changed[0].settle_id),
      before: previous ? { status: previous.status, snapshotHash: settlementHash(previous) } : null,
      after: { status: "draft", snapshotHash: settlementHash({ inputs, result }) },
    });
    return result;
  });
}

export async function setSettlementStatus(targetYear: number, employeeId: string, status: "draft" | "confirmed", actorUserId: string | null = null): Promise<void> {
  await withDbWrite(async (db) => {
    if (status !== "draft" && status !== "confirmed") throw Object.assign(new Error("올바른 정산 상태를 지정해 주세요."), { status: 400 });
    const previous = await lockSettlement(db, targetYear, employeeId);
    if (!previous) throw Object.assign(new Error("저장된 연말정산이 없습니다. 먼저 계산해 주세요."), { status: 404 });
    if (previous.status !== "draft" && previous.status !== "confirmed") throw Object.assign(new Error("현재 연말정산 상태에서는 변경할 수 없습니다."), { status: 409 });
    if (previous.status === status) return; // Retries must not move the confirmation timestamp.
    if (status === "confirmed" && !previous.result) throw Object.assign(new Error("계산 결과가 없는 연말정산은 확정할 수 없습니다."), { status: 409 });
    if (status === "confirmed") {
      const stored = (previous.result as YearendResult).ruleEvidence;
      const current = (await loadYearendParams(targetYear, db)).ruleEvidence!;
      if (!stored || stored.targetYear !== targetYear || stored.ruleVersion !== current.ruleVersion
        || stored.policyHash !== current.policyHash || stored.baseParamsHash !== current.baseParamsHash) {
        throw Object.assign(new Error("계산 규칙이 없거나 변경된 초안입니다. 현재 규칙으로 다시 계산한 뒤 확정하세요."), { status: 409 });
      }
    }
    const changed = rowsToObjects(await db.exec(
      `UPDATE yearend_settlements SET status = $3, confirmed_at = CASE WHEN $3 = 'confirmed' THEN $4 ELSE NULL END, updated_at = $4
        WHERE target_year = $1 AND employee_id = $2 AND status = $5 RETURNING settle_id`,
      [targetYear, employeeId, status, KST_NOW(), previous.status],
    ));
    if (!changed.length) throw Object.assign(new Error("연말정산 상태가 변경되었습니다. 새로고침 후 확인해 주세요."), { status: 409 });
    await recordAuditLogInline(db, {
      actorUserId, action: "yearend_status", targetTable: "yearend_settlements", targetId: String(previous.settle_id),
      before: { status: previous.status, confirmedAt: previous.confirmed_at, snapshotHash: settlementHash(previous) },
      after: { status, snapshotHash: settlementHash(previous) },
    });
  });
}
