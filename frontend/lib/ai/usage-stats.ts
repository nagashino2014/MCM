/**
 * AI 사용량 집계(ai_usage_log) — /admin/ai-usage 화면의 데이터 소스(블루프린트 §5, P1).
 * 날짜는 전부 KST 기준(called_at 은 timestamptz). 비용은 호출 시점 단가로 저장된 cost_usd 를 쓰고,
 * 입력비/출력비 분해(§3.7)는 현재 단가 뷰(ai_model_prices_current)로 다시 계산한다.
 */
import { getDb, rowsToObjects } from "@/lib/db";
import { AI_FEATURES, isAiFeatureKey } from "./features";

const KST_OFFSET_MS = 9 * 3600 * 1000;

/** KST 오늘(YYYY-MM-DD). */
export function kstToday(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function monthBounds(ymd: string): { from: string; to: string; days: number } {
  const [y, m] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}`, days: last };
}

export function isYmd(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** [from, to] (KST 날짜, 양끝 포함) → SQL 조건. 파라미터 2개를 values 에 밀어 넣고 조건문을 돌려준다. */
function rangeCond(alias: string, values: unknown[], from: string, to: string): string {
  values.push(from, to);
  const a = values.length - 1;
  const b = values.length;
  return `${alias}.called_at >= ($${a}::date::timestamp AT TIME ZONE 'Asia/Seoul')
      AND ${alias}.called_at < (($${b}::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul')`;
}

const COST_IN_EXPR = `(l.input_tokens * p.input_per_mtok + l.cache_creation_input_tokens * p.cache_write_per_mtok + l.cache_read_input_tokens * p.cache_read_per_mtok) / 1000000.0`;
const COST_OUT_EXPR = `(l.output_tokens * p.output_per_mtok) / 1000000.0`;

const num = (v: unknown): number => (v == null ? 0 : Number(v)) || 0;
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

// ── KPI ────────────────────────────────────────────────────────────────

export interface AiUsageKpis {
  asOf: string;
  month: { ym: string; cost: number; calls: number; days: number; elapsedDays: number };
  today: { cost: number; calls: number };
  window: { from: string; to: string; days: number; cost: number; dailyAvg: number };
  forecast: { byPace: number; blended: number };
  last30: { calls: number; cost: number; avgCostPerCall: number | null; failRate: number | null };
  budget: { limitUsd: number | null; action: string | null; pctOfLimit: number | null };
}

async function sumRange(from: string, to: string): Promise<{ cost: number; calls: number; failed: number }> {
  const db = await getDb();
  const values: unknown[] = [];
  const rows = rowsToObjects(
    await db.exec(
      `SELECT coalesce(sum(cost_usd), 0) AS cost, count(*) AS calls,
              count(*) FILTER (WHERE status IN ('error','timeout')) AS failed
         FROM ai_usage_log l
        WHERE ${rangeCond("l", values, from, to)}`,
      values
    )
  );
  const r = rows[0] ?? {};
  return { cost: num(r.cost), calls: num(r.calls), failed: num(r.failed) };
}

export async function getKpis(asOf: string, windowDays = 7): Promise<AiUsageKpis> {
  const today = kstToday();
  const mb = monthBounds(asOf);
  const half = Math.floor(windowDays / 2);
  const wFrom = addDays(asOf, -half);
  const wToRaw = addDays(asOf, half);
  const wTo = wToRaw > today ? today : wToRaw;
  const wDays = Math.max(1, Math.round((Date.parse(wTo) - Date.parse(wFrom)) / 86400000) + 1);
  const elapsedDays = Math.max(1, Math.round((Date.parse(asOf > today ? today : asOf) - Date.parse(mb.from)) / 86400000) + 1);

  const [month, day, win, last30] = await Promise.all([
    sumRange(mb.from, mb.to),
    sumRange(asOf, asOf),
    sumRange(wFrom, wTo),
    sumRange(addDays(asOf, -29), asOf),
  ]);
  const dailyAvg = win.cost / wDays;
  const remaining = Math.max(0, mb.days - elapsedDays);

  let budget: AiUsageKpis["budget"] = { limitUsd: null, action: null, pctOfLimit: null };
  try {
    const db = await getDb();
    const b = rowsToObjects(
      await db.exec("SELECT monthly_limit_usd, action FROM ai_budgets WHERE scope = 'org' AND enabled = 1 ORDER BY budget_id LIMIT 1")
    )[0];
    if (b) {
      const limit = num(b.monthly_limit_usd);
      budget = { limitUsd: limit, action: String(b.action ?? "notify"), pctOfLimit: limit > 0 ? (month.cost / limit) * 100 : null };
    }
  } catch {
    // 217 미적용 — 예산 없음으로 표시
  }

  return {
    asOf,
    month: { ym: asOf.slice(0, 7), cost: month.cost, calls: month.calls, days: mb.days, elapsedDays },
    today: { cost: day.cost, calls: day.calls },
    window: { from: wFrom, to: wTo, days: wDays, cost: win.cost, dailyAvg },
    forecast: { byPace: dailyAvg * mb.days, blended: month.cost + dailyAvg * remaining },
    last30: {
      calls: last30.calls,
      cost: last30.cost,
      avgCostPerCall: last30.calls ? last30.cost / last30.calls : null,
      failRate: last30.calls ? (last30.failed / last30.calls) * 100 : null,
    },
    budget,
  };
}

// ── 기능별 / 모델별 ─────────────────────────────────────────────────────

export interface FeatureStat {
  featureKey: string;
  label: string;
  group: string;
  critical: boolean;
  defaultModel: string;
  vision: boolean;
  registered: boolean;
  topModel: string | null;
  calls: number;
  okCalls: number;
  truncatedCalls: number;
  failedCalls: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgCacheReadTokens: number;
  avgLatencyMs: number | null;
  cost: number;
  costIn: number | null;
  costOut: number | null;
  avgCost: number | null;
  maxCost: number | null;
  lastCalledAt: string | null;
  spark: number[]; // 최근 7일 일별 비용(오래된 날 → 최근)
}

export async function getFeatureStats(from: string, to: string, sparkTo: string): Promise<FeatureStat[]> {
  const db = await getDb();
  const values: unknown[] = [];
  const rows = rowsToObjects(
    await db.exec(
      `SELECT l.feature_key,
              count(*) AS calls,
              count(*) FILTER (WHERE l.status = 'ok') AS ok_calls,
              count(*) FILTER (WHERE l.status = 'truncated') AS truncated_calls,
              count(*) FILTER (WHERE l.status IN ('error','timeout')) AS failed_calls,
              avg(l.input_tokens) AS avg_in, avg(l.output_tokens) AS avg_out, avg(l.cache_read_input_tokens) AS avg_cr,
              avg(l.latency_ms) AS avg_latency,
              sum(l.cost_usd) AS cost, max(l.cost_usd) AS max_cost,
              sum(${COST_IN_EXPR}) AS cost_in, sum(${COST_OUT_EXPR}) AS cost_out,
              max(l.called_at) AS last_called,
              mode() WITHIN GROUP (ORDER BY l.model_family) AS top_model
         FROM ai_usage_log l
         LEFT JOIN ai_model_prices_current p ON p.model_family = l.model_family
        WHERE ${rangeCond("l", values, from, to)}
        GROUP BY l.feature_key`,
      values
    )
  );

  const sparkValues: unknown[] = [];
  const sparkFrom = addDays(sparkTo, -6);
  const sparkRows = rowsToObjects(
    await db.exec(
      `SELECT l.feature_key, (l.called_at AT TIME ZONE 'Asia/Seoul')::date::text AS day, sum(l.cost_usd) AS cost
         FROM ai_usage_log l
        WHERE ${rangeCond("l", sparkValues, sparkFrom, sparkTo)}
        GROUP BY 1, 2`,
      sparkValues
    )
  );
  const sparkDays = Array.from({ length: 7 }, (_, i) => addDays(sparkFrom, i));
  const sparkMap = new Map<string, number[]>();
  for (const r of sparkRows) {
    const k = String(r.feature_key);
    const arr = sparkMap.get(k) ?? new Array(7).fill(0);
    const idx = sparkDays.indexOf(String(r.day));
    if (idx >= 0) arr[idx] = num(r.cost);
    sparkMap.set(k, arr);
  }

  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of rows) byKey.set(String(r.feature_key), r);
  const keys = new Set<string>([...Object.keys(AI_FEATURES), ...byKey.keys()]);

  const out: FeatureStat[] = [];
  for (const key of keys) {
    const def = isAiFeatureKey(key) ? AI_FEATURES[key] : null;
    const r = byKey.get(key);
    const calls = num(r?.calls);
    out.push({
      featureKey: key,
      label: def?.label ?? key,
      group: def?.group ?? "기타",
      critical: def?.critical ?? false,
      defaultModel: def?.defaultModel ?? "",
      vision: def?.vision ?? false,
      registered: !!def,
      topModel: r?.top_model != null ? String(r.top_model) : null,
      calls,
      okCalls: num(r?.ok_calls),
      truncatedCalls: num(r?.truncated_calls),
      failedCalls: num(r?.failed_calls),
      avgInputTokens: num(r?.avg_in),
      avgOutputTokens: num(r?.avg_out),
      avgCacheReadTokens: num(r?.avg_cr),
      avgLatencyMs: numOrNull(r?.avg_latency),
      cost: num(r?.cost),
      costIn: numOrNull(r?.cost_in),
      costOut: numOrNull(r?.cost_out),
      avgCost: calls ? num(r?.cost) / calls : null,
      maxCost: numOrNull(r?.max_cost),
      lastCalledAt: r?.last_called != null ? new Date(String(r.last_called)).toISOString() : null,
      spark: sparkMap.get(key) ?? new Array(7).fill(0),
    });
  }
  out.sort((a, b) => b.cost - a.cost || a.label.localeCompare(b.label, "ko"));
  return out;
}

export interface ModelStat {
  modelFamily: string;
  calls: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  cacheHitRate: number | null;
  cost: number;
  costIn: number | null;
  costOut: number | null;
  avgCost: number | null;
  avgCostIn: number | null;
  avgCostOut: number | null;
  maxCost: number | null;
}

export async function getModelStats(from: string, to: string): Promise<ModelStat[]> {
  const db = await getDb();
  const values: unknown[] = [];
  const rows = rowsToObjects(
    await db.exec(
      `SELECT l.model_family,
              count(*) AS calls,
              avg(l.input_tokens) AS avg_in, avg(l.output_tokens) AS avg_out,
              sum(l.input_tokens) AS sum_in, sum(l.cache_read_input_tokens) AS sum_cr, sum(l.cache_creation_input_tokens) AS sum_cc,
              sum(l.cost_usd) AS cost, max(l.cost_usd) AS max_cost,
              sum(${COST_IN_EXPR}) AS cost_in, sum(${COST_OUT_EXPR}) AS cost_out
         FROM ai_usage_log l
         LEFT JOIN ai_model_prices_current p ON p.model_family = l.model_family
        WHERE ${rangeCond("l", values, from, to)}
        GROUP BY l.model_family
        ORDER BY cost DESC NULLS LAST`,
      values
    )
  );
  return rows.map((r) => {
    const calls = num(r.calls);
    const denom = num(r.sum_in) + num(r.sum_cr) + num(r.sum_cc);
    const costIn = numOrNull(r.cost_in);
    const costOut = numOrNull(r.cost_out);
    return {
      modelFamily: String(r.model_family),
      calls,
      avgInputTokens: num(r.avg_in),
      avgOutputTokens: num(r.avg_out),
      cacheHitRate: denom > 0 ? (num(r.sum_cr) / denom) * 100 : null,
      cost: num(r.cost),
      costIn,
      costOut,
      avgCost: calls ? num(r.cost) / calls : null,
      avgCostIn: calls && costIn != null ? costIn / calls : null,
      avgCostOut: calls && costOut != null ? costOut / calls : null,
      maxCost: numOrNull(r.max_cost),
    };
  });
}

// ── 시계열 ──────────────────────────────────────────────────────────────

export interface DailyPoint {
  day: string;
  calls: number;
  cost: number;
  byGroup: Record<string, number>;
}

export async function getDailySeries(from: string, to: string): Promise<DailyPoint[]> {
  const db = await getDb();
  const values: unknown[] = [];
  const rows = rowsToObjects(
    await db.exec(
      `SELECT (l.called_at AT TIME ZONE 'Asia/Seoul')::date::text AS day, l.feature_key, count(*) AS calls, sum(l.cost_usd) AS cost
         FROM ai_usage_log l
        WHERE ${rangeCond("l", values, from, to)}
        GROUP BY 1, 2`,
      values
    )
  );
  const days = new Map<string, DailyPoint>();
  const total = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  for (let i = 0; i < total; i++) {
    const d = addDays(from, i);
    days.set(d, { day: d, calls: 0, cost: 0, byGroup: {} });
  }
  for (const r of rows) {
    const p = days.get(String(r.day));
    if (!p) continue;
    const key = String(r.feature_key);
    const group = isAiFeatureKey(key) ? AI_FEATURES[key].group : "기타";
    p.calls += num(r.calls);
    p.cost += num(r.cost);
    p.byGroup[group] = (p.byGroup[group] ?? 0) + num(r.cost);
  }
  return [...days.values()];
}

export interface MonthlyPoint {
  ym: string;
  calls: number;
  cost: number;
}

export async function getMonthlySeries(asOf: string, months = 12): Promise<MonthlyPoint[]> {
  const db = await getDb();
  const [y, m] = asOf.split("-").map(Number); // m 은 1-based, Date.UTC 월은 0-based
  const start = new Date(Date.UTC(y, m - 1 - months + 1, 1)); // asOf 월 포함 직전 (months-1)개월
  const from = start.toISOString().slice(0, 10);
  const to = monthBounds(asOf).to;
  const values: unknown[] = [];
  const rows = rowsToObjects(
    await db.exec(
      `SELECT to_char(l.called_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS ym, count(*) AS calls, sum(l.cost_usd) AS cost
         FROM ai_usage_log l
        WHERE ${rangeCond("l", values, from, to)}
        GROUP BY 1`,
      values
    )
  );
  const map = new Map(rows.map((r) => [String(r.ym), { calls: num(r.calls), cost: num(r.cost) }]));
  const out: MonthlyPoint[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(y, m - 1 - months + 1 + i, 1));
    const ym = d.toISOString().slice(0, 7);
    const v = map.get(ym);
    out.push({ ym, calls: v?.calls ?? 0, cost: v?.cost ?? 0 });
  }
  return out;
}

