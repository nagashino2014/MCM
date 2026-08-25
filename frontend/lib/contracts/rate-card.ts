// 단가 계약 — 단가 기준표 데이터 모델 v2 (2026-08-25).
//
// v1(평탄 행 목록)은 차수 누적형 발주처(삼성전기 부산·세종 등 — 기존 계약을 유지하며
// 1차 변경, 2차 변경… 으로 추가 발주를 덧붙이는 관행)를 담지 못했다. 실물 단가표 분석 결론:
//  - 단가는 계약 체결 시 1회 확정(항목당 변경허가/변경신고 2종까지), 차수마다 달라지는 것은 수량뿐.
//  - 각 차수 합계에서 선급금 N% / 준공금(100-N)% 로 기계적 분해되어 청구된다.
//  - 누적 수량 감소율 등 발주처 고유 규칙으로 금액이 단가×수량과 다를 수 있다 → 금액 수동 보정으로 흡수.
// v2 = "단가 마스터(items) + 차수별 수량(rounds)". v1 데이터는 로드 시 차수 1개짜리 v2로 승격된다.
//
// 이 모듈은 서버(route handler)와 클라이언트가 공유한다 — "use client" 를 붙이지 말 것.

export interface RateCardItem {
  id: string;
  /** 구분 — 작업 분류 또는 지급 구분(예: 배출시설 증설, 변경허가). 차수 미사용 계약에선 구분 소계가 청구 단계 금액이 된다. */
  groupName: string;
  /** 항목(세부내용) — 예: 단설비, 복합설비, 연계 U/T(서비스탱크 등) */
  name: string;
  /** 단위 — 건 / 대 / 회 / 식 / 개 / 장 등 */
  unit: string;
  /** 단가①(원) — 단가 2종 사용 시 변경허가 단가. 숫자만 담은 문자열 */
  unitPrice: string;
  /** 단가②(원) — 변경신고 단가. 단가 2종 미사용 시 빈 문자열 */
  unitPrice2: string;
  /** 비고 — 과업범위·티어 조건·감소율 등 발주처 고유 규칙 */
  note: string;
}

/** 차수 × 항목 셀 — 수량과 (감소율 등으로 자동 계산과 다를 때만) 금액 보정값. */
export interface RateCardCell {
  /** 단가① 적용 수량 */
  qty: string;
  /** 단가② 적용 수량 */
  qty2: string;
  /** 금액(계) 수동 보정 — 비어 있으면 단가×수량 자동 계산 */
  amount?: string;
}

export interface RateCardRound {
  id: string;
  /** 차수명 — 예: 기본, 1차 변경, 2차 변경 */
  label: string;
  /** 차수 견적 기준일(YYYY-MM-DD) — 선택 */
  date: string;
  /** 선급률(%) — 차수 소계를 선급금/준공금으로 분해. 0 또는 빈값이면 분해 없이 단일 청구 */
  advanceRate: string;
  /** itemId → 셀. 미기재 항목은 수량 0 취급 */
  cells: Record<string, RateCardCell>;
}

export interface RateCardData {
  version: 2;
  /** 항목당 변경허가/변경신고 단가 2종을 구분해 쓰는지(삼성전기식) */
  dualPrice: boolean;
  items: RateCardItem[];
  rounds: RateCardRound[];
}

export interface RateCardStageOption {
  label: string;
  amount: number;
}

const newId = (prefix: string) => prefix + "_" + Math.random().toString(36).slice(2, 10);
const digits = (v: unknown) => String(v ?? "").replace(/[^0-9]/g, "");
const num = (v: unknown) => Number(digits(v) || 0);

export function createRateCardItem(groupName = ""): RateCardItem {
  return { id: newId("rci"), groupName, name: "", unit: "건", unitPrice: "", unitPrice2: "", note: "" };
}

export function createRateCardRound(label: string, advanceRate = "30"): RateCardRound {
  return { id: newId("rcr"), label, date: "", advanceRate, cells: {} };
}

export function createRateCard(): RateCardData {
  return { version: 2, dualPrice: false, items: [], rounds: [createRateCardRound("기본")] };
}

/** 셀 자동 계산 금액 = 단가①×수량① + 단가②×수량② */
export function cellAutoAmount(item: RateCardItem, cell: RateCardCell | undefined): number {
  if (!cell) return 0;
  return num(item.unitPrice) * num(cell.qty) + num(item.unitPrice2) * num(cell.qty2);
}

/** 셀 확정 금액 — 수동 보정값이 있으면 그것, 없으면 자동 계산. */
export function cellAmount(item: RateCardItem, cell: RateCardCell | undefined): number {
  if (cell?.amount != null && cell.amount !== "") return num(cell.amount);
  return cellAutoAmount(item, cell);
}

/** 차수 소계 = Σ 항목 셀 금액 */
export function roundTotal(data: RateCardData, round: RateCardRound): number {
  return data.items.reduce((acc, it) => acc + cellAmount(it, round.cells[it.id]), 0);
}

export function rateCardTotal(data: RateCardData): number {
  return data.rounds.reduce((acc, r) => acc + roundTotal(data, r), 0);
}

