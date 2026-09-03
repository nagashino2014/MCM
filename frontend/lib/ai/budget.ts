/**
 * AI API 예산·경고(블루프린트 §3.5·§6, P2).
 * - ai_budgets: scope(org | feature:<key> | model:<family>) 별 월 한도·임계·초과 정책·수신자.
 * - 평가 시점: ① 게이트웨이가 로그를 남긴 뒤(5분 스로틀) ② 일 1회 틱(예측 초과 포함).
 * - 발송 dedup 은 ai_budget_alerts 의 유니크 인덱스(218)로 보장 — INSERT 가 성공한 경우에만 발송한다.
 * - 채널: 홈 알림벨(alerts) + 모바일 푸시(ai.budget) + 메일(SES). 수신자가 비면 시스템 관리자 템플릿 배정자.
 * - 예산 가드(budgetGate): 정책이 block_* 이고 당월 누계가 한도를 넘으면 호출 전에 차단(60초 캐시).
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { sendPush } from "@/lib/notify/push-expo";
import { sendNotifyEmail } from "@/lib/notify/email-ses";
import { AI_FEATURES, isAiFeatureKey, type AiFeatureKey } from "./features";
import { loadAiSettings } from "./settings";
import { getKpis, kstToday, monthBounds, sumScopeCost } from "./usage-stats";

export type BudgetAction = "notify" | "block_noncritical" | "block_all";
export type BudgetScope = "org" | `feature:${string}` | `model:${string}`;

export interface AiBudget {
  budgetId: string;
  scope: string;
  label: string;
  monthlyLimitUsd: number;
  warnPcts: number[];
  action: BudgetAction;
  recipients: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiBudgetStatus extends AiBudget {
  ym: string;
  monthCost: number;
  pctOfLimit: number | null;
  /** 지금 속도면 며칠 뒤 한도 도달(이미 초과면 0, 계산 불가면 null). org 만. */
  daysToExceed: number | null;
  forecastBlended: number | null;
  blockedNow: boolean;
}

export interface AiBudgetAlertRow {
  alertId: number;
  budgetId: string;
  budgetLabel: string;
  ym: string;
  kind: string;
  pct: number;
  day: string | null;
  amountUsd: number | null;
  channels: string | null;
  message: string | null;
  sentAt: string;
}

const num = (v: unknown): number => (v == null ? 0 : Number(v)) || 0;

function toBudget(r: Record<string, unknown>): AiBudget {
  const pcts = Array.isArray(r.warn_pcts) ? (r.warn_pcts as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0) : [50, 80, 100];
  const action = String(r.action ?? "notify");
  return {
    budgetId: String(r.budget_id),
    scope: String(r.scope),
    label: r.label != null && String(r.label).trim() ? String(r.label) : scopeLabel(String(r.scope)),
    monthlyLimitUsd: num(r.monthly_limit_usd),
    warnPcts: [...new Set(pcts)].sort((a, b) => a - b),
    action: action === "block_all" || action === "block_noncritical" ? action : "notify",
    recipients: Array.isArray(r.recipients) ? (r.recipients as unknown[]).map(String).filter(Boolean) : [],
    enabled: Number(r.enabled ?? 1) === 1,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

export function scopeLabel(scope: string): string {
  if (scope === "org") return "전체";
  if (scope.startsWith("feature:")) {
    const k = scope.slice(8);
    return isAiFeatureKey(k) ? AI_FEATURES[k].label : k;
  }
  if (scope.startsWith("model:")) return scope.slice(6);
  return scope;
}

export function isValidScope(scope: string): scope is BudgetScope {
  if (scope === "org") return true;
  if (scope.startsWith("feature:")) return isAiFeatureKey(scope.slice(8));
  if (scope.startsWith("model:")) return /^claude-[a-z0-9-]+$/.test(scope.slice(6));
  return false;
}

// ── CRUD ────────────────────────────────────────────────────────────────

export async function listBudgets(): Promise<AiBudget[]> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec("SELECT * FROM ai_budgets ORDER BY (scope = 'org') DESC, scope"));
  return rows.map(toBudget);
}

