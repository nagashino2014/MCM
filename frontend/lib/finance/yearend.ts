// 연말정산 계산 엔진 (블루프린트 P8) — 총급여 → 근로소득공제 → 소득공제 → 과세표준 → 산출세액
// → 세액공제 → 결정세액 → 기납부 차감(환급/추납). 세율·공제 기준은 yearend_tax_params 시드(§7 T4).
// 모든 단계를 브레이크다운으로 반환해 산출 근거를 보존한다(§7 T5).
// 총급여·기납부·국민연금·건강/고용보험료는 확정 급여대장에서 자동 집계, 나머지 공제는 입력(간소화 파싱 포함).

import { createHash } from "node:crypto";
import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
const hashId = (prefix: string, source: string) =>
  `${prefix}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;

// ── 파라미터 ──

type Bracket = [number | null, number, number] | [number | null, number, number, number];

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
}

export async function loadYearendParams(targetYear: number): Promise<YearendParams> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT params FROM yearend_tax_params WHERE target_year <= $1 ORDER BY target_year DESC LIMIT 1`, [targetYear]),
  );
  if (!rows.length) throw Object.assign(new Error("연말정산 세율 파라미터가 없습니다(마이그 184)."), { status: 500 });
  return (typeof rows[0].params === "string" ? JSON.parse(String(rows[0].params)) : rows[0].params) as YearendParams;
}

// ── 공제 입력 (관리자 입력 + 간소화 PDF 파싱) ──

export interface YearendInputs {
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
}

export interface BreakdownLine {
  label: string;
  amount: number;
  note?: string;
}

export interface YearendResult {
  grossPay: number;
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
 * @param auto 급여대장 자동 집계: nationalPension(국민연금 본인), healthEmployment(건강+장기요양+고용 본인)
 */
export function computeYearend(
  grossPay: number,
  prepaidTax: number,
  auto: { nationalPension: number; healthEmployment: number },
  inputs: YearendInputs,
  p: YearendParams,
): YearendResult {
  const gross = floorWon(grossPay);

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
  push("연금보험료 — 국민연금", auto.nationalPension, "급여대장 자동");
  push("특별소득공제 — 건강·고용보험료", auto.healthEmployment, "급여대장 자동");
  push("주택자금", inputs.housingLoanDeduction ?? 0);
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
  push("기타 소득공제", inputs.otherIncomeDeduction ?? 0, "수동 보정");
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
  {
    const e = p.earnedTaxCredit;
    const raw = calculatedTax <= e.threshold ? calculatedTax * e.rateLow : e.threshold * e.rateLow + (calculatedTax - e.threshold) * e.rateHigh;
    pushCredit("근로소득세액공제", Math.min(floorWon(raw), capFor(e.caps, gross)));
  }
  // 자녀
  {
    const n = inputs.children ?? 0;
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += p.childCredit[Math.min(i, p.childCredit.length - 1)];
    pushCredit("자녀세액공제", sum, n ? `${n}명` : undefined);
  }
  // 연금계좌
  {
    const pa = p.pensionAccountCredit;
    const base = Math.min(inputs.pensionAccount ?? 0, pa.cap);
    pushCredit("연금계좌", base * (gross <= pa.grossThreshold ? pa.rateLow : pa.rateHigh));
  }
  // 특별세액공제 묶음(보험료·의료비·교육비·기부금) vs 표준세액공제 — 유리한 쪽 자동 선택
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
  const specialTotal = specials.reduce((a, l) => a + l.amount, 0);
  const usedStandardCredit = specialTotal < p.standardCredit;
  if (usedStandardCredit) pushCredit("표준세액공제", p.standardCredit, "특별공제 합계보다 유리");
  else for (const s of specials) pushCredit(`특별세액공제 — ${s.label}`, s.amount, s.note);
  pushCredit("기타 세액공제", inputs.otherTaxCredit ?? 0, "수동 보정");

  const taxCreditTotal = taxCredits.reduce((a, l) => a + l.amount, 0);

  // 5) 결정세액 → 차감징수(음수 = 환급)
  const determinedTax = floorWon(calculatedTax - taxCreditTotal);
  const prepaid = floorWon(prepaidTax);
  const balance = determinedTax - prepaid;
  const localTax = Math.trunc(balance * p.localRate); // 지방소득세는 동일 부호로 10%

  return {
    grossPay: gross,
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
  prepaidTax: number; // income-tax + settle-income (연말정산분 제외)
  nationalPension: number;
  healthEmployment: number; // nhis + ltc + ei
  monthCount: number;
}

/** 귀속연도 확정 급여대장에서 직원별 총급여·기납부·공적보험 자동 집계. */
export async function buildYearendBase(targetYear: number): Promise<YearendEmployeeBase[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT pe.employee_id, max(pe.name) AS name, max(pe.dept_name) AS dept_name,
              count(DISTINCT pl.ledger_id) AS month_count,
              COALESCE(SUM(CASE WHEN pid.kind = 'pay' AND COALESCE(pid.taxable, 1) = 1 THEN pel.amount END), 0) AS taxable_pay,
              COALESCE(SUM(CASE WHEN pid.kind = 'pay' AND pid.taxable = 0 THEN pel.amount END), 0) AS nontax_pay,
              COALESCE(SUM(CASE WHEN pel.item_id IN ('income-tax', 'settle-income') THEN pel.amount END), 0) AS prepaid_tax,
              COALESCE(SUM(CASE WHEN pel.item_id IN ('nps', 'settle-nps') THEN pel.amount END), 0) AS nps,
              COALESCE(SUM(CASE WHEN pel.item_id IN ('nhis', 'ltc', 'ei', 'settle-nhis', 'settle-ltc', 'settle-ei') THEN pel.amount END), 0) AS health_emp
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
    healthEmployment: Math.round(Number(r.health_emp || 0)),
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
      `SELECT settle_id, employee_id, status, inputs, result, memo FROM yearend_settlements WHERE target_year = $1`,
      [targetYear],
    ),
  );
  const byEmp = new Map(rows.map((r) => [String(r.employee_id), r]));
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
      settleId: s ? String(s.settle_id) : null,
      status: s ? String(s.status) : "draft",
      inputs: (s ? (parse(s.inputs) as YearendInputs) : null) ?? {},
      result: s ? (parse(s.result) as YearendResult | null) : null,
      memo: s?.memo ? String(s.memo) : null,
    };
  });
}

