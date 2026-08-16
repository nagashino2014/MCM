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

export async function buildFacilityIndex(db: PgDatabase): Promise<FacilityIndex> {
  const index: FacilityIndex = { exact: new Map(), list: [], names: new Map() };
  const put = (raw: string | null, facilityId: string, strength: number) => {
    const key = reconKey(raw);
    if (!key || key.length < 2) return;
    const prev = index.exact.get(key);
    if (!prev || prev.strength < strength) index.exact.set(key, { facilityId, strength });
    index.list.push({ key, facilityId });
  };

  const facilities = rowsToObjects(
    await db.exec(`SELECT facility_id, company_name, normalized_company_name FROM facilities`),
  );
  for (const f of facilities) {
    const id = String(f.facility_id);
    index.names.set(id, String(f.normalized_company_name || f.company_name || ""));
    put((f.normalized_company_name as string | null) ?? null, id, 90);
    put((f.company_name as string | null) ?? null, id, 90);
  }
  const aliases = rowsToObjects(await db.exec(`SELECT facility_id, alias FROM facility_aliases`));
  for (const a of aliases) put(String(a.alias), String(a.facility_id), 80);

  const merged = rowsToObjects(
    await db.exec(`SELECT target_facility_id, previous_company_name FROM facility_merge_aliases WHERE previous_company_name IS NOT NULL`),
  );
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
  // 부분일치 — 입금자명이 잘리거나("영흥산업환경(주)차장") 접두가 붙는 경우. 가장 긴 일치를 채택.
  let best: { facilityId: string; strength: number; len: number } | null = null;
  for (const item of index.list) {
    if (item.key.length < 3) continue;
    if (key.includes(item.key) || item.key.includes(key)) {
      if (!best || item.key.length > best.len) best = { facilityId: item.facilityId, strength: 60, len: item.key.length };
    }
  }
  return best ? { facilityId: best.facilityId, strength: best.strength } : null;
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
  facilityName: string;
  invoicedAt: string | null;
  paymentTerms: string | null;
  baseAmount: number; // 단계 총액
  remaining: number; // 미수 잔액
}

