// 수금 자동대조 엔진 (블루프린트 P3 / F4) — docs/bank-reconciliation-blueprint.md §4~§9 설계를 바로빌 원장 위에 구현.
// 원칙(D2): 완전 자동확정은 하지 않는다. 엔진은 "제안"만 만들고, 사람이 일괄/개별 승인한다.
//
// 파이프라인: 입금 txn → ① 거래처 식별 → ② 미수 후보 축소 → ③ 유형별 후보(exact/sum/partial/overpaid/prepaid/non_receivable)
//            → ④ 스코어링 → ⑤ recon_matches(suggested) 적재
// 확정(confirm) 시 기존 수금 모델(partial_payments_json)에 그대로 반영하므로 미수금·수금 화면은 무수정 호환.

import { createHash } from "node:crypto";
import { getDb, withDbWrite, rowsToObjects, type PgDatabase } from "@/lib/db";
import { normalizeCompanyName } from "@/lib/ieps/formatters";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
const hashId = (prefix: string, source: string) => `${prefix}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;

/** 상호 비교 키 — 전각/공백/법인격 표기를 모두 걷어낸 뒤 대문자. "（주）영흥산업환경" = "영흥산업환경". */
export function reconKey(raw: string | null | undefined): string {
  if (!raw) return "";
  const nfkc = String(raw).normalize("NFKC");
  const base = normalizeCompanyName(nfkc) ?? nfkc;
  return base
    .replace(/㈜|\(주\)|\(유\)|\(재\)|\(사\)|주식회사|유한회사|재단법인|사단법인/g, "")
    .replace(/[\s.,·・\-_'"()[\]]/g, "")
    .toUpperCase();
}

/** 수금이 아닌 입금(이자·세금환급·자기계좌 이체 등) 힌트 — 자동확정은 어차피 없고, 검토 큐에서 뒤로 밀기 위한 라벨. */
const NON_RECEIVABLE_HINTS = [
  "이자", "예금이자", "대출", "국세", "지방세", "환급", "카드대금", "CMS", "지로", "급여", "보험", "연금",
  "법인잔고", "잔고이전", "자동이체", "수수료", "적금", "펀드", "증권",
];

function looksNonReceivable(remitter: string, transType: string | null, remark2: string | null): boolean {
  const hay = `${remitter} ${transType ?? ""} ${remark2 ?? ""}`;
  return NON_RECEIVABLE_HINTS.some((k) => hay.includes(k));
}

// ─────────────────────────────────────────────
// 거래처 식별 (입금자명 → facility)
// ─────────────────────────────────────────────

export interface FacilityIndex {
  /** reconKey → { facilityId, strength } — 강도: 학습 100 / 정규상호 90 / 별칭 80 / 구상호 70 */
  exact: Map<string, { facilityId: string; strength: number }>;
  /** 부분일치용 (key, facilityId) 목록 — 입금자명이 잘려 오는 경우 대비 */
  list: Array<{ key: string; facilityId: string }>;
  names: Map<string, string>; // facilityId → 표시용 상호
}

/**
 * ★모집단 한정(2026-08-16 실증): facilities 전체(IEPS 수만 사업장)로 인덱스를 만들면
 *   "(주)영풍" 입금이 거래 이력조차 없는 "영풍제지"에 붙는다. 매칭이 의미 있는 대상은
 *   계약에 등장하는 거래처뿐이므로, 후보 계약의 발주처·대상 사업장으로 좁힌다.
 */
export async function buildFacilityIndex(db: PgDatabase, relevantIds: Set<string>): Promise<FacilityIndex> {
  const index: FacilityIndex = { exact: new Map(), list: [], names: new Map() };
  const put = (raw: string | null, facilityId: string, strength: number) => {
    const key = reconKey(raw);
    if (!key || key.length < 2) return;
    const prev = index.exact.get(key);
    if (!prev || prev.strength < strength) index.exact.set(key, { facilityId, strength });
    index.list.push({ key, facilityId });
  };

  const ids = [...relevantIds].filter(Boolean);
  const facilities = ids.length
    ? rowsToObjects(
        await db.exec(`SELECT facility_id, company_name, normalized_company_name FROM facilities WHERE facility_id = ANY($1::text[])`, [ids]),
      )
    : [];
  for (const f of facilities) {
    const id = String(f.facility_id);
    index.names.set(id, String(f.normalized_company_name || f.company_name || ""));
    put((f.normalized_company_name as string | null) ?? null, id, 90);
    put((f.company_name as string | null) ?? null, id, 90);
  }
  const aliases = ids.length
    ? rowsToObjects(await db.exec(`SELECT facility_id, alias FROM facility_aliases WHERE facility_id = ANY($1::text[])`, [ids]))
    : [];
  for (const a of aliases) put(String(a.alias), String(a.facility_id), 80);

  const merged = ids.length
    ? rowsToObjects(
        await db.exec(
          `SELECT target_facility_id, previous_company_name FROM facility_merge_aliases
            WHERE previous_company_name IS NOT NULL AND target_facility_id = ANY($1::text[])`,
          [ids],
        ),
      )
    : [];
  for (const m of merged) put(String(m.previous_company_name), String(m.target_facility_id), 70);

  // 학습 링크가 최우선 — 사용자가 확정한 이력이라 상호가 달라도 신뢰한다.
  const links = rowsToObjects(await db.exec(`SELECT remitter_name_norm, facility_id FROM bank_remitter_links`));
  for (const l of links) {
    const key = reconKey(String(l.remitter_name_norm));
    if (key) index.exact.set(key, { facilityId: String(l.facility_id), strength: 100 });
  }
  return index;
}

export function identifyFacility(remitter: string, index: FacilityIndex): { facilityId: string; strength: number } | null {
  const key = reconKey(remitter);
  if (!key) return null;
  const hit = index.exact.get(key);
  if (hit) return hit;
  // 부분일치 — 입금자명이 잘리거나("영흥산업환경(주)차장") 접두가 붙는 경우.
  // ⚠ 짧은 상호끼리는 우연히 겹치기 쉬워(3자 한글 등) 조건을 조인다:
  //   ① 겹치는 쪽 길이 4자 이상 ② 두 이름 길이 비가 50% 이상(한쪽이 다른 쪽의 절반 미만이면 버린다).
  let best: { facilityId: string; strength: number; len: number } | null = null;
  for (const item of index.list) {
    if (item.key.length < 4) continue;
    if (!(key.includes(item.key) || item.key.includes(key))) continue;
    const ratio = Math.min(key.length, item.key.length) / Math.max(key.length, item.key.length);
    if (ratio < 0.5) continue;
    if (!best || item.key.length > best.len) best = { facilityId: item.facilityId, strength: 60, len: item.key.length };
  }
  if (best) return { facilityId: best.facilityId, strength: best.strength };
  // 접두-유일 완화: "(주)영풍" → "영풍석포제련소"처럼 입금자명이 모기업 축약이라 길이비로는 탈락하는 케이스.
  // 모집단이 계약 거래처로 좁혀져 있으므로, 접두로 걸리는 회사가 정확히 하나일 때만 인정한다.
  const prefixHits = new Set<string>();
  for (const item of index.list) {
    if (key.length >= 2 && (item.key.startsWith(key) || key.startsWith(item.key))) prefixHits.add(item.facilityId);
  }
  if (prefixHits.size === 1) return { facilityId: [...prefixHits][0], strength: 55 };
  return null;
}

// ─────────────────────────────────────────────
// 미수 후보
// ─────────────────────────────────────────────

export interface Receivable {
  milestoneId: string;
  contractId: string;
  contractTitle: string;
  stageLabel: string;
  facilityId: string | null;
  /** 매칭에 쓰는 거래처 전체 — 발주처 + 계약 대상 사업장(조달청 경유 계약은 실입금이 수요기관에서 온다). */
  facilityIds: string[];
  facilityName: string;
  invoicedAt: string | null;
  paymentTerms: string | null;
  baseAmount: number; // 단계 총액(= 공급가액. 실측 확정)
  remaining: number; // 미수 잔액
  /** 이미 수금 처리된 단계(수기 입력 포함) — 입금 건과 짝을 맞춰 "기록된 수금"으로 확인만 한다. */
  collected: boolean;
  collectedAt: string | null;
  collectedAmount: number;
  /** 실적 정산액(마이그 113) — 정산으로 감액되면 실제 입금은 청구금액이 아니라 이 금액 기준이다. */
  settlementAmount: number | null;
  /** 어음 수금 상세(마이그 200) — 만기일·대출실행일 입금은 입금자명이 없어도 날짜로 매칭한다. */
  noteBank: string | null;
  noteMaturityDate: string | null;
  noteLoanExecutedDate: string | null;
  noteLoanInterestAmount: number | null;
}

/**
 * ★실측(2026-08-16, 삼척블루파워 준공금): 단계 금액은 **공급가액(VAT 별도)**이고 입금은 VAT 포함이다.
 *   41,468,050 x 1.1 = 45,614,855(입금액)로 원 단위까지 일치. 그래서 금액 비교는 두 기준을 모두 본다.
 */
export const withVat = (supply: number) => Math.round(supply * 1.1);

export type AmountBasis = "supply" | "vat" | "settlement" | "settlement_vat";

export const BASIS_LABEL: Record<AmountBasis, string> = {
  supply: "공급가액 일치",
  vat: "VAT 포함액 일치",
  settlement: "실적 정산액 일치",
  settlement_vat: "실적 정산액 VAT 포함 일치",
};

/**
 * 입금액이 대상 금액과 맞는지 — 네 기준을 모두 시도한다.
 * ★실측(2026-08-16, 수도권매립지공사 준공금): 실적 정산으로 감액된 건은 **정산액×1.1** 로 입금된다.
 *   48,932,922 x 1.1 = 53,826,214(입금액). 청구금액(51,320,810)만 보면 영영 매칭되지 않는다.
 */
export function amountMatch(target: number, txnAmount: number, settlement?: number | null): { hit: boolean; basis: AmountBasis } {
  const near = (v: number) => Math.abs(v - txnAmount) <= AMOUNT_TOLERANCE;
  if (near(target)) return { hit: true, basis: "supply" };
  if (near(withVat(target))) return { hit: true, basis: "vat" };
  if (settlement != null && settlement > 0) {
    if (near(settlement)) return { hit: true, basis: "settlement" };
    if (near(withVat(settlement))) return { hit: true, basis: "settlement_vat" };
  }
  return { hit: false, basis: "supply" };
}

/**
 * 매칭 후보 단계 목록.
 * 미수(payment_collected=0)뿐 아니라 **최근 수금 처리된 단계도 함께** 싣는다 — 사용자가 수기로 넣은
 * 수금 건도 계좌 입금과 짝지어 "확인"할 수 있어야 하기 때문(중복 반영은 하지 않는다).
 */
export async function loadReceivables(db: PgDatabase): Promise<Receivable[]> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT m.milestone_id, m.contract_id, m.stage_label, m.amount, m.invoice_amount, m.collected_amount,
              m.invoice_issued_at, m.payment_terms, m.payment_collected, m.payment_collected_at, m.settlement_amount,
              m.note_bank, m.note_maturity_date, m.note_loan_executed_date, m.note_loan_interest_amount,
              c.contract_title, c.counterparty_facility_id, c.facility_id AS contract_facility_id,
              f.company_name, f.normalized_company_name
         FROM contract_payment_milestones m
         JOIN contracts c ON c.contract_id = m.contract_id
         LEFT JOIN facilities f ON f.facility_id = c.counterparty_facility_id
        WHERE m.invoice_issued = 1
          AND (m.payment_collected = 0
               OR COALESCE(m.payment_collected_at, m.invoice_issued_at, '') >= to_char(now() - interval '18 months', 'YYYY-MM-DD'))`,
    ),
  );
  // 계약 대상 사업장 — 조달청 경유 계약은 발주처(조달청)가 아니라 수요기관(대상 사업장)이 입금한다.
  const contractIds = [...new Set(rows.map((r) => String(r.contract_id)))];
  const siteRows = contractIds.length
    ? rowsToObjects(
        await db.exec(`SELECT contract_id, facility_id FROM contract_facilities WHERE contract_id = ANY($1::text[])`, [contractIds]),
      )
    : [];
  const sitesByContract = new Map<string, string[]>();
  for (const sr of siteRows) {
    const cid = String(sr.contract_id);
    const list = sitesByContract.get(cid) ?? [];
    list.push(String(sr.facility_id));
    sitesByContract.set(cid, list);
  }

  return rows
    .map((r) => {
      const base = Number(r.invoice_amount ?? r.amount ?? 0);
      const collectedAmount = Number(r.collected_amount ?? 0);
      const collected = Number(r.payment_collected ?? 0) === 1;
      const contractId = String(r.contract_id);
      const facilityIds = [
        ...new Set(
          [
            r.counterparty_facility_id ? String(r.counterparty_facility_id) : null,
            r.contract_facility_id ? String(r.contract_facility_id) : null,
            ...(sitesByContract.get(contractId) ?? []),
          ].filter((v): v is string => Boolean(v)),
        ),
      ];
      return {
        milestoneId: String(r.milestone_id),
        contractId,
        contractTitle: String(r.contract_title ?? ""),
        stageLabel: String(r.stage_label ?? ""),
        facilityId: r.counterparty_facility_id ? String(r.counterparty_facility_id) : null,
        facilityIds,
        facilityName: String(r.normalized_company_name || r.company_name || ""),
        invoicedAt: r.invoice_issued_at ? String(r.invoice_issued_at).slice(0, 10) : null,
        paymentTerms: r.payment_terms ? String(r.payment_terms) : null,
        baseAmount: base,
        remaining: Math.round(base - collectedAmount),
        collected,
        collectedAt: r.payment_collected_at ? String(r.payment_collected_at).slice(0, 10) : null,
        collectedAmount: collectedAmount || base,
        settlementAmount: r.settlement_amount == null ? null : Number(r.settlement_amount),
        noteBank: r.note_bank ? String(r.note_bank) : null,
        noteMaturityDate: r.note_maturity_date ? String(r.note_maturity_date).slice(0, 10) : null,
        noteLoanExecutedDate: r.note_loan_executed_date ? String(r.note_loan_executed_date).slice(0, 10) : null,
        noteLoanInterestAmount: r.note_loan_interest_amount == null ? null : Number(r.note_loan_interest_amount),
      };
    })
    .filter((r) => r.collected || r.remaining > 0);
}

