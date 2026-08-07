// 견적 산정·역산 엔진 — 순수 함수(DB·React 무의존, 서버/클라 공용).
// 설계: docs/quotation-blueprint.md §5-1.
//  (a) 정방향: 기준 세트(base_md + 인자별 unit_md × 규모계수 × 업종계수) → 표준가(가이드)
//  (c) 역산(문서 확정): 제출 견적가 P → base_md 비율로 MD 분배 → 스냅(0.5/0.1) →
//      그리디 잔차 조정으로 합계 S ∈ (P, P+cap(P)) 강제. 실물 4종 재현 검증 필수.

import {
  MD_GRADES,
  type MdGrade,
  type MdVector,
  type LaborRates,
  type QuoteWorkItem,
  type MdMatrixRow,
  type SiteRates,
  type SiteAmounts,
  mdSnapUnit,
  sumOverCap,
} from "./types";

// 등급 축은 기준 세트마다 다르다(143) — 아래 함수들은 MD_GRADES 상수 대신 **벡터의 키를
// 직접 순회**한다. 그래야 기술사 추가·특급 제외 같은 세트별 등급 구성이 산정 엔진 수정 없이
// 그대로 동작한다. MD_GRADES 는 UI·문서의 기본 열 순서로만 남는다.

/** 등급별 MD 벡터 합 */
export function mdVectorTotal(md: MdVector): number {
  return Object.values(md).reduce((acc: number, v) => acc + (v ?? 0), 0);
}

/** MD 벡터 × 노임단가 → 직접인건비(원). 등급별 단가는 해당 등급 노임단가를 적용한다. */
export function laborCostOf(md: MdVector, rates: LaborRates): number {
  return Object.entries(md).reduce((acc, [g, v]) => acc + (v ?? 0) * (rates[g] ?? 0), 0);
}

/** 매트릭스 전체 직접인건비 — 대항목(자식 있는 행)은 자식 합계 표시용이므로 리프만 합산 */
export function matrixLaborCost(rows: MdMatrixRow[], rates: LaborRates): number {
  return leafRows(rows).reduce((acc, r) => acc + laborCostOf(r.md, rates), 0);
}

/** 리프 행(자식이 없는 행)만 — 대항목 소계 이중 합산 방지 */
export function leafRows(rows: MdMatrixRow[]): MdMatrixRow[] {
  const parentIds = new Set(rows.map((r) => r.parentId).filter(Boolean));
  return rows.filter((r) => !parentIds.has(r.itemId));
}

/** 등급별 소계 (별첨1 '총 계(MD)' 행) */
export function gradeTotals(rows: MdMatrixRow[]): MdVector {
  const out: MdVector = {};
  for (const r of leafRows(rows)) {
    for (const [g, raw] of Object.entries(r.md)) {
      const v = raw ?? 0;
      if (v) out[g] = Math.round(((out[g] ?? 0) + v) * 1000) / 1000;
    }
  }
  return out;
}

/** 직접인건비 → 항목별 금액. 제경비=인건비×o, 기술료=(인건비+제경비)×t, 직접경비=인건비×d */
export function computeAmounts(laborCost: number, rates: SiteRates): Omit<SiteAmounts, "final" | "standard"> {
  const overhead = laborCost * rates.overheadRate;
  const techFee = (laborCost + overhead) * rates.techFeeRate;
  const directExpense = laborCost * rates.directExpenseRate;
  return {
    laborCost,
    overhead,
    techFee,
    directExpense,
    sum: laborCost + overhead + techFee + directExpense,
  };
}

/** 합계 배율 — sum = laborCost × multiplier. 역산의 핵심 상수 */
export function sumMultiplier(rates: SiteRates): number {
  return (1 + rates.overheadRate) * (1 + rates.techFeeRate) + rates.directExpenseRate;
}

/** 합계-견적가 제약 검증: sum > price && sum - price < cap(price) */
export function validateSumConstraint(price: number, sum: number): { ok: boolean; over: number; cap: number } {
  const cap = sumOverCap(price);
  const over = sum - price;
  return { ok: over > 0 && over < cap, over, cap };
}

// ── (a) 정방향 표준가 (가이드) ──

export interface ForwardInput {
  items: QuoteWorkItem[];
  /** 인자값 {factor_key: 값} */
  factors: Record<string, number>;
  /** 항목별 인자 단위 MD: itemId → factor_key → MdVector */
  itemFactors: Record<string, Record<string, MdVector>>;
  /** 규모계수(밴드 판정 결과) — factor_key별. 기본 1 */
  bandCoefs: Record<string, number>;
  industryCoef: number;
  marketAdjust: number;
  rates: SiteRates;
}