export interface BudgetInput {
  budgetId?: string | null;
  scope: string;
  label?: string | null;
  monthlyLimitUsd: number;
  warnPcts: number[];
  action: BudgetAction;
  recipients: string[];
  enabled: boolean;
}

export async function upsertBudget(input: BudgetInput): Promise<AiBudget> {
  const now = new Date().toISOString();
  const id = input.budgetId?.trim() || (input.scope === "org" ? "budget-org" : `budget-${Date.now().toString(36)}`);
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO ai_budgets (budget_id, scope, label, monthly_limit_usd, warn_pcts, action, recipients, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::integer[], $6, $7::text[], $8, $9, $9)
       ON CONFLICT (budget_id) DO UPDATE SET
         scope = EXCLUDED.scope, label = EXCLUDED.label, monthly_limit_usd = EXCLUDED.monthly_limit_usd,
         warn_pcts = EXCLUDED.warn_pcts, action = EXCLUDED.action, recipients = EXCLUDED.recipients,
         enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
      [
        id,
        input.scope,
        input.label?.trim() || null,
        input.monthlyLimitUsd,
        input.warnPcts,
        input.action,
        input.recipients,
        input.enabled ? 1 : 0,
        now,
      ]
    );
  });
  invalidateBudgetCache();
  const db = await getDb();
  return toBudget(rowsToObjects(await db.exec("SELECT * FROM ai_budgets WHERE budget_id = $1", [id]))[0]);
}

export async function deleteBudget(budgetId: string): Promise<void> {
  if (budgetId === "budget-org") throw new Error("전체 예산은 삭제할 수 없습니다. 비활성화하세요.");
  const db = await getDb();
  await db.run("DELETE FROM ai_budgets WHERE budget_id = $1", [budgetId]);
  invalidateBudgetCache();
}

export async function listBudgetAlerts(limit = 50): Promise<AiBudgetAlertRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT a.*, b.label AS budget_label, b.scope AS budget_scope
         FROM ai_budget_alerts a LEFT JOIN ai_budgets b ON b.budget_id = a.budget_id
        ORDER BY a.sent_at DESC LIMIT $1`,
      [limit]
    )
  );
  return rows.map((r) => ({
    alertId: num(r.alert_id),
    budgetId: String(r.budget_id),
    budgetLabel: r.budget_label != null && String(r.budget_label).trim() ? String(r.budget_label) : scopeLabel(String(r.budget_scope ?? r.budget_id)),
    ym: String(r.ym),
    kind: String(r.kind ?? "threshold"),
    pct: num(r.pct),
    day: r.day != null ? String(r.day) : null,
    amountUsd: r.amount_usd != null ? Number(r.amount_usd) : null,
    channels: r.channels != null ? String(r.channels) : null,
    message: r.message != null ? String(r.message) : null,
    sentAt: new Date(String(r.sent_at)).toISOString(),
  }));
}

// ── 상태(화면용) ─────────────────────────────────────────────────────────

export async function listBudgetStatuses(asOf = kstToday()): Promise<AiBudgetStatus[]> {
  const budgets = await listBudgets();
  const mb = monthBounds(asOf);
  const ym = asOf.slice(0, 7);
  const settings = await loadAiSettings();
  const kpis = await getKpis(asOf, settings.forecastWindowDays);
  const out: AiBudgetStatus[] = [];
  for (const b of budgets) {
    const monthCost = b.scope === "org" ? kpis.month.cost : await sumScopeCost(b.scope, mb.from, mb.to);
    const pct = b.monthlyLimitUsd > 0 ? (monthCost / b.monthlyLimitUsd) * 100 : null;
    let daysToExceed: number | null = null;
    let forecastBlended: number | null = null;
    if (b.scope === "org") {
      forecastBlended = kpis.forecast.blended;
      if (monthCost >= b.monthlyLimitUsd) daysToExceed = 0;
      else if (kpis.window.dailyAvg > 0) daysToExceed = Math.ceil((b.monthlyLimitUsd - monthCost) / kpis.window.dailyAvg);
    }
    out.push({
      ...b,
      ym,
      monthCost,
      pctOfLimit: pct,
      daysToExceed,
      forecastBlended,
      blockedNow: b.enabled && b.action !== "notify" && b.monthlyLimitUsd > 0 && monthCost >= b.monthlyLimitUsd,
    });
  }
  return out;
}

// ── 수신자·채널 ──────────────────────────────────────────────────────────

async function resolveRecipients(recipients: string[]): Promise<string[]> {
  if (recipients.length) return recipients;
  const db = await getDb();
  const today = kstToday();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT a.user_id FROM user_permission_assignments a
        WHERE a.template_id = 'tpl-system-admin' AND a.revoked_at IS NULL
          AND (a.effective_from IS NULL OR a.effective_from <= $1)
          AND (a.effective_to IS NULL OR a.effective_to >= $1)`,
      [today]
    )
  );
  return rows.map((r) => String(r.user_id));
}

