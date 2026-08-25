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
  /** 단가① 적용 수량 — 감소율 반영을 위한 소수 허용(예: 16.7) */
  qty: string;
  /** 단가② 적용 수량 — 소수 허용 */
  qty2: string;
  /** 금액(계) 수동 보정 — 비어 있으면 단가×수량 자동 계산 */
  amount?: string;
}

/** 차수 지급 단위 — 예: 선급금 30% / 중도금 30% / 준공금 40%. 마지막 단위 금액은 잔액(합계 보존). */
export interface RateCardPayment {
  label: string;
  ratePct: string;
}

export interface RateCardRound {
  id: string;
  /** 차수명 — 예: 기본, 1차 변경, 2차 변경 */
  label: string;
  /** 차수 견적 기준일(YYYY-MM-DD) — 선택 */
  date: string;
  /** 지급 단위 목록 — 기본 [선급금 30, 준공금 70]. 단일 차수에서 모두 지우면 구분별 청구(지급 구분 방식) */
  payments: RateCardPayment[];
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

/** 수량용 소수 문자열 정제 — 숫자와 소수점 1개만 허용(감소율 반영 수량, 예: 16.7). */
export function decimalStr(v: unknown): string {
  const s = String(v ?? "").replace(/[^0-9.]/g, "");
  const i = s.indexOf(".");
  const clean = i === -1 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
  return clean.slice(0, 12);
}
const qnum = (v: unknown) => {
  const n = parseFloat(decimalStr(v));
  return Number.isFinite(n) ? n : 0;
};

export function createRateCardItem(groupName = ""): RateCardItem {
  return { id: newId("rci"), groupName, name: "", unit: "건", unitPrice: "", unitPrice2: "", note: "" };
}

export function createRateCardPayments(): RateCardPayment[] {
  return [
    { label: "선급금", ratePct: "30" },
    { label: "준공금", ratePct: "70" },
  ];
}

export function createRateCardRound(label: string, payments?: RateCardPayment[]): RateCardRound {
  return { id: newId("rcr"), label, date: "", payments: payments ?? createRateCardPayments(), cells: {} };
}

export function createRateCard(): RateCardData {
  // 단가 기준표는 단가만 담고, 수량·금액 산출은 차수표가 전담한다(2026-08-25 사용자 확정).
  // 차수는 사용자가 명시적으로 추가한다 — 처음엔 0개.
  return { version: 2, dualPrice: false, items: [], rounds: [] };
}

/** 셀 자동 계산 금액 = 단가①×수량① + 단가②×수량② (수량은 소수 허용, 결과는 원 단위 반올림) */
export function cellAutoAmount(item: RateCardItem, cell: RateCardCell | undefined): number {
  if (!cell) return 0;
  return Math.round(num(item.unitPrice) * qnum(cell.qty) + num(item.unitPrice2) * qnum(cell.qty2));
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

/** 라벨이 입력된 유효 지급 단위만. */
export function validPayments(round: RateCardRound): RateCardPayment[] {
  return round.payments.filter((p) => p.label.trim());
}

/**
 * 차수 소계를 지급 단위별로 분해 — 각 단위는 비율 반올림, 마지막 단위는 잔액(합계 보존, 준공금=잔액 관행).
 * 마지막 단위의 표기 비율이 비어 있으면 100 - 앞 단위 합으로 채워 보여준다.
 */
export function paymentSplit(
  total: number,
  payments: RateCardPayment[]
): Array<{ label: string; ratePct: number; amount: number }> {
  const pays = payments.filter((p) => p.label.trim());
  if (!pays.length) return [];
  const out: Array<{ label: string; ratePct: number; amount: number }> = [];
  let acc = 0;
  let pctAcc = 0;
  pays.forEach((p, i) => {
    const last = i === pays.length - 1;
    const rawPct = Number(digits(p.ratePct) || 0);
    const pct = last && !rawPct ? Math.max(0, 100 - pctAcc) : rawPct;
    const amount = last ? total - acc : Math.round((total * pct) / 100);
    acc += amount;
    pctAcc += pct;
    out.push({ label: p.label.trim(), ratePct: pct, amount });
  });
  return out;
}

/** 한 차수에서 파생되는 청구 단계 — 지급 단위가 있으면 단위별 분해, 없으면 차수 단일 청구. */
export function roundStageOptions(data: RateCardData, round: RateCardRound): RateCardStageOption[] {
  const total = roundTotal(data, round);
  if (total <= 0) return [];
  const label = round.label.trim() || "차수";
  const split = paymentSplit(total, round.payments);
  if (!split.length) return [{ label, amount: total }];
  return split.map((s) => ({ label: `${label} ${s.label}(${s.ratePct}%)`, amount: s.amount }));
}

/**
 * 청구·수금 단계명 목록박스 옵션.
 *  - 차수 없음: 옵션 없음(차수표를 먼저 작성해야 금액이 산출된다).
 *  - 차수 1개 + 지급 단위 없음: 구분명 → 구분 소계(에이에스이코리아식 지급 구분 청구, v1 동작 유지).
 *  - 그 외: 차수별 지급 단위(선급금/중도금/준공금) 분해.
 */
export function rateCardStageOptions(data: RateCardData): RateCardStageOption[] {
  if (data.rounds.length === 0) return [];
  if (data.rounds.length === 1 && validPayments(data.rounds[0]).length === 0) {
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

function normalizeRound(raw: Partial<RateCardRound> & { advanceRate?: unknown }, index: number): RateCardRound {
  const cells: Record<string, RateCardCell> = {};
  if (raw.cells && typeof raw.cells === "object") {
    for (const [itemId, cell] of Object.entries(raw.cells as Record<string, Partial<RateCardCell>>)) {
      if (!cell || typeof cell !== "object") continue;
      const qty = decimalStr(cell.qty);
      const qty2 = decimalStr(cell.qty2);
      const amount = cell.amount != null && cell.amount !== "" ? digits(cell.amount).slice(0, 15) : undefined;
      if (qty || qty2 || amount != null) cells[text(itemId, 24)] = amount != null ? { qty, qty2, amount } : { qty, qty2 };
    }
  }
  let payments: RateCardPayment[];
  if (Array.isArray(raw.payments)) {
    payments = (raw.payments as Array<Partial<RateCardPayment>>)
      .slice(0, 8)
      .map((p) => ({ label: text(p?.label, 40), ratePct: digits(p?.ratePct).slice(0, 3) }))
      .filter((p) => p.label || p.ratePct);
  } else {
    // 구버전(선급률 단일 필드) 데이터 — 유효한 선급률은 [선급금, 준공금] 2단위로 변환한다.
    const rate = Number(digits(raw.advanceRate) || 0);
    payments =
      rate > 0 && rate < 100
        ? [
            { label: "선급금", ratePct: String(rate) },
            { label: "준공금", ratePct: String(100 - rate) },
          ]
        : [];
  }
  return {
    id: text(raw.id, 24) || newId("rcr"),
    label: text(raw.label, 40) || (index === 0 ? "기본" : `${index}차 변경`),
    date: text(raw.date, 10),
    payments,
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
    const rounds = (Array.isArray(d.rounds) ? d.rounds.slice(0, 30) : [])
      .map((r, i) => normalizeRound(r ?? {}, i))
      .map((r) => ({
        ...r,
        cells: Object.fromEntries(Object.entries(r.cells).filter(([itemId]) => keptIds.has(itemId))),
      }));
    return { version: 2, dualPrice: Boolean(d.dualPrice), items: kept, rounds };
  }

  const v1 = Array.isArray(raw) ? (raw as LegacyV1Item[]).slice(0, 200) : [];
  // v1 은 구분 소계 청구 방식이었으므로 지급 단위 없는 차수로 승격한다(수량이 하나도 없으면 차수 자체를 만들지 않는다).
  const base = createRateCardRound("기본", []);
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
  return { version: 2, dualPrice: false, items, rounds: Object.keys(base.cells).length ? [base] : [] };
}