// ─────────────────────────────────────────────
// 스코어링
// ─────────────────────────────────────────────

const AMOUNT_TOLERANCE = 1; // 원 단위 반올림 오차만 허용

/** 두 날짜(YYYY-MM-DD) 간 일수 차이. 한쪽이 없으면 크게 벌어진 것으로 본다. */
function dayGap(a: string | null, b: string | null): number {
  if (!a || !b) return 999;
  return Math.round((new Date(`${b}T00:00:00+09:00`).getTime() - new Date(`${a}T00:00:00+09:00`).getTime()) / 86400000);
}

/** 업체별 결제주기 학습값 — 확정 이력의 (발행일→입금일) 간격 통계. */
export interface PaymentCycle {
  avgDays: number;
  count: number;
}

/**
 * 확정된 대조 이력에서 거래처별 평균 결제 간격을 집계한다(P5).
 * 2건 이상 쌓인 업체만 신뢰한다 — 어음 업체(120일+)와 즉시 입금 업체를 같은 잣대로 재지 않기 위함.
 */
export async function loadPaymentCycles(db: PgDatabase): Promise<Map<string, PaymentCycle>> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT m.matched_facility_id AS facility_id,
              AVG( (t.txn_at::date - cm.invoice_issued_at::date) ) AS avg_days,
              COUNT(*)::int AS n
         FROM recon_matches m
         JOIN bank_transactions t ON t.txn_id = m.txn_id
         JOIN recon_match_lines l ON l.match_id = m.match_id
         JOIN contract_payment_milestones cm ON cm.milestone_id = l.milestone_id
        WHERE m.status = 'confirmed' AND m.matched_facility_id IS NOT NULL
          AND cm.invoice_issued_at IS NOT NULL AND cm.invoice_issued_at <> ''
        GROUP BY m.matched_facility_id
       HAVING COUNT(*) >= 2`,
    ),
  );
  const map = new Map<string, PaymentCycle>();
  for (const r of rows) {
    const avg = Number(r.avg_days);
    if (Number.isFinite(avg)) map.set(String(r.facility_id), { avgDays: Math.round(avg), count: Number(r.n || 0) });
  }
  return map;
}

function timingScore(invoicedAt: string | null, txnDate: string, cycle?: PaymentCycle): number {
  if (!invoicedAt) return 50;
  const days = (new Date(`${txnDate}T00:00:00+09:00`).getTime() - new Date(`${invoicedAt}T00:00:00+09:00`).getTime()) / 86400000;
  if (days < -7) return 20; // 발행보다 한참 앞선 입금 — 선입금 의심
  // 업체별 학습값이 있으면 "그 업체의 평소 간격"과의 편차로 채점한다(P5).
  // 어음 업체의 150일 입금은 정상이고, 즉시 입금 업체의 150일은 이상 신호다.
  if (cycle) {
    const dev = Math.abs(days - cycle.avgDays);
    if (dev <= 15) return 100;
    if (dev <= 45) return 85;
    if (dev <= 90) return 65;
    return 45;
  }
  if (days <= 60) return 100;
  if (days <= 120) return 80;
  if (days <= 180) return 60;
  return 40;
}

/** 어음·장기 결제조건이면 늦은 입금이 정상이므로 감점을 상쇄한다. */
function termsScore(paymentTerms: string | null, days: number | null): number {
  if (!paymentTerms) return 60;
  const isNote = /어음|전자어음|만기/.test(paymentTerms);
  if (isNote) return days != null && days > 60 ? 100 : 70;
  return 80;
}

function score(parts: { facility: number; amount: number; timing: number; terms: number; ambiguous: boolean }): number {
  const raw = parts.facility * 0.35 + parts.amount * 0.35 + parts.timing * 0.15 + parts.terms * 0.1;
  return Math.max(0, Math.round(raw - (parts.ambiguous ? 15 : 0)));
}

export const CONFIDENCE_AUTO = 90; // 이 이상 = 고신뢰(일괄 승인 후보)
export const CONFIDENCE_REVIEW = 55; // 이 미만 = 미매칭 취급

// ─────────────────────────────────────────────
// 매칭 실행
// ─────────────────────────────────────────────

interface Candidate {
  matchType: "exact_1to1" | "already_collected" | "sum_nto1" | "partial" | "overpaid" | "prepaid" | "non_receivable" | "unmatched" | "note_date";
  confidence: number;
  facilityId: string | null;
  matchedAmount: number;
  residualAmount: number;
  lines: Array<{ milestoneId: string; allocatedAmount: number }>;
  reason: Record<string, unknown>;
}

/** 어음 만기·대출실행 날짜 창 — 만기일이 휴일이면 다음 영업일에 결제되므로 며칠의 여유를 둔다. */
const NOTE_DATE_WINDOW_DAYS = 5;

interface NoteDateHit {
  r: Receivable;
  kind: "maturity" | "loan";
  gap: number;
  basisLabel: string;
  approx: boolean;
}

/**
 * 어음 날짜 매칭(마이그 200) — 어음 만기 입금은 입금자명에 발주처가 안 적혀 오는 경우가 많아,
 * 사용자가 입력해 둔 만기일/대출 실행일 근처의 입금을 금액으로 확인한다.
 * ★어음 수수료는 만기액에서 차감되는 게 아니라 별도 출금으로 나간다(2026-08-31 실무 확인)
 *   → 만기 입금은 발행액 "전액" 기준으로만 대조한다. 담보 대출만 이자 선차감 실행이 있어
 *   이자액 차감 금액(미입력 시 95% 이상 근사)을 함께 본다.
 */
function findNoteDateHits(scoped: Receivable[], txn: { amount: number; date: string }): NoteDateHit[] {
  const hits: NoteDateHit[] = [];
  for (const r of scoped) {
    const target = r.remaining > 0 ? r.remaining : r.baseAmount;
    if (!(target > 0)) continue;
    const dates: Array<{ kind: "maturity" | "loan"; date: string | null }> = [
      { kind: "maturity", date: r.noteMaturityDate },
      { kind: "loan", date: r.noteLoanExecutedDate },
    ];
    for (const d of dates) {
      if (!d.date) continue;
      const gap = Math.abs(dayGap(d.date, txn.date));
      if (gap > NOTE_DATE_WINDOW_DAYS) continue;
      const exact = amountMatch(target, txn.amount, r.settlementAmount);
      if (exact.hit) {
        hits.push({ r, kind: d.kind, gap, basisLabel: BASIS_LABEL[exact.basis], approx: false });
        continue;
      }
      if (d.kind === "loan") {
        // 대출 실행 입금 = 어음 액면(공급가/VAT 포함/정산액) - 선취 이자.
        const interest = r.noteLoanInterestAmount ?? 0;
        if (interest > 0) {
          const nets = [target - interest, withVat(target) - interest];
          if (r.settlementAmount && r.settlementAmount > 0) {
            nets.push(r.settlementAmount - interest, withVat(r.settlementAmount) - interest);
          }
          if (nets.some((v) => Math.abs(v - txn.amount) <= AMOUNT_TOLERANCE)) {
            hits.push({ r, kind: "loan", gap, basisLabel: "대출 이자 차감액 일치", approx: false });
            continue;
          }
        }
        // 이자액 미입력 — 액면(VAT 포함) 대비 95~100% 입금이면 근사 후보로만 올린다(항상 사람 검토).
        const gross = withVat(target);
        if (txn.amount <= gross && txn.amount >= gross * 0.95) {
          hits.push({ r, kind: "loan", gap, basisLabel: "대출 실행 추정(이자 차감 근사)", approx: true });
        }
      }
    }
  }
  // 정확 일치 우선, 같은 급이면 날짜가 가까운 순.
  return hits.sort((a, b) => (a.approx === b.approx ? a.gap - b.gap : a.approx ? 1 : -1));
}

/** 어음 날짜 매칭 후보 → Candidate. 조합 우연성이 있으니 고신뢰 임계는 넘지 못하게 눌러 둔다. */
function noteDateCandidate(hits: NoteDateHit[], txnAmount: number, facilityScore: number): Candidate {
  const top = hits[0];
  const ambiguous = hits.length > 1 && hits[1].gap === top.gap && hits[1].approx === top.approx;
  return {
    matchType: "note_date",
    confidence: Math.min(
      CONFIDENCE_AUTO - 5,
      score({
        facility: facilityScore,
        amount: top.approx ? 70 : 100,
        timing: top.gap === 0 ? 100 : top.gap <= 2 ? 90 : 80,
        terms: 100,
        ambiguous,
      }),
    ),
    facilityId: top.r.facilityId,
    matchedAmount: txnAmount,
    residualAmount: 0,
    // 실입금이 이자 차감액이어도 수금은 단계 잔액 전액으로 채운다 — 차감분(이자)은 비용이지 미수가 아니다.
    lines: [{ milestoneId: top.r.milestoneId, allocatedAmount: top.r.remaining }],
    reason: {
      rule: `${top.kind === "maturity" ? "어음 만기일" : "어음 담보대출 실행일"} ${top.gap === 0 ? "당일" : `±${top.gap}일`} 입금 + ${top.basisLabel}`,
      noteBank: top.r.noteBank,
      contract: top.r.contractTitle,
      stage: top.r.stageLabel,
      facilityName: top.r.facilityName,
      gapDays: top.gap,
      competitors: hits.length - 1,
    },
  };
}

/** 같은 거래처 미수들 중 합이 입금액과 같은 부분집합 탐색(어음 일괄지급 대응). 후보가 많으면 포기한다. */
function findSubset(items: Receivable[], target: number, amountOf: (r: Receivable) => number): Receivable[] | null {
  const pool = items.slice(0, 12).sort((a, b) => amountOf(b) - amountOf(a));
  const found: Receivable[] = [];
  let calls = 0;
  const walk = (start: number, rest: number, picked: Receivable[]): boolean => {
    if (calls++ > 4000) return false;
    if (Math.abs(rest) <= AMOUNT_TOLERANCE && picked.length >= 2) {
      found.push(...picked);
      return true;
    }
    if (rest < -AMOUNT_TOLERANCE) return false;
    for (let i = start; i < pool.length; i += 1) {
      if (walk(i + 1, rest - amountOf(pool[i]), [...picked, pool[i]])) return true;
    }
    return false;
  };
  return walk(0, target, []) ? found : null;
}

/** 합계 매칭용 금액 — 정산이 있으면 정산액, 없으면 잔액/기록된 수금액. */
const dueAmount = (r: Receivable) => (r.settlementAmount && r.settlementAmount > 0 ? r.settlementAmount : r.remaining);
const paidAmount = (r: Receivable) => (r.settlementAmount && r.settlementAmount > 0 ? r.settlementAmount : r.collectedAmount);

function buildCandidate(
  txn: { amount: number; date: string; remitter: string; transType: string | null; remark2: string | null },
  receivables: Receivable[],
  facility: { facilityId: string; strength: number } | null,
  /** 이번 실행에서 이미 다른 입금에 배분된 단계 — 같은 계산서가 여러 입금에 전액 매칭되는 것을 막는다. */
  usedMilestones: Set<string> = new Set(),
  /** 이 거래처의 학습된 결제주기(확정 이력 2건 이상일 때만 존재). */
  cycle?: PaymentCycle,
): Candidate {
  // ★거래처를 못 찾으면 금액 매칭을 아예 시도하지 않는다(2026-08-16 실사용 실증).
  //   "고용노동부 입금 4,800,000" 이 금액만 같다는 이유로 롯데엠시시 계산서에 붙는 식의 오매칭이
  //   검토 큐를 뒤덮었다. 금액 일치는 거래처가 확인된 뒤에야 의미가 있다.
  //   예외 = 어음(마이그 200): 어음 만기·대출 실행 입금은 애초에 입금자명에 발주처가 없다.
  //   사용자가 입력한 만기일/대출실행일 + 금액이 동시에 맞을 때만 날짜 근거로 후보를 만든다.
  if (!facility) {
    const openForNote = receivables.filter((r) => !r.collected && !usedMilestones.has(r.milestoneId));
    const noteHits = findNoteDateHits(openForNote, txn);
    if (noteHits.length) return noteDateCandidate(noteHits, txn.amount, 50);

    const nonReceivableHint = looksNonReceivable(txn.remitter, txn.transType, txn.remark2);
    return {
      matchType: nonReceivableHint ? "non_receivable" : "unmatched",
      confidence: 0,
      facilityId: null,
      matchedAmount: 0,
      residualAmount: txn.amount,
      lines: [],
      reason: {
        rule: nonReceivableHint
          ? "이자·세금·자금이동 등 수금 아님으로 추정"
          : `입금자명 "${txn.remitter}" 으로 거래처를 찾지 못했습니다 — 수동 매칭으로 지정하거나 제외로 기록하세요`,
      },
    };
  }

  const all = receivables.filter((r) => r.facilityIds.includes(facility.facilityId));
  const scoped = all.filter((r) => !r.collected && !usedMilestones.has(r.milestoneId)); // 매칭 대상 = 미수
  const done = all.filter((r) => r.collected && !usedMilestones.has(r.milestoneId)); // 이미 수금 처리된 단계(수기 입력 포함)
  const facilityScore = facility?.strength ?? 0;
  const days = (invoicedAt: string | null) =>
    invoicedAt ? Math.round((new Date(`${txn.date}T00:00:00+09:00`).getTime() - new Date(`${invoicedAt}T00:00:00+09:00`).getTime()) / 86400000) : null;
  const basisLabel = (b: AmountBasis) => BASIS_LABEL[b];

  // ① 금액 정확 일치 — 단계 금액은 공급가액이므로 VAT 포함액도 함께 본다(실측)
  const exacts = scoped
    .map((r) => ({ r, m: amountMatch(r.remaining, txn.amount, r.settlementAmount) }))
    .filter((x) => x.m.hit);
  if (exacts.length) {
    const ranked = exacts
      .map((x) => ({ r: x.r, basis: x.m.basis, s: timingScore(x.r.invoicedAt, txn.date, cycle) }))
      .sort((a, b) => b.s - a.s);
    const top = ranked[0];
    const ambiguous = ranked.length > 1 && ranked[1].s === top.s;
    return {
      matchType: "exact_1to1",
      confidence: score({
        facility: facilityScore,
        amount: 100,
        timing: top.s,
        terms: termsScore(top.r.paymentTerms, days(top.r.invoicedAt)),
        ambiguous,
      }),
      facilityId: facility.facilityId,
      matchedAmount: txn.amount,
      residualAmount: 0,
      // 배분액은 단계 잔액(공급가액) 기준 — VAT 포함 입금이어도 수금액은 단계 금액으로 채운다.
      lines: [{ milestoneId: top.r.milestoneId, allocatedAmount: top.r.remaining }],
      reason: {
        rule: `금액 정확 일치(${basisLabel(top.basis)})`,
        competitors: ranked.length - 1,
        facilityStrength: facilityScore,
        gapDays: days(top.r.invoicedAt),
      },
    };
  }

  // ①-노트: 어음 날짜 매칭 — 거래처는 식별됐지만 담보대출 이자 차감 등으로 금액이 어긋나는 경우,
  //         입력된 만기일/대출실행일이 입금일과 맞으면 날짜 근거로 보강한다(전액 일치는 ①에서 이미 잡힌다).
  {
    const noteHits = findNoteDateHits(scoped, txn);
    if (noteHits.length) return noteDateCandidate(noteHits, txn.amount, facilityScore);
  }

  // ①-b 이미 기록된 수금과 일치 — 수기로 넣어 둔 수금 건을 계좌 입금과 짝지어 확인만 한다(중복 반영 없음).
  const alreadyDone = done
    .map((r) => ({ r, m: amountMatch(r.collectedAmount, txn.amount, r.settlementAmount) }))
    .filter((x) => x.m.hit);
  if (alreadyDone.length) {
    const ranked = alreadyDone
      .map((x) => ({ r: x.r, basis: x.m.basis, gap: Math.abs(dayGap(x.r.collectedAt, txn.date)) }))
      .sort((a, b) => a.gap - b.gap);
    const top = ranked[0];
    return {
      matchType: "already_collected",
      // 금액+거래처가 맞고 수금일도 가까우면 확신할 수 있다(승인해도 금액은 다시 더하지 않는다).
      confidence: score({
        facility: facilityScore,
        amount: 100,
        timing: top.gap <= 7 ? 100 : top.gap <= 30 ? 80 : 60,
        terms: 80,
        ambiguous: ranked.length > 1,
      }),
      facilityId: facility.facilityId,
      matchedAmount: txn.amount,
      residualAmount: 0,
      lines: [{ milestoneId: top.r.milestoneId, allocatedAmount: 0 }], // 0 = 반영하지 않고 확인만
      reason: {
        rule:
          top.basis === "settlement" || top.basis === "settlement_vat"
            ? `실적 정산액 기준으로 일치(${basisLabel(top.basis)}) — 단계의 수금금액은 정산 전 청구금액 그대로이니 확인이 필요합니다`
            : `이미 입력된 수금과 일치(${basisLabel(top.basis)}) — 승인해도 수금액은 다시 더해지지 않습니다`,
        collectedAt: top.r.collectedAt,
        gapDays: top.gap,
        facilityStrength: facilityScore,
      },
    };
  }

  // ①-c 이미 기록된 수금 여러 건의 합계 — 기성금 1·2·3 을 한 번에 받는 사업장(사용자 요구 원안 D5).
  //     세 단계 모두 수금 처리돼 있으면 미수 합계 매칭(②)에 걸리지 않으므로 별도로 본다.
  if (done.length >= 2) {
    const paidSubset =
      findSubset(done, txn.amount, paidAmount) ?? findSubset(done, Math.round(txn.amount / 1.1), paidAmount);
    if (paidSubset) {
      const vatBasis = Math.abs(paidSubset.reduce((a, r) => a + paidAmount(r), 0) - txn.amount) > AMOUNT_TOLERANCE;
      return {
        matchType: "already_collected",
        confidence: Math.min(
          CONFIDENCE_AUTO - 5, // 조합 우연성이 있어 항상 사람이 본다
          score({ facility: facilityScore, amount: 95, timing: 85, terms: 80, ambiguous: false }),
        ),
        facilityId: facility.facilityId,
        matchedAmount: txn.amount,
        residualAmount: 0,
        lines: paidSubset.map((r) => ({ milestoneId: r.milestoneId, allocatedAmount: 0 })), // 확인만(중복 반영 없음)
        reason: {
          rule: `이미 입력된 수금 ${paidSubset.length}건의 합계와 일치${vatBasis ? "(VAT 포함액 기준)" : ""} — 여러 계산서를 한 번에 받은 건입니다`,
          stages: paidSubset.map((r) => `${r.stageLabel} ${Math.round(paidAmount(r)).toLocaleString("ko-KR")}`).join(" + "),
          facilityStrength: facilityScore,
        },
      };
    }
  }

  // ② 합계 매칭(거래처가 식별된 경우만 — 전역 조합 탐색은 오매칭 위험)
  if (scoped.length >= 2) {
    // 합계도 공급가액/VAT 포함 두 기준으로 시도
    const subset = findSubset(scoped, txn.amount, dueAmount) ?? findSubset(scoped, Math.round(txn.amount / 1.1), dueAmount);
    if (subset) {
      return {
        matchType: "sum_nto1",
        // 합계 매칭은 조합 우연성이 있어 고신뢰 임계를 넘지 못하게 눌러 둔다(항상 사람 검토).
        confidence: Math.min(
          CONFIDENCE_AUTO - 5,
          score({ facility: facilityScore, amount: 95, timing: 80, terms: termsScore(subset[0].paymentTerms, null), ambiguous: false }),
        ),
        facilityId: facility.facilityId,
        matchedAmount: txn.amount,
        residualAmount: 0,
        lines: subset.map((r) => ({ milestoneId: r.milestoneId, allocatedAmount: dueAmount(r) })),
        reason: { rule: "여러 계산서 합계 일치(어음 일괄지급 등)", count: subset.length, facilityStrength: facilityScore },
      };
    }
  }

  // ②-b 혼합 합계 — 일부는 미수, 일부는 이미 수금 입력된 단계들을 한 번에 받은 경우.
  //     수금 처리된 단계는 배분 0(확인만), 미수 단계만 실제로 반영한다.
  if (all.length >= 2) {
    const mixedAmount = (r: Receivable) => (r.collected ? paidAmount(r) : dueAmount(r));
    const mixed = findSubset(all, txn.amount, mixedAmount) ?? findSubset(all, Math.round(txn.amount / 1.1), mixedAmount);
    if (mixed && mixed.some((r) => !r.collected) && mixed.some((r) => r.collected)) {
      return {
        matchType: "sum_nto1",
        confidence: Math.min(
          CONFIDENCE_AUTO - 5,
          score({ facility: facilityScore, amount: 90, timing: 80, terms: 80, ambiguous: false }),
        ),
        facilityId: facility.facilityId,
        matchedAmount: txn.amount,
        residualAmount: 0,
        lines: mixed.map((r) => ({ milestoneId: r.milestoneId, allocatedAmount: r.collected ? 0 : dueAmount(r) })),
        reason: {
          rule: "여러 계산서 합계와 일치 — 이미 수금 입력된 단계는 금액을 다시 더하지 않습니다",
          stages: mixed.map((r) => `${r.stageLabel}${r.collected ? "(수금 완료)" : ""}`).join(" + "),
          facilityStrength: facilityScore,
        },
      };
    }
  }

  // ③ 부분입금 — 입금액이 특정 미수 잔액보다 작을 때, 잔액이 가장 가까운 건에 배분
  if (scoped.length) {
    // 입금이 VAT 포함으로 들어오므로, 잔액도 VAT 포함으로 환산해 비교한다.
    const partials = scoped.filter((r) => withVat(r.remaining) > txn.amount).sort((a, b) => a.remaining - b.remaining);
    if (partials.length) {
      const top = partials[0];
      return {
        matchType: "partial",
        confidence: score({
          facility: facilityScore,
          amount: 70,
          timing: timingScore(top.invoicedAt, txn.date, cycle),
          terms: termsScore(top.paymentTerms, days(top.invoicedAt)),
          ambiguous: partials.length > 1,
        }),
        facilityId: facility.facilityId,
        matchedAmount: txn.amount,
        residualAmount: 0,
        lines: [{ milestoneId: top.milestoneId, allocatedAmount: txn.amount }],
        reason: { rule: "부분입금(잔액 미달)", remaining: top.remaining - txn.amount, facilityStrength: facilityScore },
      };
    }
    // ④ 과대입금 — 미수 합보다 큰 입금
    const totalDue = scoped.reduce((acc, r) => acc + r.remaining, 0);
    if (totalDue > 0 && txn.amount > withVat(totalDue)) {
      return {
        matchType: "overpaid",
        confidence: score({ facility: facilityScore, amount: 50, timing: 70, terms: 60, ambiguous: false }),
        facilityId: facility.facilityId,
        matchedAmount: totalDue,
        residualAmount: txn.amount - totalDue,
        lines: scoped.map((r) => ({ milestoneId: r.milestoneId, allocatedAmount: r.remaining })),
        reason: { rule: "미수 합계 초과 입금", residual: txn.amount - totalDue, facilityStrength: facilityScore },
      };
    }
  }

  // ⑤ 거래처는 알겠는데 발행된 미수가 없음 = 선입금
  if (scoped.length === 0) {
    const note = done.length ? `이 거래처의 단계는 모두 수금 처리됨(${done.length}건) — 금액이 맞지 않아 짝을 찾지 못했습니다` : "거래처는 식별됐으나 미수 계산서 없음(선입금 의심)";
    return {
      matchType: "prepaid",
      confidence: score({ facility: facilityScore, amount: 0, timing: 50, terms: 60, ambiguous: false }),
      facilityId: facility.facilityId,
      matchedAmount: 0,
      residualAmount: txn.amount,
      lines: [],
      reason: { rule: note, facilityStrength: facilityScore },
    };
  }

  // ⑥ 그 외 — 비수금 힌트가 있으면 라벨링, 없으면 미매칭
  const nonReceivable = looksNonReceivable(txn.remitter, txn.transType, txn.remark2);
  return {
    matchType: nonReceivable ? "non_receivable" : "unmatched",
    confidence: 0,
    facilityId: null,
    matchedAmount: 0,
    residualAmount: txn.amount,
    lines: [],
    reason: { rule: nonReceivable ? "이자·세금·자금이동 등 수금 아님으로 추정" : "거래처·금액 모두 매칭 실패" },
  };
}

/**
 * 미처리 입금건 매칭 실행. 기존 suggested 결과는 지우고 다시 만든다(confirmed 는 보존).
 * @param range 미지정 시 최근 6개월 입금건
 */
export async function runRecon(options?: { from?: string; to?: string; includeAll?: boolean }): Promise<{ scanned: number; suggested: number; highConfidence: number }> {
  const db = await getDb();
  const receivables = await loadReceivables(db);
  const relevantIds = new Set(receivables.flatMap((r) => r.facilityIds));
  const index = await buildFacilityIndex(db, relevantIds);
  const cycles = await loadPaymentCycles(db); // 업체별 결제주기 학습(P5)

  const where: string[] = ["t.direction = 'in'"];
  const args: unknown[] = [];
  if (!options?.includeAll) where.push(`t.recon_status IN ('unprocessed', 'suggested', 'unmatched')`);
  if (options?.from) {
    args.push(`${options.from} 00:00:00`);
    where.push(`t.txn_at >= $${args.length}`);
  }
  if (options?.to) {
    args.push(`${options.to} 23:59:59`);
    where.push(`t.txn_at <= $${args.length}`);
  }
  const txns = rowsToObjects(
    await db.exec(
      `SELECT t.txn_id, t.txn_at, t.amount, t.remitter_name_raw, t.remitter_name_norm, t.trans_type, t.remark2
         FROM bank_transactions t
        WHERE ${where.join(" AND ")}
          AND NOT EXISTS (SELECT 1 FROM recon_matches m WHERE m.txn_id = t.txn_id AND m.status = 'confirmed')
        ORDER BY t.txn_at DESC`,
      args,
    ),
  );

  let suggested = 0;
  let highConfidence = 0;
  const now = KST_NOW();
  // 이미 확정된 매칭이 물고 있는 단계는 새 후보에서 뺀다(같은 계산서 중복 배분 방지).
  const usedMilestones = new Set(
    rowsToObjects(
      await db.exec(
        `SELECT l.milestone_id FROM recon_match_lines l JOIN recon_matches m ON m.match_id = l.match_id WHERE m.status = 'confirmed'`,
      ),
    ).map((r) => String(r.milestone_id)),
  );

  await withDbWrite(async (tx) => {
    for (const row of txns) {
      const txnId = String(row.txn_id);
      const remitter = String(row.remitter_name_norm || row.remitter_name_raw || "");
      const facilityHit = identifyFacility(remitter, index);
      const candidate = buildCandidate(
        {
          amount: Number(row.amount || 0),
          date: String(row.txn_at).slice(0, 10),
          remitter,
          transType: row.trans_type ? String(row.trans_type) : null,
          remark2: row.remark2 ? String(row.remark2) : null,
        },
        receivables,
        facilityHit,
        usedMilestones,
        facilityHit ? cycles.get(facilityHit.facilityId) : undefined,
      );
      // 전액 배분된 단계는 이번 실행 내 다른 입금이 다시 가져가지 못하게 잠근다(부분입금은 예외).
      if (candidate.matchType !== "partial") {
        for (const line of candidate.lines) usedMilestones.add(line.milestoneId);
      }

      // 미확정 제안은 매번 갈아끼운다(원장·미수 상태가 바뀌면 결과도 바뀌므로).
      // 사용자가 제외(rejected)한 건은 남겨 판단을 존중한다 — 해당 txn 은 recon_status='ignored' 라 애초에 대상에서 빠진다.
      await tx.run(`DELETE FROM recon_matches WHERE txn_id = $1 AND status NOT IN ('confirmed', 'rejected')`, [txnId]);

      const matchId = hashId("rm", `${txnId}:${now}`);
      await tx.run(
        `INSERT INTO recon_matches (match_id, txn_id, match_type, status, confidence, matched_facility_id, matched_amount, residual_amount, reason_json, created_by, created_at)
         VALUES ($1, $2, $3, 'suggested', $4, $5, $6, $7, $8::jsonb, 'system', $9)`,
        [
          matchId,
          txnId,
          candidate.matchType,
          candidate.confidence,
          candidate.facilityId,
          candidate.matchedAmount,
          candidate.residualAmount,
          JSON.stringify(candidate.reason),
          now,
        ],
      );
      for (const line of candidate.lines) {
        await tx.run(
          `INSERT INTO recon_match_lines (line_id, match_id, milestone_id, allocated_amount, created_at) VALUES ($1, $2, $3, $4, $5)`,
          [hashId("rl", `${matchId}:${line.milestoneId}`), matchId, line.milestoneId, line.allocatedAmount, now],
        );
      }

      const status =
        candidate.lines.length && candidate.confidence >= CONFIDENCE_REVIEW ? "suggested" : candidate.matchType === "non_receivable" ? "ignored" : "unmatched";
      await tx.run(`UPDATE bank_transactions SET recon_status = $2 WHERE txn_id = $1`, [txnId, status]);

      if (candidate.lines.length) suggested += 1;
      if (candidate.confidence >= CONFIDENCE_AUTO) highConfidence += 1;
    }
  });

  return { scanned: txns.length, suggested, highConfidence };
}

// ─────────────────────────────────────────────
// 검토 큐 조회
// ─────────────────────────────────────────────

export interface ReconQueueLine {
  milestoneId: string;
  allocatedAmount: number;
  contractTitle: string;
  stageLabel: string;
  invoicedAt: string | null;
  remaining: number;
}

export interface ReconQueueItem {
  matchId: string;
  txnId: string;
  txnAt: string;
  amount: number;
  accountLabel: string;
  remitterRaw: string | null;
  transType: string | null;
  remark2: string | null;
  matchType: string;
  status: string;
  confidence: number;
  facilityId: string | null;
  facilityName: string | null;
  matchedAmount: number;
  residualAmount: number;
  reason: Record<string, unknown> | null;
  confirmedAt: string | null;
  rejectReason: string | null;
  rejectNote: string | null;
  lines: ReconQueueLine[];
}

export async function listReconQueue(params?: { bucket?: "high" | "review" | "other" | "confirmed" | "rejected"; limit?: number }): Promise<{
  items: ReconQueueItem[];
  counts: { high: number; review: number; other: number; confirmed: number; rejected: number };
  lastRunAt: string | null;
}> {
  const db = await getDb();
  const limit = Math.min(params?.limit ?? 100, 300);

  const hasLines = `EXISTS (SELECT 1 FROM recon_match_lines l WHERE l.match_id = m.match_id)`;
  const conf = `COALESCE(m.confidence, 0)`;
  const bucketSql: Record<string, string> = {
    high: `m.status = 'suggested' AND ${conf} >= ${CONFIDENCE_AUTO} AND ${hasLines}`,
    review: `m.status = 'suggested' AND ${conf} >= ${CONFIDENCE_REVIEW} AND ${conf} < ${CONFIDENCE_AUTO} AND ${hasLines}`,
    other: `m.status = 'suggested' AND (${conf} < ${CONFIDENCE_REVIEW} OR NOT ${hasLines})`,
    confirmed: `m.status = 'confirmed'`,
    rejected: `m.status = 'rejected'`,
  };
  const bucket = params?.bucket ?? "high";

  const rows = rowsToObjects(
    await db.exec(
      `SELECT m.match_id, m.txn_id, m.match_type, m.status, m.confidence, m.matched_facility_id, m.matched_amount,
              m.residual_amount, m.reason_json, m.confirmed_at, m.reject_reason, m.reject_note,
              t.txn_at, t.amount, t.remitter_name_raw, t.trans_type, t.remark2,
              a.account_alias, a.bank_name,
              f.company_name, f.normalized_company_name
         FROM recon_matches m
         JOIN bank_transactions t ON t.txn_id = m.txn_id
         JOIN bank_accounts a ON a.account_id = t.account_id
         LEFT JOIN facilities f ON f.facility_id = m.matched_facility_id
        WHERE ${bucketSql[bucket]}
        ORDER BY m.confidence DESC, t.txn_at DESC
        LIMIT ${limit}`,
    ),
  );

  const matchIds = rows.map((r) => String(r.match_id));
  const lineRows = matchIds.length
    ? rowsToObjects(
        await db.exec(
          `SELECT l.match_id, l.milestone_id, l.allocated_amount, m.stage_label, m.invoice_issued_at,
                  COALESCE(m.invoice_amount, m.amount, 0) - COALESCE(m.collected_amount, 0) AS remaining,
                  c.contract_title
             FROM recon_match_lines l
             JOIN contract_payment_milestones m ON m.milestone_id = l.milestone_id
             JOIN contracts c ON c.contract_id = m.contract_id
            WHERE l.match_id = ANY($1::text[])`,
          [matchIds],
        ),
      )
    : [];
  const linesByMatch = new Map<string, ReconQueueLine[]>();
  for (const l of lineRows) {
    const list = linesByMatch.get(String(l.match_id)) ?? [];
    list.push({
      milestoneId: String(l.milestone_id),
      allocatedAmount: Number(l.allocated_amount || 0),
      contractTitle: String(l.contract_title ?? ""),
      stageLabel: String(l.stage_label ?? ""),
      invoicedAt: l.invoice_issued_at ? String(l.invoice_issued_at).slice(0, 10) : null,
      remaining: Number(l.remaining || 0),
    });
    linesByMatch.set(String(l.match_id), list);
  }

  // FILTER 절에는 서브쿼리를 둘 수 없어, 라인 유무를 먼저 계산한 파생 테이블 위에서 센다.
  const countRows = rowsToObjects(
    await db.exec(
      `SELECT
         COUNT(*) FILTER (WHERE s.status = 'suggested' AND s.has_lines AND s.confidence >= ${CONFIDENCE_AUTO}) AS high,
         COUNT(*) FILTER (WHERE s.status = 'suggested' AND s.has_lines AND s.confidence >= ${CONFIDENCE_REVIEW} AND s.confidence < ${CONFIDENCE_AUTO}) AS review,
         COUNT(*) FILTER (WHERE s.status = 'suggested' AND (NOT s.has_lines OR s.confidence < ${CONFIDENCE_REVIEW})) AS other,
         COUNT(*) FILTER (WHERE s.status = 'confirmed') AS confirmed,
         COUNT(*) FILTER (WHERE s.status = 'rejected') AS rejected
       FROM (
         SELECT m.status, COALESCE(m.confidence, 0) AS confidence,
                EXISTS (SELECT 1 FROM recon_match_lines l WHERE l.match_id = m.match_id) AS has_lines
           FROM recon_matches m
       ) s`,
    ),
  );

  // 지금 보는 목록이 언제 만들어진 것인지 — 규칙을 고쳐도 재실행 전에는 옛 제안이 남기 때문에 표시한다.
  const lastRunRows = rowsToObjects(await db.exec(`SELECT max(created_at) AS last_at FROM recon_matches WHERE created_by = 'system'`));

  return {
    items: rows.map((r) => ({
      matchId: String(r.match_id),
      txnId: String(r.txn_id),
      txnAt: String(r.txn_at),
      amount: Number(r.amount || 0),
      accountLabel: String(r.account_alias || r.bank_name || ""),
      remitterRaw: (r.remitter_name_raw as string | null) ?? null,
      transType: (r.trans_type as string | null) ?? null,
      remark2: (r.remark2 as string | null) ?? null,
      matchType: String(r.match_type),
      status: String(r.status),
      confidence: Number(r.confidence || 0),
      facilityId: r.matched_facility_id ? String(r.matched_facility_id) : null,
      facilityName: r.matched_facility_id ? String(r.normalized_company_name || r.company_name || "") : null,
      matchedAmount: Number(r.matched_amount || 0),
      residualAmount: Number(r.residual_amount || 0),
      reason: (r.reason_json as Record<string, unknown> | null) ?? null,
      confirmedAt: r.confirmed_at ? String(r.confirmed_at) : null,
      rejectReason: r.reject_reason ? String(r.reject_reason) : null,
      rejectNote: r.reject_note ? String(r.reject_note) : null,
      lines: linesByMatch.get(String(r.match_id)) ?? [],
    })),
    counts: {
      high: Number(countRows[0]?.high || 0),
      review: Number(countRows[0]?.review || 0),
      other: Number(countRows[0]?.other || 0),
      confirmed: Number(countRows[0]?.confirmed || 0),
      rejected: Number(countRows[0]?.rejected || 0),
    },
    lastRunAt: lastRunRows[0]?.last_at ? String(lastRunRows[0].last_at) : null,
  };
}

// ─────────────────────────────────────────────
// 확정 / 되돌리기 / 수동 매칭
// ─────────────────────────────────────────────

interface PartialPaymentEntry {
  id: string;
  collectedAt: string;
  amount: number;
  ratio: number;
  memo: string | null;
  recordedBy: string | null;
  recordedAt: string;
  reconMatchId?: string; // 자동대조로 들어온 항목 표식(되돌리기 근거)
}

function parseEntries(raw: unknown): PartialPaymentEntry[] {
  if (Array.isArray(raw)) return raw as PartialPaymentEntry[];
  if (typeof raw === "string" && raw.length) {
    try {
      return JSON.parse(raw) as PartialPaymentEntry[];
    } catch {
      return [];
    }
  }
  return [];
}

/** 기존 수금 모델에 반영 — payments 라우트와 동일한 누적·완료판정 규칙을 그대로 따른다. */
async function applyToMilestone(
  db: PgDatabase,
  milestoneId: string,
  entries: PartialPaymentEntry[],
): Promise<void> {
  const rows = rowsToObjects(
    await db.exec(`SELECT amount, invoice_amount, partial_payments_json FROM contract_payment_milestones WHERE milestone_id = $1`, [milestoneId]),
  );
  if (!rows.length) throw Object.assign(new Error("계약 단계를 찾을 수 없습니다."), { status: 404 });
  const baseAmount = Number(rows[0].invoice_amount ?? rows[0].amount ?? 0);
  const next = entries;
  const totalAmount = next.reduce((acc, e) => acc + Number(e.amount ?? 0), 0);
  const totalRatio = baseAmount > 0 ? Math.round((totalAmount / baseAmount) * 1000) / 1000 : next.reduce((acc, e) => acc + Number(e.ratio ?? 0), 0);
  const isCollected = baseAmount > 0 ? totalAmount >= baseAmount - 1 : totalRatio >= 1;
  const lastAt = next.length ? next[next.length - 1].collectedAt : null;
  await db.run(
    `UPDATE contract_payment_milestones
        SET partial_payments_json = $1::jsonb,
            collected_amount = $2,
            collection_ratio = $3,
            payment_collected = $4,
            payment_collected_at = CASE WHEN $4 = 1 THEN COALESCE(payment_collected_at, $5) ELSE NULL END,
            updated_at = $6
      WHERE milestone_id = $7`,
    [JSON.stringify(next), totalAmount, totalRatio, isCollected ? 1 : 0, lastAt, new Date().toISOString(), milestoneId],
  );
}

/** 제안 승인 — 배분 라인을 milestone 부분입금으로 적재하고 입금자명을 학습한다. */
export async function confirmMatch(matchId: string, actorUserId: string | null): Promise<void> {
  const now = KST_NOW();
  await withDbWrite(async (db) => {
    const matches = rowsToObjects(
      await db.exec(
        `SELECT m.match_id, m.txn_id, m.status, m.match_type, m.matched_facility_id, m.confidence, t.txn_at, t.amount, t.remitter_name_norm, t.remitter_name_raw
           FROM recon_matches m JOIN bank_transactions t ON t.txn_id = m.txn_id
          WHERE m.match_id = $1`,
        [matchId],
      ),
    );
    if (!matches.length) throw Object.assign(new Error("대조 건을 찾을 수 없습니다."), { status: 404 });
    const match = matches[0];
    if (String(match.status) === "confirmed") return;

    const lines = rowsToObjects(
      await db.exec(`SELECT milestone_id, allocated_amount FROM recon_match_lines WHERE match_id = $1`, [matchId]),
    );
    if (!lines.length) throw Object.assign(new Error("배분할 계약 단계가 없습니다. 수동 매칭으로 지정하세요."), { status: 400 });

    const collectedAt = String(match.txn_at).slice(0, 10);
    for (const line of lines) {
      const milestoneId = String(line.milestone_id);
      const amount = Number(line.allocated_amount || 0);
      // 배분액 0 = already_collected(이미 입력된 수금과 짝만 맞추는 건) — 금액을 다시 더하지 않는다.
      if (amount <= 0) continue;
      const rows = rowsToObjects(
        await db.exec(
          `SELECT amount, invoice_amount, collected_amount, payment_collected_at, partial_payments_json
             FROM contract_payment_milestones WHERE milestone_id = $1`,
          [milestoneId],
        ),
      );
      const baseAmount = Number(rows[0]?.invoice_amount ?? rows[0]?.amount ?? 0);
      const entries = parseEntries(rows[0]?.partial_payments_json);
      // 수기로 collected_amount 만 적혀 있던 단계 — 합계 재계산에서 기존 수금이 사라지지 않도록 항목으로 승격한다.
      const legacyCollected = Number(rows[0]?.collected_amount ?? 0);
      if (!entries.length && legacyCollected > 0) {
        entries.push({
          id: hashId("pp", `${milestoneId}:legacy`).slice(0, 15),
          collectedAt: rows[0]?.payment_collected_at ? String(rows[0].payment_collected_at).slice(0, 10) : collectedAt,
          amount: legacyCollected,
          ratio: baseAmount > 0 ? legacyCollected / baseAmount : 0,
          memo: "기존 수금 기록(자동대조 이전)",
          recordedBy: null,
          recordedAt: new Date().toISOString(),
        });
      }
      entries.push({
        id: hashId("pp", `${matchId}:${milestoneId}`).slice(0, 15),
        collectedAt,
        amount,
        ratio: baseAmount > 0 ? amount / baseAmount : 0,
        memo: `자동대조 승인 (입금자 ${String(match.remitter_name_raw ?? match.remitter_name_norm ?? "")})`,
        recordedBy: actorUserId,
        recordedAt: new Date().toISOString(),
        reconMatchId: matchId,
      });
      await applyToMilestone(db, milestoneId, entries);
    }

    await db.run(`UPDATE recon_matches SET status = 'confirmed', confirmed_by = $2, confirmed_at = $3 WHERE match_id = $1`, [matchId, actorUserId, now]);
    await db.run(`UPDATE bank_transactions SET recon_status = 'confirmed' WHERE txn_id = $1`, [String(match.txn_id)]);

    // 입금자명 학습 — 다음 회차부터 같은 이름이면 거래처가 바로 잡힌다.
    // 단 어음 날짜 매칭(note_date)은 입금자명이 발주처가 아니라 어음 교환·은행 명의라 학습하면
    // 이후 다른 어음 입금이 엉뚱한 거래처로 식별된다 → 학습에서 제외.
    const remitter = String(match.remitter_name_norm || match.remitter_name_raw || "");
    if (remitter && match.matched_facility_id && String(match.match_type) !== "note_date") {
      await db.run(
        `INSERT INTO bank_remitter_links (remitter_name_norm, facility_id, confidence_seed, confirm_count, last_confirmed_at, created_at)
         VALUES ($1, $2, $3, 1, $4, $4)
         ON CONFLICT (remitter_name_norm) DO UPDATE SET
           facility_id = EXCLUDED.facility_id,
           confirm_count = bank_remitter_links.confirm_count + 1,
           last_confirmed_at = EXCLUDED.last_confirmed_at`,
        [remitter, String(match.matched_facility_id), Number(match.confidence || 0), now],
      );
    }
  });
}

/** 확정 되돌리기 — 이 match 로 들어간 부분입금 항목만 제거하고 재계산한다. */
export async function unconfirmMatch(matchId: string): Promise<void> {
  await withDbWrite(async (db) => {
    const lines = rowsToObjects(await db.exec(`SELECT milestone_id FROM recon_match_lines WHERE match_id = $1`, [matchId]));
    for (const line of lines) {
      const milestoneId = String(line.milestone_id);
      const rows = rowsToObjects(
        await db.exec(`SELECT partial_payments_json FROM contract_payment_milestones WHERE milestone_id = $1`, [milestoneId]),
      );
      const entries = parseEntries(rows[0]?.partial_payments_json).filter((e) => e.reconMatchId !== matchId);
      await applyToMilestone(db, milestoneId, entries);
    }
    await db.run(`UPDATE recon_matches SET status = 'rejected', confirmed_at = NULL WHERE match_id = $1`, [matchId]);
    await db.run(
      `UPDATE bank_transactions SET recon_status = 'unprocessed'
        WHERE txn_id = (SELECT txn_id FROM recon_matches WHERE match_id = $1)`,
      [matchId],
    );
  });
}

/** 제외 사유(마이그 174) — 결산·분개 기능이 붙기 전까지 "왜 들어온 돈인지"를 남기는 최소 기록. */
export const REJECT_REASONS: Array<{ key: string; label: string }> = [
  { key: "mismatch", label: "오매칭(다른 거래처·금액)" },
  { key: "subsidy", label: "지원금·보조금 (예: 청년고용장려금)" },
  { key: "interest", label: "이자·금융수익" },
  { key: "tax_refund", label: "세금 환급" },
  { key: "transfer", label: "자금 이동(계좌 간)" },
  { key: "other", label: "기타" },
];

/**
 * 제안 제외 — 수금이 아니거나 매칭이 틀린 건을 사유와 함께 기록한다.
 * 원장은 'ignored' 가 되어 재실행 대상에서 빠지고, 기록은 '제외됨' 버킷에서 다시 볼 수 있다.
 */
export async function rejectMatch(matchId: string, reason?: string | null, note?: string | null, actorUserId?: string | null): Promise<void> {
  const now = KST_NOW();
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE recon_matches
          SET status = 'rejected', reject_reason = $2, reject_note = $3, rejected_by = $4, rejected_at = $5
        WHERE match_id = $1`,
      [matchId, reason ?? null, note ?? null, actorUserId ?? null, now],
    );
    await db.run(
      `UPDATE bank_transactions SET recon_status = 'ignored' WHERE txn_id = (SELECT txn_id FROM recon_matches WHERE match_id = $1)`,
      [matchId],
    );
  });
}

