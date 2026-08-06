// 견적 수주 분석 리포트(Q5) — docs/quotation-blueprint.md §5-5 피드백 루프.
// quotations(136·137) 결과 데이터를 세분류·상황변수·금액구간 축으로 집계하고,
// 실주 건의 (경쟁 낙찰가 / 우리 견적가) 갭에서 세트별 시장 보정계수를 제안한다.
// 순수 집계 — 화면(QuoteSettingsBoard '수주 분석' 탭)과 API 가 이 결과를 그대로 쓴다.

import { getDb, rowsToObjects } from "@/lib/db";
import {
  QUOTE_AMOUNT_BANDS,
  type QuoteReport,
  type QuoteReportBucket,
  type QuoteReportSuggestion,
  type SituationEntry,
} from "./types";

/** 제안을 내기 위한 최소 표본(실주 갭 건수) — 미만이면 '표본 부족'으로 보류 */
const MIN_SUGGEST_SAMPLES = 3;

interface Row {
  serviceType: string;
  serviceSubtype: string;
  amount: number;
  result: string;
  resultAmount: number | null;
  issueDate: string | null;
  resultAt: string | null;
  situation: SituationEntry[];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function emptyBucket(key: string, label: string): QuoteReportBucket {
  return {
    key,
    label,
    total: 0,
    decided: 0,
    won: 0,
    lost: 0,
    dropped: 0,
    pending: 0,
    winRate: null,
    quotedAmount: 0,
    wonAmount: 0,
    amountWinRate: null,
    lostGapPct: null,
    lostGapSamples: 0,
  };
}

/** 버킷 누적 — 실주 갭 표본은 별도 배열에 모았다가 finalize 에서 중앙값 처리 */
function accumulate(b: QuoteReportBucket, r: Row, gaps: number[]): void {
  b.total += 1;
  b.quotedAmount += r.amount;
  if (r.result === "won") {
    b.won += 1;
    b.decided += 1;
    b.wonAmount += r.resultAmount ?? r.amount;
  } else if (r.result === "lost") {
    b.lost += 1;
    b.decided += 1;
    if (r.resultAmount && r.amount > 0) gaps.push(r.resultAmount / r.amount);
  } else if (r.result === "dropped") {
    b.dropped += 1;
  } else {
    b.pending += 1;
  }
}

function finalize(b: QuoteReportBucket, rows: Row[], gaps: number[]): QuoteReportBucket {
  b.winRate = b.decided > 0 ? b.won / b.decided : null;
  const decidedQuoted = rows.filter((r) => r.result === "won" || r.result === "lost").reduce((a, r) => a + r.amount, 0);
  b.amountWinRate = decidedQuoted > 0 ? b.wonAmount / decidedQuoted : null;
  const m = median(gaps);
  b.lostGapPct = m != null ? m - 1 : null;
  b.lostGapSamples = gaps.length;
  return b;
}

/** 그룹 키별 집계 헬퍼 — keyOf 가 null 이면 그 행은 제외 */
function groupBy(rows: Row[], keyOf: (r: Row) => { key: string; label: string } | null): QuoteReportBucket[] {
  const buckets = new Map<string, { b: QuoteReportBucket; rows: Row[]; gaps: number[] }>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    let entry = buckets.get(k.key);
    if (!entry) {
      entry = { b: emptyBucket(k.key, k.label), rows: [], gaps: [] };
      buckets.set(k.key, entry);
    }
    entry.rows.push(r);
    accumulate(entry.b, r, entry.gaps);
  }
  return [...buckets.values()].map((e) => finalize(e.b, e.rows, e.gaps)).sort((a, b) => b.total - a.total);
}