export interface ForwardResult {
  mdMatrix: MdMatrixRow[];
  amounts: Omit<SiteAmounts, "final">;
  standard: number; // 시장 보정 후 표준가(원)
}

/** 정방향 산정: MD(항목,등급) = base + Σ(인자값 × unit_md × 규모계수) × 업종계수 */
export function forwardEstimate(input: ForwardInput): ForwardResult {
  const rows: MdMatrixRow[] = input.items.map((it) => {
    const md: MdVector = {};
    const perFactor = input.itemFactors[it.itemId];
    // 등급 축은 세트마다 다르다 — base_md 와 인자별 unit_md 에 등장하는 등급의 합집합을 돈다
    const grades = new Set<string>(Object.keys(it.baseMd));
    if (perFactor) for (const unit of Object.values(perFactor)) for (const g of Object.keys(unit)) grades.add(g);
    for (const g of grades) {
      let v = it.baseMd[g] ?? 0;
      if (perFactor) {
        for (const [fk, unit] of Object.entries(perFactor)) {
          const fv = input.factors[fk] ?? 0;
          const coef = input.bandCoefs[fk] ?? 1;
          v += fv * (unit[g] ?? 0) * coef;
        }
      }
      v *= input.industryCoef;
      if (v) md[g] = Math.round(v * 100) / 100;
    }
    return { itemId: it.itemId, parentId: it.parentId, label: it.label, md };
  });
  const laborCost = matrixLaborCost(rows, input.rates.laborRates);
  const amounts = computeAmounts(laborCost, input.rates);
  return { mdMatrix: rows, amounts, standard: Math.round(amounts.sum * input.marketAdjust) };
}

/** 규모 구간표에서 인자값에 해당하는 계수 조회 (min~max 포함, max null=무한) */
export function bandCoef(
  bands: { minVal: number; maxVal: number | null; coef: number }[],
  value: number
): number {
  for (const b of bands) {
    if (value >= b.minVal && (b.maxVal == null || value <= b.maxVal)) return b.coef;
  }
  return 1;
}

// ── (c) 역산: 견적가 → MD 분배 (2026-08-05 2차 검토 확정) ──

export interface ReverseInput {
  price: number; // 제출 견적가 P (VAT 별도)
  items: QuoteWorkItem[]; // base_md 가중치의 원천
  rates: SiteRates;
}

export interface ReverseResult {
  mdMatrix: MdMatrixRow[];
  amounts: SiteAmounts;
  snapUnit: number;
  /** 스냅·그리디로 구간 진입 실패해 조정 셀 1개에 세밀 단위를 허용했는지 */
  fineAdjusted: boolean;
  ok: boolean; // 최종 제약 만족 여부
}

interface Cell {
  rowIdx: number;
  grade: MdGrade;
  md: number;
  rate: number; // 등급 노임단가
}

/**
 * 견적가 역산 — 알고리즘(블루프린트 §5-1-c):
 *  ① 목표 합계 S* = P + cap(P)×0.5 (구간 중앙 조준)
 *  ② 필요 직접인건비 L = S* / multiplier → 스케일 k = L / baseLaborCost 로 base_md 전체 확대/축소
 *  ③ 스냅: P≥1천만 → 0.5 단위, 미만 → 0.1 단위 반올림
 *  ④ 그리디 잔차 조정: S ≤ P 이면 최저단가 셀 +unit, S ≥ P+cap 이면 -unit (교대 진동 시 중단)
 *  ⑤ 그래도 미진입이면 조정 셀 1개만 세밀 단위(0.01)로 잔차 보정 (fineAdjusted=true)
 */