/** 고유 구분명 — 입력 순서 보존. */
export function rateCardGroupNames(data: RateCardData): string[] {
  const out: string[] = [];
  for (const it of data.items) {
    const g = it.groupName.trim();
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

/** 구분 소계(전 차수 합) — 차수 미사용 계약의 청구 단계 금액. */
export function rateCardGroupTotal(data: RateCardData, groupName: string): number {
  const ids = new Set(data.items.filter((it) => it.groupName.trim() === groupName.trim()).map((it) => it.id));
  let acc = 0;
  for (const round of data.rounds) {
    for (const it of data.items) {
      if (ids.has(it.id)) acc += cellAmount(it, round.cells[it.id]);
    }
  }
  return acc;
}

/** 선급/준공 분해 — 선급 = 반올림, 준공 = 나머지(합계 보존). */
export function advanceSplit(total: number, ratePct: number): { advance: number; completion: number } {
  const advance = Math.round((total * ratePct) / 100);
  return { advance, completion: total - advance };
}

/** 한 차수에서 파생되는 청구 단계 — 선급률이 있으면 [선급금, 준공금], 없으면 차수 단일 청구. */
export function roundStageOptions(data: RateCardData, round: RateCardRound): RateCardStageOption[] {
  const total = roundTotal(data, round);
  if (total <= 0) return [];
  const rate = Number(digits(round.advanceRate) || 0);
  const label = round.label.trim() || "차수";
  if (rate > 0 && rate < 100) {
    const { advance, completion } = advanceSplit(total, rate);
    return [
      { label: `${label} 선급금(${rate}%)`, amount: advance },
      { label: `${label} 준공금(${100 - rate}%)`, amount: completion },
    ];
  }
  return [{ label, amount: total }];
}

/**
 * 청구·수금 단계명 목록박스 옵션.
 *  - 차수 1개(차수 미사용): 구분명 → 구분 소계(v1 동작 유지).
 *  - 차수 2개 이상(차수 누적형): 차수별 선급금/준공금.
 */
export function rateCardStageOptions(data: RateCardData): RateCardStageOption[] {
  if (data.rounds.length <= 1) {
    return rateCardGroupNames(data).map((g) => ({ label: g, amount: rateCardGroupTotal(data, g) }));
  }
  return data.rounds.flatMap((round) => roundStageOptions(data, round));
}

export function rateCardHasContent(data: RateCardData): boolean {
  return data.items.some((it) => it.groupName.trim() || it.name.trim() || digits(it.unitPrice) || digits(it.unitPrice2));
}

interface LegacyV1Item {
  id?: unknown;
  groupName?: unknown;
  name?: unknown;
  unit?: unknown;
  unitPrice?: unknown;
  qty?: unknown;
  note?: unknown;
}

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function normalizeItem(raw: Partial<RateCardItem>): RateCardItem {
  return {
    id: text(raw.id, 24) || newId("rci"),
    groupName: text(raw.groupName, 60),
    name: text(raw.name, 200),
    unit: text(raw.unit, 20),
    unitPrice: digits(raw.unitPrice).slice(0, 15),
    unitPrice2: digits(raw.unitPrice2).slice(0, 15),
    note: text(raw.note, 300),
  };
}

function normalizeRound(raw: Partial<RateCardRound>, index: number): RateCardRound {
  const cells: Record<string, RateCardCell> = {};
  if (raw.cells && typeof raw.cells === "object") {
    for (const [itemId, cell] of Object.entries(raw.cells as Record<string, Partial<RateCardCell>>)) {
      if (!cell || typeof cell !== "object") continue;
      const qty = digits(cell.qty).slice(0, 9);
      const qty2 = digits(cell.qty2).slice(0, 9);
      const amount = cell.amount != null && cell.amount !== "" ? digits(cell.amount).slice(0, 15) : undefined;
      if (qty || qty2 || amount != null) cells[text(itemId, 24)] = amount != null ? { qty, qty2, amount } : { qty, qty2 };
    }
  }
  return {
    id: text(raw.id, 24) || newId("rcr"),
    label: text(raw.label, 40) || (index === 0 ? "기본" : `${index}차 변경`),
    date: text(raw.date, 10),
    advanceRate: digits(raw.advanceRate).slice(0, 3),
    cells,
  };
}

/**
 * 저장값 → v2 승격/보정. v1(평탄 배열)은 "기본" 차수 1개짜리 v2로 변환한다
 * (unitPrice→단가①, qty→기본 차수 수량①). 서버 저장 정제(sanitize)로도 쓰인다.
 */
export function upgradeRateCard(raw: unknown): RateCardData {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const d = raw as Partial<RateCardData>;
    const items = (Array.isArray(d.items) ? d.items.slice(0, 200) : []).map((it) => normalizeItem(it ?? {}));
    const kept = items.filter((it) => it.groupName || it.name || it.unitPrice || it.unitPrice2);
    const keptIds = new Set(kept.map((it) => it.id));
    const rounds = (Array.isArray(d.rounds) && d.rounds.length ? d.rounds.slice(0, 30) : [createRateCardRound("기본")])
      .map((r, i) => normalizeRound(r ?? {}, i))
      .map((r) => ({
        ...r,
        cells: Object.fromEntries(Object.entries(r.cells).filter(([itemId]) => keptIds.has(itemId))),
      }));
    return { version: 2, dualPrice: Boolean(d.dualPrice), items: kept, rounds };
  }

  const v1 = Array.isArray(raw) ? (raw as LegacyV1Item[]).slice(0, 200) : [];
  const base = createRateCardRound("기본");
  const items: RateCardItem[] = [];
  for (const r of v1) {
    const item = normalizeItem({
      id: text(r.id, 24),
      groupName: r.groupName as string,
      name: r.name as string,
      unit: r.unit as string,
      unitPrice: r.unitPrice as string,
      note: r.note as string,
    });
    if (!(item.groupName || item.name || item.unitPrice)) continue;
    items.push(item);
    const qty = digits(r.qty).slice(0, 9);
    if (qty) base.cells[item.id] = { qty, qty2: "" };
  }
  return { version: 2, dualPrice: false, items, rounds: [base] };
}