export async function buildQuoteReport(params: { from?: string | null; to?: string | null }): Promise<QuoteReport> {
  const db = await getDb();
  const cond: string[] = ["send_status <> 'pending'"];
  const args: unknown[] = [];
  if (params.from) {
    args.push(params.from);
    cond.push(`substr(COALESCE(issue_date, created_at), 1, 7) >= $${args.length}`);
  }
  if (params.to) {
    args.push(params.to);
    cond.push(`substr(COALESCE(issue_date, created_at), 1, 7) <= $${args.length}`);
  }
  const raw = rowsToObjects(
    await db.exec(
      `SELECT service_type, service_subtype, total_amount, result, result_amount, issue_date, result_at, situation
         FROM quotations
        WHERE ${cond.join(" AND ")}`,
      args
    )
  );

  const rows: Row[] = raw.map((r) => {
    let situation: SituationEntry[] = [];
    try {
      const v = typeof r.situation === "string" ? JSON.parse(r.situation) : r.situation;
      if (Array.isArray(v)) situation = v as SituationEntry[];
    } catch {
      situation = [];
    }
    return {
      serviceType: String(r.service_type ?? "기타"),
      serviceSubtype: String(r.service_subtype ?? "-"),
      amount: Number(r.total_amount ?? 0),
      result: String(r.result ?? "pending"),
      resultAmount: r.result_amount != null ? Number(r.result_amount) : null,
      issueDate: r.issue_date != null ? String(r.issue_date) : null,
      resultAt: r.result_at != null ? String(r.result_at) : null,
      situation,
    };
  });

  // KPI — 전체를 하나의 버킷으로 계산
  const allGaps: number[] = [];
  const all = emptyBucket("all", "전체");
  for (const r of rows) accumulate(all, r, allGaps);
  finalize(all, rows, allGaps);

  const decideDays = rows
    .filter((r) => r.issueDate && r.resultAt && (r.result === "won" || r.result === "lost"))
    .map((r) => (Date.parse(r.resultAt as string) - Date.parse(r.issueDate as string)) / 86_400_000)
    .filter((d) => isFinite(d) && d >= 0);

  const bySubtype = groupBy(rows, (r) => ({ key: `${r.serviceType}/${r.serviceSubtype}`, label: `${r.serviceType} · ${r.serviceSubtype}` }));

  // 상황 변수 — 한 건에 여러 코드가 붙을 수 있어 코드별로 중복 집계된다(모수는 '해당 코드 사용 건')
  const situationBuckets = new Map<string, { b: QuoteReportBucket; rows: Row[]; gaps: number[] }>();
  for (const r of rows) {
    const codes = [...new Set(r.situation.map((s) => s.code).filter(Boolean))];
    for (const code of codes) {
      let entry = situationBuckets.get(code);
      if (!entry) {
        entry = { b: emptyBucket(code, code), rows: [], gaps: [] };
        situationBuckets.set(code, entry);
      }
      entry.rows.push(r);
      accumulate(entry.b, r, entry.gaps);
    }
  }
  const codeLabels = rowsToObjects(await db.exec(`SELECT code, label FROM quote_situation_codes`, []));
  const labelByCode = new Map(codeLabels.map((c) => [String(c.code), String(c.label ?? c.code)]));
  const bySituation = [...situationBuckets.values()]
    .map((e) => {
      const b = finalize(e.b, e.rows, e.gaps);
      b.label = labelByCode.get(b.key) ?? b.key;
      return b;
    })
    .sort((a, b) => b.total - a.total);

  const byAmountBand = groupBy(rows, (r) => {
    const hit = QUOTE_AMOUNT_BANDS.find((x) => r.amount >= x.min && (x.max == null || r.amount < x.max));
    return hit ? { key: hit.key, label: hit.label } : null;
  }).sort((a, b) => QUOTE_AMOUNT_BANDS.findIndex((x) => x.key === a.key) - QUOTE_AMOUNT_BANDS.findIndex((x) => x.key === b.key));

  // 시장 보정계수 제안 — 세분류별 실주 갭 중앙값을 현재 계수에 곱한다.
  const sets = rowsToObjects(
    await db.exec(
      `SELECT set_id, service_type, service_subtype, market_adjust
         FROM quote_rate_sets WHERE status = 'active'`,
      []
    )
  );
  const setByKey = new Map(sets.map((s) => [`${String(s.service_type)}/${String(s.service_subtype)}`, s]));

  const suggestions: QuoteReportSuggestion[] = bySubtype.map((b) => {
    const [serviceType, serviceSubtype] = b.key.split("/");
    const set = setByKey.get(b.key);
    const currentAdjust = set ? Number(set.market_adjust ?? 1) : null;
    const base: QuoteReportSuggestion = {
      serviceType,
      serviceSubtype,
      setId: set ? String(set.set_id) : null,
      currentAdjust,
      suggestAdjust: null,
      reason: "",
      samples: b.lostGapSamples,
    };
    if (b.lostGapSamples >= MIN_SUGGEST_SAMPLES && b.lostGapPct != null && currentAdjust != null) {
      const ratio = 1 + b.lostGapPct;
      base.suggestAdjust = Math.round(currentAdjust * ratio * 1000) / 1000;
      base.reason =
        b.lostGapPct < 0
          ? `실주 ${b.lostGapSamples}건의 경쟁 낙찰가가 자사 견적 대비 중앙값 ${(b.lostGapPct * 100).toFixed(1)}% — 표준가 하향 여지`
          : `실주 ${b.lostGapSamples}건의 경쟁 낙찰가가 오히려 ${(b.lostGapPct * 100).toFixed(1)}% 높음 — 가격 외 요인(실적·기술) 점검 필요`;
    } else if (b.decided >= 5 && b.winRate != null && b.winRate >= 0.8 && currentAdjust != null) {
      base.suggestAdjust = Math.round(currentAdjust * 1.05 * 1000) / 1000;
      base.reason = `결정 ${b.decided}건 중 수주율 ${(b.winRate * 100).toFixed(0)}% — 가격 상향 여지(+5%)`;
      base.samples = b.decided;
    } else {
      base.reason = set ? "표본 부족 — 결과·낙찰가 기입이 더 필요합니다." : "기준 세트 미등록(자유입력 세분류)";
    }
    return base;
  });

  return {
    from: params.from ?? null,
    to: params.to ?? null,
    kpi: {
      total: all.total,
      decided: all.decided,
      won: all.won,
      lost: all.lost,
      dropped: all.dropped,
      pending: all.pending,
      winRate: all.winRate,
      quotedAmount: all.quotedAmount,
      wonAmount: all.wonAmount,
      amountWinRate: all.amountWinRate,
      avgDecideDays: decideDays.length ? Math.round((decideDays.reduce((a, d) => a + d, 0) / decideDays.length) * 10) / 10 : null,
    },
    bySubtype,
    bySituation,
    byAmountBand,
    suggestions,
  };
}
