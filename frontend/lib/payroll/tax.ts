import { getDb, rowsToObjects } from "@/lib/db";

/**
 * 급여 공제 산출 규칙 (PL-P4, scripts/payroll_import/EDI_ANALYSIS.md 실측 확정)
 * - 고용보험 = 당월 과세급여 × 요율(자체 산정 — 고지액 아님)
 * - 장기요양 = 건강보험료 × 연도 요율 (건보료는 EDI 고지액)
 * - 소득세 = 간이세액표 lookup(공제대상가족수·8~20세 자녀 차감·개인 비율 80/100/120%)
 * - 지방소득세 = 소득세 × 10%, 10원 미만 절사 (3,133/3,134 실측)
 */

/** 과세급여 산정 시 제외하는 비과세 항목(2026-07 실측 검증: 출장숙박수당은 과세 — 이원종·이태하 +9만 시프트로 확정) */
export const NON_TAXABLE_ITEMS = ["meal", "vehicle", "childcare", "overtime-meal"] as const;

/**
 * 보험요율(162 payroll_insurance_rates) — 요율의 연도별 변동에 대응(2026-08-14 사용자 요청).
 * kind: 'ei'(고용보험, 과세급여 대비 %) | 'ltc'(장기요양, 건보료 대비 %).
 * 장기요양은 EDI 업로드 시 역산 자동 갱신(edi.ts), 고용보험은 설정 화면에서 수동 관리.
 */
export async function getInsuranceRate(
  kind: "ei" | "ltc" | "nps-max-age" | "ei-exempt-age",
  payYear: number,
  payMonth: number
): Promise<number> {
  const ym = `${payYear}-${String(payMonth).padStart(2, "0")}`;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT rate FROM payroll_insurance_rates
        WHERE kind = $1 AND valid_from <= $2 ORDER BY valid_from DESC LIMIT 1`,
      [kind, ym]
    )
  );
  if (!rows.length) throw Object.assign(new Error(`${kind} 요율이 설정돼 있지 않습니다(설정 > 세액 설정).`), { status: 400 });
  return Number(rows[0].rate);
}

/** 고용보험 = 과세급여 × 요율, 10원 미만 절사(실측 관례) */
export async function calcEmploymentIns(taxableWage: number, payYear: number, payMonth: number): Promise<number> {
  const rate = await getInsuranceRate("ei", payYear, payMonth);
  return Math.floor((taxableWage * rate) / 100 / 10) * 10;
}

/** 장기요양 = 건강보험료 × 요율, 10원 미만 절사 — EDI 미보유 월의 폴백·검증용 */
export async function calcLtc(nhisPremium: number, payYear: number, payMonth: number): Promise<number> {
  const rate = await getInsuranceRate("ltc", payYear, payMonth);
  return Math.floor((nhisPremium * rate) / 100 / 10) * 10;
}

/** 8세 이상 20세 이하 자녀 세액공제(간이세액표 이용 방법 3호, 2024.02.29 개정) */
export function childDeduction(children: number): number {
  if (children <= 0) return 0;
  if (children === 1) return 12500;
  return 29160 + Math.max(0, children - 2) * 25000;
}

export interface IncomeTaxResult {
  incomeTax: number;
  localTax: number;
  bracket: { wageFrom: number; wageTo: number | null; base: number } | null;
  outOfTable: boolean; // 표 범위 밖(월 1,000만 초과 산식 구간 등) — 수기 확인 필요
}

/**
 * 간이세액표 lookup — 월급여(비과세 제외) 기준.
 * dependents=공제대상가족수(본인 포함), children=8~20세 자녀수, ratePct=80|100|120.
 */
export async function lookupIncomeTax(
  monthlyTaxableWage: number,
  dependents: number,
  children: number,
  ratePct: number
): Promise<IncomeTaxResult> {
  const db = await getDb();
  const dep = Math.min(11, Math.max(1, dependents));
  const rows = rowsToObjects(
    await db.exec(
      `SELECT wage_from, wage_to, tax FROM income_tax_brackets
        WHERE year_version = (SELECT max(year_version) FROM income_tax_brackets)
          AND dependents = $1 AND wage_from <= $2 AND (wage_to IS NULL OR wage_to > $2)
        ORDER BY wage_from DESC LIMIT 1`,
      [dep, monthlyTaxableWage]
    )
  );
  const r = rows[0];
  if (!r) {
    // 표 최저 구간(77만) 미만은 세액 0, 최고 구간(1,000만) 초과는 산식 구간 — 수기 확인
    if (monthlyTaxableWage < 770000) {
      return { incomeTax: 0, localTax: 0, bracket: null, outOfTable: false };
    }
    return { incomeTax: 0, localTax: 0, bracket: null, outOfTable: true };
  }
  const base = Number(r.tax);
  // 자녀 차감 → 음수면 0 → 비율 적용(10원 미만 절사) → 지방세 10%(10원 미만 절사)
  const afterChild = Math.max(0, base - childDeduction(children));
  const incomeTax = Math.floor((afterChild * ratePct) / 100 / 10) * 10;
  const localTax = Math.floor((incomeTax * 0.1) / 10) * 10;
  return {
    incomeTax,
    localTax,
    bracket: { wageFrom: Number(r.wage_from), wageTo: r.wage_to == null ? null : Number(r.wage_to), base },
    outOfTable: false,
  };
}

/** 간이세액표 현재 버전 정보 */
export async function getTaxTableInfo(): Promise<{ yearVersion: number | null; rows: number }> {
  const db = await getDb();
  const r = rowsToObjects(
    await db.exec(`SELECT max(year_version) AS v, count(*) AS n FROM income_tax_brackets`)
  )[0];
  return { yearVersion: r?.v == null ? null : Number(r.v), rows: Number(r?.n ?? 0) };
}