export async function loadReceivables(db: PgDatabase): Promise<Receivable[]> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT m.milestone_id, m.contract_id, m.stage_label, m.amount, m.invoice_amount, m.collected_amount,
              m.invoice_issued_at, m.payment_terms,
              c.contract_title, c.counterparty_facility_id,
              f.company_name, f.normalized_company_name
         FROM contract_payment_milestones m
         JOIN contracts c ON c.contract_id = m.contract_id
         LEFT JOIN facilities f ON f.facility_id = c.counterparty_facility_id
        WHERE m.invoice_issued = 1 AND m.payment_collected = 0`,
    ),
  );
  return rows
    .map((r) => {
      const base = Number(r.invoice_amount ?? r.amount ?? 0);
      const collected = Number(r.collected_amount ?? 0);
      return {
        milestoneId: String(r.milestone_id),
        contractId: String(r.contract_id),
        contractTitle: String(r.contract_title ?? ""),
        stageLabel: String(r.stage_label ?? ""),
        facilityId: r.counterparty_facility_id ? String(r.counterparty_facility_id) : null,
        facilityName: String(r.normalized_company_name || r.company_name || ""),
        invoicedAt: r.invoice_issued_at ? String(r.invoice_issued_at).slice(0, 10) : null,
        paymentTerms: r.payment_terms ? String(r.payment_terms) : null,
        baseAmount: base,
        remaining: Math.round(base - collected),
      };
    })
    .filter((r) => r.remaining > 0);
}

// ─────────────────────────────────────────────
// 스코어링
// ─────────────────────────────────────────────

const AMOUNT_TOLERANCE = 1; // 원 단위 반올림 오차만 허용

function timingScore(invoicedAt: string | null, txnDate: string): number {
  if (!invoicedAt) return 50;
  const days = (new Date(`${txnDate}T00:00:00+09:00`).getTime() - new Date(`${invoicedAt}T00:00:00+09:00`).getTime()) / 86400000;
  if (days < -7) return 20; // 발행보다 한참 앞선 입금 — 선입금 의심
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
  matchType: "exact_1to1" | "sum_nto1" | "partial" | "overpaid" | "prepaid" | "non_receivable" | "unmatched";
  confidence: number;
  facilityId: string | null;
  matchedAmount: number;
  residualAmount: number;
  lines: Array<{ milestoneId: string; allocatedAmount: number }>;
  reason: Record<string, unknown>;
}

/** 같은 거래처 미수들 중 합이 입금액과 같은 부분집합 탐색(어음 일괄지급 대응). 후보가 많으면 포기한다. */
function findSubset(items: Receivable[], target: number): Receivable[] | null {
  const pool = items.slice(0, 12).sort((a, b) => b.remaining - a.remaining);
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
      if (walk(i + 1, rest - pool[i].remaining, [...picked, pool[i]])) return true;
    }
    return false;
  };
  return walk(0, target, []) ? found : null;
}

function buildCandidate(
  txn: { amount: number; date: string; remitter: string; transType: string | null; remark2: string | null },
  receivables: Receivable[],
  facility: { facilityId: string; strength: number } | null,
): Candidate {
  const scoped = facility ? receivables.filter((r) => r.facilityId === facility.facilityId) : receivables;
  const facilityScore = facility?.strength ?? 0;
  const days = (invoicedAt: string | null) =>
    invoicedAt ? Math.round((new Date(`${txn.date}T00:00:00+09:00`).getTime() - new Date(`${invoicedAt}T00:00:00+09:00`).getTime()) / 86400000) : null;

  // ① 금액 정확 일치
  const exacts = scoped.filter((r) => Math.abs(r.remaining - txn.amount) <= AMOUNT_TOLERANCE);
  if (exacts.length) {
    const ranked = exacts
      .map((r) => ({ r, s: timingScore(r.invoicedAt, txn.date) }))
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
      facilityId: facility?.facilityId ?? top.r.facilityId,
      matchedAmount: txn.amount,
      residualAmount: 0,
      lines: [{ milestoneId: top.r.milestoneId, allocatedAmount: txn.amount }],
      reason: { rule: "금액 정확 일치", competitors: ranked.length - 1, facilityStrength: facilityScore, gapDays: days(top.r.invoicedAt) },
    };
  }

  // ② 합계 매칭(거래처가 식별된 경우만 — 전역 조합 탐색은 오매칭 위험)
  if (facility && scoped.length >= 2) {
    const subset = findSubset(scoped, txn.amount);
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
        lines: subset.map((r) => ({ milestoneId: r.milestoneId, allocatedAmount: r.remaining })),
        reason: { rule: "여러 계산서 합계 일치(어음 일괄지급 등)", count: subset.length, facilityStrength: facilityScore },
      };
    }
  }

  // ③ 부분입금 — 입금액이 특정 미수 잔액보다 작을 때, 잔액이 가장 가까운 건에 배분
  if (facility && scoped.length) {
    const partials = scoped.filter((r) => r.remaining > txn.amount).sort((a, b) => a.remaining - b.remaining);
    if (partials.length) {
      const top = partials[0];
      return {
        matchType: "partial",
        confidence: score({
          facility: facilityScore,
          amount: 70,
          timing: timingScore(top.invoicedAt, txn.date),
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
    if (totalDue > 0 && txn.amount > totalDue) {
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
  if (facility && scoped.length === 0) {
    return {
      matchType: "prepaid",
      confidence: score({ facility: facilityScore, amount: 0, timing: 50, terms: 60, ambiguous: false }),
      facilityId: facility.facilityId,
      matchedAmount: 0,
      residualAmount: txn.amount,
      lines: [],
      reason: { rule: "거래처는 식별됐으나 미수 계산서 없음(선입금 의심)", facilityStrength: facilityScore },
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
  const index = await buildFacilityIndex(db);
  const receivables = await loadReceivables(db);

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

  await withDbWrite(async (tx) => {
    for (const row of txns) {
      const txnId = String(row.txn_id);
      const remitter = String(row.remitter_name_norm || row.remitter_name_raw || "");
      const candidate = buildCandidate(
        {
          amount: Number(row.amount || 0),
          date: String(row.txn_at).slice(0, 10),
          remitter,
          transType: row.trans_type ? String(row.trans_type) : null,
          remark2: row.remark2 ? String(row.remark2) : null,
        },
        receivables,
        identifyFacility(remitter, index),
      );

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
  lines: ReconQueueLine[];
}

export async function listReconQueue(params?: { bucket?: "high" | "review" | "other" | "confirmed"; limit?: number }): Promise<{
  items: ReconQueueItem[];
  counts: { high: number; review: number; other: number; confirmed: number };
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
  };
  const bucket = params?.bucket ?? "high";

  const rows = rowsToObjects(
    await db.exec(
      `SELECT m.match_id, m.txn_id, m.match_type, m.status, m.confidence, m.matched_facility_id, m.matched_amount,
              m.residual_amount, m.reason_json, m.confirmed_at,
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
         COUNT(*) FILTER (WHERE s.status = 'confirmed') AS confirmed
       FROM (
         SELECT m.status, COALESCE(m.confidence, 0) AS confidence,
                EXISTS (SELECT 1 FROM recon_match_lines l WHERE l.match_id = m.match_id) AS has_lines
           FROM recon_matches m
       ) s`,
    ),
  );

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
      lines: linesByMatch.get(String(r.match_id)) ?? [],
    })),
    counts: {
      high: Number(countRows[0]?.high || 0),
      review: Number(countRows[0]?.review || 0),
      other: Number(countRows[0]?.other || 0),
      confirmed: Number(countRows[0]?.confirmed || 0),
    },
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
        `SELECT m.match_id, m.txn_id, m.status, m.matched_facility_id, m.confidence, t.txn_at, t.amount, t.remitter_name_norm, t.remitter_name_raw
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
    const remitter = String(match.remitter_name_norm || match.remitter_name_raw || "");
    if (remitter && match.matched_facility_id) {
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

/** 제안 반려 — 매칭을 버리고 원장은 미매칭으로 되돌린다(재실행 시 다시 후보가 만들어진다). */
export async function rejectMatch(matchId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`UPDATE recon_matches SET status = 'rejected' WHERE match_id = $1`, [matchId]);
    await db.run(
      `UPDATE bank_transactions SET recon_status = 'ignored' WHERE txn_id = (SELECT txn_id FROM recon_matches WHERE match_id = $1)`,
      [matchId],
    );
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
  return facilityId ? all.filter((r) => r.facilityId === facilityId) : all;
}