export function reverseAllocate(input: ReverseInput): ReverseResult {
  const { price, rates } = input;
  const cap = sumOverCap(price);
  const unit = mdSnapUnit(price);
  const mult = sumMultiplier(rates);
  const laborRates = rates.laborRates;

  // 리프 항목만 분배 대상(대항목은 소계 표시 전용)
  const parentIds = new Set(input.items.map((i) => i.parentId).filter(Boolean));
  const leaves = input.items.filter((i) => !parentIds.has(i.itemId));
  const baseLabor = leaves.reduce((acc, it) => acc + laborCostOf(it.baseMd, laborRates), 0);
  if (baseLabor <= 0 || price <= 0) {
    return {
      mdMatrix: input.items.map((it) => ({ itemId: it.itemId, parentId: it.parentId, label: it.label, md: {} })),
      amounts: { ...computeAmounts(0, rates), final: price },
      snapUnit: unit,
      fineAdjusted: false,
      ok: false,
    };
  }

  // ①② 스케일링
  const targetSum = price + cap * 0.5;
  const k = targetSum / mult / baseLabor;

  // 셀 목록 구성(스냅 적용). base_md에 없는 등급은 만들지 않는다(실물: 소규모는 특·초급 0열).
  const rows: MdMatrixRow[] = input.items.map((it) => ({
    itemId: it.itemId,
    parentId: it.parentId,
    label: it.label,
    md: {} as MdVector,
  }));
  const rowById = new Map(rows.map((r) => [r.itemId, r]));
  const cells: Cell[] = [];
  for (const it of leaves) {
    const row = rowById.get(it.itemId)!;
    // base_md 에 실제로 값이 있는 등급만 분배 대상(세트별 가변 등급 축을 그대로 따른다)
    for (const g of Object.keys(it.baseMd)) {
      const base = it.baseMd[g] ?? 0;
      if (base <= 0) continue;
      const snapped = Math.max(unit, Math.round((base * k) / unit) * unit);
      row.md[g] = round3(snapped);
      cells.push({ rowIdx: rows.indexOf(row), grade: g, md: snapped, rate: laborRates[g] ?? 0 });
    }
  }

  const currentSum = () => matrixLaborCost(rows, laborRates) * mult;

  // ④ 그리디 2단계: 최저단가 셀부터 unit 단위로 ①상한 위면 하향 ②견적가 이하면 상향.
  //    상향 스텝이 구간을 건너뛰면(스텝 > cap) 되돌린 뒤 ⑤ 세밀 +보정으로 마무리 —
  //    항상 아래에서 위로 접근하므로 보정량이 양수라 셀 바닥 클램프 문제가 없다.
  const byRateAsc = [...cells].filter((c) => c.rate > 0).sort((a, b) => a.rate - b.rate);
  let fineAdjusted = false;
  let guard = 400;
  // ④-1 하향: s < P+cap 까지 감소 (최저단가 셀 우선, 바닥나면 다음 셀)
  let di = 0;
  while (guard-- > 0 && currentSum() >= price + cap) {
    const c = byRateAsc[di];
    if (!c) break;
    const row = rows[c.rowIdx];
    const cur = row.md[c.grade] ?? 0;
    if (cur <= unit) {
      di++;
      continue;
    }
    row.md[c.grade] = round3(cur - unit);
  }
  // ④-2 상향: s > P 까지 증가. 마지막 스텝이 상한을 넘기면 되돌리고 세밀 보정으로
  const up = byRateAsc[0];
  while (guard-- > 0 && up) {
    const s = currentSum();
    if (s > price) break;
    const row = rows[up.rowIdx];
    row.md[up.grade] = round3((row.md[up.grade] ?? 0) + unit);
    if (currentSum() >= price + cap) {
      row.md[up.grade] = round3((row.md[up.grade] ?? 0) - unit); // 구간 건너뜀 → 되돌림
      break;
    }
  }

  // ⑤ 세밀 +보정 — 조정 셀 1개에 한해 0.01 단위 허용 (최후 수단, 블루프린트 §5-1-c 명시).
  //    이 시점에 s ≤ P 이면 (P, P+cap) 중앙까지의 양수 mdDelta 를 얹는다.
  {
    const s = currentSum();
    if (!(s > price && s < price + cap) && up) {
      const row = rows[up.rowIdx];
      const needLaborDelta = (price + cap * 0.5 - s) / mult;
      const mdDelta = Math.max(0.01, Math.round((needLaborDelta / up.rate) * 100) / 100);
      row.md[up.grade] = round3((row.md[up.grade] ?? 0) + mdDelta);
      fineAdjusted = true;
    }
  }

  // 대항목 소계 채움(표시용): 자식 합
  for (const r of rows) {
    const children = rows.filter((c) => c.parentId === r.itemId);
    if (children.length) {
      const md: MdVector = {};
      const grades = new Set<string>(children.flatMap((c) => Object.keys(c.md)));
      for (const g of grades) {
        const v = children.reduce((acc, c) => acc + (c.md[g] ?? 0), 0);
        if (v) md[g] = round3(v);
      }
      r.md = md;
    }
  }

  const laborCost = matrixLaborCost(rows, laborRates);
  const base = computeAmounts(laborCost, rates);
  const check = validateSumConstraint(price, base.sum);
  return {
    mdMatrix: rows,
    amounts: { ...base, final: price },
    snapUnit: unit,
    fineAdjusted,
    ok: check.ok,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