/** 제외 되돌리기 — 다음 대조 실행에서 다시 후보로 잡히게 한다. */
export async function unrejectMatch(matchId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE bank_transactions SET recon_status = 'unprocessed' WHERE txn_id = (SELECT txn_id FROM recon_matches WHERE match_id = $1)`,
      [matchId],
    );
    await db.run(`DELETE FROM recon_matches WHERE match_id = $1`, [matchId]);
  });
}

/** 수동 매칭 — 사용자가 거래처·단계·배분액을 직접 지정하고 즉시 확정한다. */
export async function manualMatch(
  params: { txnId: string; facilityId: string | null; lines: Array<{ milestoneId: string; allocatedAmount: number }> },
  actorUserId: string | null,
): Promise<string> {
  if (!params.lines.length) throw Object.assign(new Error("배분할 계약 단계를 선택하세요."), { status: 400 });
  const now = KST_NOW();
  const matchId = hashId("rm", `${params.txnId}:manual:${now}`);
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM recon_matches WHERE txn_id = $1 AND status <> 'confirmed'`, [params.txnId]);
    const total = params.lines.reduce((acc, l) => acc + Number(l.allocatedAmount || 0), 0);
    await db.run(
      `INSERT INTO recon_matches (match_id, txn_id, match_type, status, confidence, matched_facility_id, matched_amount, residual_amount, reason_json, created_by, created_at)
       VALUES ($1, $2, 'manual', 'suggested', 100, $3, $4, 0, $5::jsonb, $6, $7)`,
      [matchId, params.txnId, params.facilityId, total, JSON.stringify({ rule: "사용자 수동 지정" }), actorUserId ?? "system", now],
    );
    for (const line of params.lines) {
      await db.run(
        `INSERT INTO recon_match_lines (line_id, match_id, milestone_id, allocated_amount, created_at) VALUES ($1, $2, $3, $4, $5)`,
        [hashId("rl", `${matchId}:${line.milestoneId}`), matchId, line.milestoneId, line.allocatedAmount, now],
      );
    }
  });
  await confirmMatch(matchId, actorUserId);
  return matchId;
}

/** 수동 매칭 모달용 — 거래처(옵션)로 좁힌 미수 목록. */
export async function listOpenReceivables(facilityId?: string): Promise<Receivable[]> {
  const db = await getDb();
  const all = await loadReceivables(db);
  return facilityId ? all.filter((r) => r.facilityIds.includes(facilityId)) : all;
}