async function emailsOf(userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT email FROM users WHERE user_id = ANY($1::text[]) AND email IS NOT NULL AND email <> ''", [userIds])
  );
  return rows.map((r) => String(r.email));
}

async function dispatch(input: {
  recipients: string[];
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  payload: Record<string, unknown>;
}): Promise<string> {
  const channels: string[] = [];
  const now = new Date().toISOString();
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO alerts (severity, source, code, title, body, payload_json, created_at) VALUES ($1, 'ai', 'ai-budget', $2, $3, $4::jsonb, $5)`,
      [input.severity, input.title, input.body, JSON.stringify(input.payload), now]
    );
    channels.push("bell");
  } catch (e) {
    console.warn(`[ai-budget] alerts 적재 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  const users = await resolveRecipients(input.recipients);
  if (users.length) {
    try {
      const r = await sendPush(users, { event: "ai.budget", title: input.title, body: input.body, link: "/admin/ai-usage", targetRef: String(input.payload.budgetId ?? "") });
      if (r.ok) channels.push("push");
    } catch (e) {
      console.warn(`[ai-budget] push 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const to = await emailsOf(users);
      if (to.length) {
        const r = await sendNotifyEmail({ to, subject: `[MCM] ${input.title}`, text: `${input.body}\n\n관리 화면: /admin/ai-usage` });
        if (r.ok) channels.push("email");
      }
    } catch (e) {
      console.warn(`[ai-budget] email 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return channels.join(",");
}

/** 유니크 인덱스로 dedup — 새로 삽입됐을 때만 true. */
async function claimAlert(input: {
  budgetId: string;
  ym: string;
  kind: "threshold" | "forecast" | "single_call";
  pct: number;
  day: string | null;
  amountUsd: number | null;
  message: string;
}): Promise<number | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `INSERT INTO ai_budget_alerts (budget_id, ym, kind, pct, day, amount_usd, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING
       RETURNING alert_id`,
      [input.budgetId, input.ym, input.kind, input.pct, input.day, input.amountUsd, input.message]
    )
  );
  return rows.length ? num(rows[0].alert_id) : null;
}

async function markChannels(alertId: number, channels: string): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE ai_budget_alerts SET channels = $2 WHERE alert_id = $1", [alertId, channels]);
}