// ── 호출 이력(드릴다운) ──────────────────────────────────────────────────

export interface UsageLogRow {
  logId: number;
  calledAt: string;
  featureKey: string;
  model: string;
  modelFamily: string;
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  latencyMs: number | null;
  status: string;
  httpStatus: number | null;
  stopReason: string | null;
  requestId: string | null;
  userId: string | null;
  userName: string | null;
  subjectType: string | null;
  subjectId: string | null;
  env: string | null;
  meta: unknown;
}

export interface UsageLogFilter {
  from: string;
  to: string;
  feature?: string | null;
  status?: string | null;
  model?: string | null;
  userId?: string | null;
}

export async function listUsageLogs(
  filter: UsageLogFilter,
  page: number,
  pageSize: number
): Promise<{ total: number; rows: UsageLogRow[] }> {
  const db = await getDb();
  const values: unknown[] = [];
  const conds: string[] = [rangeCond("l", values, filter.from, filter.to)];
  if (filter.feature) {
    values.push(filter.feature);
    conds.push(`l.feature_key = $${values.length}`);
  }
  if (filter.status) {
    values.push(filter.status);
    conds.push(`l.status = $${values.length}`);
  }
  if (filter.model) {
    values.push(filter.model);
    conds.push(`l.model_family = $${values.length}`);
  }
  if (filter.userId) {
    values.push(filter.userId);
    conds.push(`l.user_id = $${values.length}`);
  }
  values.push(pageSize, (page - 1) * pageSize);
  const rows = rowsToObjects(
    await db.exec(
      `SELECT l.*, COALESCE(e.name, u.email) AS user_name, count(*) OVER() AS total_count
         FROM ai_usage_log l
         LEFT JOIN users u ON u.user_id = l.user_id
         LEFT JOIN employee_profiles e ON e.user_id = l.user_id
        WHERE ${conds.join(" AND ")}
        ORDER BY l.called_at DESC, l.log_id DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    )
  );
  const total = rows.length ? num(rows[0].total_count) : 0;
  return {
    total,
    rows: rows.map((r) => ({
      logId: num(r.log_id),
      calledAt: new Date(String(r.called_at)).toISOString(),
      featureKey: String(r.feature_key),
      model: String(r.model),
      modelFamily: String(r.model_family),
      inputTokens: num(r.input_tokens),
      cacheCreationInputTokens: num(r.cache_creation_input_tokens),
      cacheReadInputTokens: num(r.cache_read_input_tokens),
      outputTokens: num(r.output_tokens),
      costUsd: numOrNull(r.cost_usd),
      latencyMs: numOrNull(r.latency_ms),
      status: String(r.status),
      httpStatus: numOrNull(r.http_status),
      stopReason: r.stop_reason != null ? String(r.stop_reason) : null,
      requestId: r.request_id != null ? String(r.request_id) : null,
      userId: r.user_id != null ? String(r.user_id) : null,
      userName: r.user_name != null ? String(r.user_name) : null,
      subjectType: r.subject_type != null ? String(r.subject_type) : null,
      subjectId: r.subject_id != null ? String(r.subject_id) : null,
      env: r.env != null ? String(r.env) : null,
      meta: r.meta ?? null,
    })),
  };
}