/** 공제 입력 저장 + 재계산 스냅. */
export async function saveSettlement(targetYear: number, employeeId: string, inputs: YearendInputs, memo?: string | null): Promise<YearendResult> {
  const base = (await buildYearendBase(targetYear)).find((b) => b.employeeId === employeeId);
  if (!base) throw Object.assign(new Error("해당 연도 급여대장에 없는 직원입니다."), { status: 404 });
  const params = await loadYearendParams(targetYear);
  const result = computeYearend(
    base.grossPay,
    base.prepaidTax,
    { nationalPension: base.nationalPension, healthEmployment: base.healthEmployment },
    inputs,
    params,
  );
  const settleId = hashId("ye", `${targetYear}:${employeeId}`);
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO yearend_settlements (settle_id, target_year, employee_id, gross_pay, prepaid_tax, inputs, result, memo, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NULLIF($8, ''), $9, $9)
       ON CONFLICT (target_year, employee_id) DO UPDATE SET
         gross_pay = EXCLUDED.gross_pay, prepaid_tax = EXCLUDED.prepaid_tax,
         inputs = EXCLUDED.inputs, result = EXCLUDED.result, memo = COALESCE(EXCLUDED.memo, yearend_settlements.memo),
         status = CASE WHEN yearend_settlements.status = 'confirmed' THEN 'confirmed' ELSE 'draft' END,
         updated_at = $9`,
      [settleId, targetYear, employeeId, base.grossPay, base.prepaidTax, JSON.stringify(inputs), JSON.stringify(result), memo ?? "", KST_NOW()],
    );
  });
  return result;
}

export async function setSettlementStatus(targetYear: number, employeeId: string, status: "draft" | "confirmed"): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE yearend_settlements SET status = $3, confirmed_at = CASE WHEN $3 = 'confirmed' THEN $4 ELSE NULL END, updated_at = $4
        WHERE target_year = $1 AND employee_id = $2`,
      [targetYear, employeeId, status, KST_NOW()],
    );
  });
}