const fmt = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`;

// ── 평가 ────────────────────────────────────────────────────────────────

/**
 * 예산 전부 평가. trigger=call 은 임계만, daily 는 예측 초과까지.
 * 반환: 발송한 알림 수.
 */
export async function evaluateBudgets(opts: { trigger: "call" | "daily"; asOf?: string }): Promise<number> {
  const asOf = opts.asOf ?? kstToday();
  const ym = asOf.slice(0, 7);
  const mb = monthBounds(asOf);
  let budgets: AiBudget[];
  try {
    budgets = (await listBudgets()).filter((b) => b.enabled && b.monthlyLimitUsd > 0);
  } catch {
    return 0; // 217 미적용
  }
  if (!budgets.length) return 0;

  let sent = 0;
  let kpis: Awaited<ReturnType<typeof getKpis>> | null = null;
  for (const b of budgets) {
    const monthCost = await sumScopeCost(b.scope, mb.from, mb.to);
    const pct = (monthCost / b.monthlyLimitUsd) * 100;
    // 임계 통과 — 낮은 임계부터, 이미 발송된 건은 INSERT 충돌로 건너뛴다.
    for (const p of b.warnPcts) {
      if (pct < p) continue;
      const msg = `AI API ${b.label} 예산 ${p}% 도달 — ${ym} 누계 ${fmt(monthCost)} / 한도 ${fmt(b.monthlyLimitUsd)}${
        p >= 100 ? (b.action === "notify" ? " (정책: 경고만, 호출은 계속됩니다)" : b.action === "block_all" ? " (정책: 전체 차단 중)" : " (정책: 비필수 기능 차단 중)") : ""
      }`;
      const id = await claimAlert({ budgetId: b.budgetId, ym, kind: "threshold", pct: p, day: null, amountUsd: monthCost, message: msg });
      if (id == null) continue;
      const channels = await dispatch({
        recipients: b.recipients,
        severity: p >= 100 ? "critical" : p >= 80 ? "warning" : "info",
        title: `AI API 예산 ${p}% 도달 (${b.label})`,
        body: msg,
        payload: { budgetId: b.budgetId, scope: b.scope, ym, pct: p, monthCost, limit: b.monthlyLimitUsd },
      });
      await markChannels(id, channels);
      sent++;
    }
    // 예측 초과(일 1회, org 만 — 예측은 전체 창 기준)
    if (opts.trigger === "daily" && b.scope === "org" && pct < 100) {
      kpis ??= await getKpis(asOf, (await loadAiSettings()).forecastWindowDays);
      const remaining = kpis.month.days - kpis.month.elapsedDays;
      if (kpis.forecast.blended >= b.monthlyLimitUsd && remaining >= 3) {
        const msg = `AI API ${b.label} 월 예상 비용 ${fmt(kpis.forecast.blended)} 이(가) 한도 ${fmt(b.monthlyLimitUsd)} 을(를) 넘을 전망입니다 — 최근 ${kpis.window.days}일 일평균 ${fmt(kpis.window.dailyAvg)}, 누계 ${fmt(monthCost)}`;
        const id = await claimAlert({ budgetId: b.budgetId, ym, kind: "forecast", pct: 0, day: asOf, amountUsd: kpis.forecast.blended, message: msg });
        if (id != null) {
          const channels = await dispatch({
            recipients: b.recipients,
            severity: "warning",
            title: `AI API 월 예상 비용 한도 초과 전망 (${b.label})`,
            body: msg,
            payload: { budgetId: b.budgetId, scope: b.scope, ym, forecast: kpis.forecast.blended, limit: b.monthlyLimitUsd },
          });
          await markChannels(id, channels);
          sent++;
        }
      }
    }
  }
  return sent;
}

/** 단건 고비용(설정 single_call_alert_usd, 기본 $1) — 게이트웨이가 로그 적재 직후 호출. */
export async function checkSingleCallAlert(input: { logId: number | null; feature: AiFeatureKey; modelFamily: string; costUsd: number }): Promise<void> {
  const settings = await loadAiSettings();
  const threshold = settings.singleCallAlertUsd;
  if (threshold == null || threshold <= 0 || input.costUsd < threshold) return;
  const today = kstToday();
  const msg = `AI API 단건 고비용 — ${AI_FEATURES[input.feature]?.label ?? input.feature} (${input.modelFamily}) 호출 1건 ${fmt(input.costUsd)} (임계 ${fmt(threshold)})`;
  const id = await claimAlert({ budgetId: "budget-org", ym: today.slice(0, 7), kind: "single_call", pct: 0, day: input.logId != null ? `log:${input.logId}` : `${Date.now()}`, amountUsd: input.costUsd, message: msg });
  if (id == null) return;
  const channels = await dispatch({
    recipients: [],
    severity: "warning",
    title: "AI API 단건 고비용 호출",
    body: msg,
    payload: { budgetId: "budget-org", feature: input.feature, model: input.modelFamily, costUsd: input.costUsd, logId: input.logId },
  });
  await markChannels(id, channels);
}

// ── 게이트웨이 훅 ────────────────────────────────────────────────────────

const GATE_TTL_MS = 60 * 1000;
const AFTER_CALL_THROTTLE_MS = 5 * 60 * 1000;
let gateCache: { at: number; blockAll: boolean; blockNoncritical: boolean; blockedFeatures: Set<string>; blockedModels: Set<string> } | null = null;
let lastAfterCallEval = 0;

export function invalidateBudgetCache(): void {
  gateCache = null;
}

async function loadGate(): Promise<NonNullable<typeof gateCache>> {
  const now = Date.now();
  if (gateCache && now - gateCache.at < GATE_TTL_MS) return gateCache;
  const state = { at: now, blockAll: false, blockNoncritical: false, blockedFeatures: new Set<string>(), blockedModels: new Set<string>() };
  try {
    const budgets = (await listBudgets()).filter((b) => b.enabled && b.action !== "notify" && b.monthlyLimitUsd > 0);
    if (budgets.length) {
      const mb = monthBounds(kstToday());
      for (const b of budgets) {
        const cost = await sumScopeCost(b.scope, mb.from, mb.to);
        if (cost < b.monthlyLimitUsd) continue;
        if (b.scope === "org") {
          if (b.action === "block_all") state.blockAll = true;
          else state.blockNoncritical = true;
        } else if (b.scope.startsWith("feature:")) state.blockedFeatures.add(b.scope.slice(8));
        else if (b.scope.startsWith("model:")) state.blockedModels.add(b.scope.slice(6));
      }
    }
  } catch {
    // 예산 테이블 없음/조회 실패 → 차단하지 않는다(호출 경로 보호)
  }
  gateCache = state;
  return state;
}

/** 호출 전 예산 가드. 차단이면 사유를 돌려준다(게이트웨이가 로그 후 throw). */
export async function budgetGate(feature: AiFeatureKey, modelFamily: string): Promise<{ blocked: boolean; reason: string | null }> {
  const g = await loadGate();
  if (g.blockAll) return { blocked: true, reason: "월 예산 초과 — 전체 차단 정책" };
  const critical = AI_FEATURES[feature]?.critical ?? false;
  if (g.blockNoncritical && !critical) return { blocked: true, reason: "월 예산 초과 — 비필수 기능 차단 정책" };
  if (g.blockedFeatures.has(feature)) return { blocked: true, reason: "기능 예산 초과 — 차단 정책" };
  if (g.blockedModels.has(modelFamily)) return { blocked: true, reason: "모델 예산 초과 — 차단 정책" };
  return { blocked: false, reason: null };
}

/** 로그 적재 직후 호출(fire-and-forget). 임계 평가는 5분에 1회, 단건 고비용은 매번. */
export async function afterCallBudgetCheck(input: { logId: number | null; feature: AiFeatureKey; modelFamily: string; costUsd: number | null }): Promise<void> {
  try {
    if (input.costUsd != null) await checkSingleCallAlert({ logId: input.logId, feature: input.feature, modelFamily: input.modelFamily, costUsd: input.costUsd });
    const now = Date.now();
    if (now - lastAfterCallEval < AFTER_CALL_THROTTLE_MS) return;
    lastAfterCallEval = now;
    const sent = await evaluateBudgets({ trigger: "call" });
    if (sent) invalidateBudgetCache();
  } catch (e) {
    console.warn(`[ai-budget] 호출 후 평가 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
}
