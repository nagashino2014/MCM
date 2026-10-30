/**
 * 외부 연동 상태 감시(쉐도우 모니터링) — 대상별 신선도 판정 → integration_health 저장 → 이상·복구 알림.
 * docs/integration-watchdog-blueprint.md, 마이그레이션 316. 판정·전이 규칙은 integration-watch-core.ts(순수).
 *
 * 알림 채널: alerts(운영 알람 벨) + 모바일 push(ops.integration) + SES 메일(no-reply) → 시스템 관리자 전원.
 * 실행: next 서비스 틱(/api/internal/integration-watch-tick, KST 08~20시 매시 1회) + 화면의 [지금 점검].
 *
 * ⚠ ADT·intel 배치는 고정 revision 에서 돈다(CLAUDE.md). 새 심장박동 코드가 배치에 들어가기 전에도
 *   판정이 서도록, 심장박동이 없으면 기존 기록(intel_collect_state·parse-empty 경보 등)으로 대신 판정한다.
 */

import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { loadIntelSettings } from "@/lib/intel/intel-settings";
import { DEFAULT_BATCH_HOUR, listEnabledCustomCollectors } from "@/lib/scraper/sources-store";
import { sendNotifyEmail } from "@/lib/notify/email-ses";
import { sendPush } from "@/lib/notify/push-expo";
import {
  buildWatchMessages,
  judgeDailySlot,
  judgeFreshness,
  judgeWorkdayActivity,
  kstParts,
  kstTextToIso,
  planWatch,
  type CheckGroup,
  type CheckResult,
  type HealthStatus,
  type PrevState,
} from "./integration-watch-core";

/** 야간 배치(03시) 기준 — 하루 + 여유 4시간 */
const DAILY_BATCH_MAX_AGE_H = 28;
/** 사내 PC 수집(토지이음 08:30, 바로빌 04:00) 기준 */
const DAILY_LOCAL_MAX_AGE_H = 30;
/** 캡스 수집기는 매시 35분 */
const HOURLY_COLLECTOR_MAX_AGE_H = 3;
/** 토지이음 심장박동이 없을 때 신규 적재로만 판정하는 기준(신규 고시는 매일 나오지 않는다) */
const EUM_DATA_MAX_AGE_H = 7 * 24;

const SCREEN_LINK = "/admin/integrations";

const INTEL_LABEL: Record<string, string> = {
  dart: "DART 공시",
  eiass: "EIASS 환경영향평가",
  press: "보도자료",
  news: "네이버 뉴스",
};

// ── 심장박동(기록은 ./heartbeat.ts — 배치 번들이 알림 모듈을 끌고 오지 않도록 분리) ──

interface Heartbeat {
  lastSeenAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
}

const ISO = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

async function loadHeartbeats(db: PgDatabase): Promise<Map<string, Heartbeat>> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT source, ${ISO("last_seen_at")} AS seen, ${ISO("last_ok_at")} AS ok, last_error FROM integration_heartbeats`
    )
  );
  return new Map(
    rows.map((r) => [
      String(r.source),
      {
        lastSeenAt: r.seen == null ? null : String(r.seen),
        lastOkAt: r.ok == null ? null : String(r.ok),
        lastError: r.last_error == null ? null : String(r.last_error),
      },
    ])
  );
}

/** 심장박동의 마지막 실행이 실패였으면 그 오류(마지막 성공 이후에 본 실패만). */
function pendingError(hb: Heartbeat | undefined): string | null {
  if (!hb?.lastError) return null;
  if (hb.lastOkAt && hb.lastSeenAt && hb.lastSeenAt <= hb.lastOkAt) return null;
  return hb.lastError;
}

function check(
  key: string,
  grp: CheckGroup,
  label: string,
  judged: { status: CheckResult["status"]; reason: string | null },
  lastOkAt: string | null,
  detail?: Record<string, unknown>
): CheckResult {
  return { key, grp, label, status: judged.status, reason: judged.reason, lastOkAt, ...(detail ? { detail } : {}) };
}

// ── 대상별 판정 ────────────────────────────────────────────────────────────

async function intelChecks(db: PgDatabase, hbs: Map<string, Heartbeat>, nowMs: number): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const settings = await loadIntelSettings(db);
  const state = new Map(
    rowsToObjects(await db.exec(`SELECT source, last_run_at FROM intel_collect_state`)).map((r) => [
      String(r.source),
      r.last_run_at == null ? null : String(r.last_run_at),
    ])
  );
  // 구 배치 코드는 0건 파싱을 오류 대신 parse-empty 경보로 남긴다 — 마지막 실행이 그 상태였는지 본다.
  const parseEmpty = new Map(
    rowsToObjects(
      await db.exec(
        `SELECT code, max(created_at) AS at FROM alerts
          WHERE source = 'intel' AND code IN ('gosi-parse-empty', 'eiass-parse-empty') GROUP BY code`
      )
    ).map((r) => [String(r.code), r.at == null ? null : String(r.at)])
  );
  const emptyOnLastRun = (code: string, lastRun: string | null): boolean => {
    const at = parseEmpty.get(code);
    if (!at || !lastRun) return false;
    return Date.parse(at) >= Date.parse(lastRun) - 15 * 60 * 1000;
  };

  const builtins: Array<{ src: "dart" | "eiass" | "press" | "news"; enabled: boolean; emptyCode?: string }> = [
    { src: "dart", enabled: settings.dart.enabled },
    { src: "eiass", enabled: settings.eiass.enabled, emptyCode: "eiass-parse-empty" },
    { src: "press", enabled: settings.press.enabled },
    { src: "news", enabled: settings.news.enabled },
  ];
  for (const { src, enabled, emptyCode } of builtins) {
    if (!enabled) continue;
    const hb = hbs.get(`intel.${src}`);
    const fallback = state.get(src) ?? null;
    const label = `야간 배치 · ${INTEL_LABEL[src]}`;
    if (!hb && emptyCode && emptyOnLastRun(emptyCode, fallback)) {
      out.push(check(`intel.${src}`, "intel", label, { status: "failing", reason: "마지막 야간 실행에서 0건 파싱(사이트 개편 의심)" }, null));
      continue;
    }
    const lastOk = hb ? hb.lastOkAt : fallback;
    out.push(check(`intel.${src}`, "intel", label, judgeFreshness(lastOk, nowMs, DAILY_BATCH_MAX_AGE_H, pendingError(hb)), lastOk));
  }

  if (settings.gosi.enabled && settings.gosi.rssEnabled) {
    const hb = hbs.get("intel.gosi_me");
    const label = "야간 배치 · 환경청 고시 RSS";
    const lastRun = state.get("gosi") ?? null;
    if (hb) {
      out.push(check("intel.gosi_me", "intel", label, judgeFreshness(hb.lastOkAt, nowMs, DAILY_BATCH_MAX_AGE_H, pendingError(hb)), hb.lastOkAt));
    } else if (emptyOnLastRun("gosi-parse-empty", lastRun)) {
      out.push(check("intel.gosi_me", "intel", label, { status: "failing", reason: "마지막 야간 실행에서 RSS 0건(접속 실패·주소 변경 의심)" }, null));
    } else {
      out.push(check("intel.gosi_me", "intel", label, judgeFreshness(lastRun, nowMs, DAILY_BATCH_MAX_AGE_H), lastRun));
    }
  }

  if (settings.gosi.enabled) {
    const hb = hbs.get("intel.gosi_eum");
    const label = "사내 PC · 토지이음 고시";
    if (hb) {
      out.push(check("intel.gosi_eum", "intel", label, judgeFreshness(hb.lastOkAt, nowMs, DAILY_LOCAL_MAX_AGE_H, pendingError(hb)), hb.lastOkAt));
    } else {
      const r = rowsToObjects(
        await db.exec(`SELECT max(created_at) AS at FROM intel_signals WHERE source = 'gosi' AND raw_json->>'channel' = 'eum'`)
      );
      const lastData = r[0]?.at == null ? null : String(r[0].at);
      const judged = judgeFreshness(lastData, nowMs, EUM_DATA_MAX_AGE_H);
      out.push(
        check("intel.gosi_eum", "intel", label, judged.status === "failing" ? { status: "failing", reason: `신규 적재 없음 — ${judged.reason}` } : judged, null)
      );
    }
  }

  // 범용 스크래퍼 intel 소스 — 야간 배치가 scraper_run_logs 에 남긴 마지막 성공·오류.
  const customs = new Map<string, { sourceId: string; slug: string; name: string }>();
  for (const { source } of await listEnabledCustomCollectors(db, "intel")) customs.set(source.sourceId, source);
  for (const s of customs.values()) {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT max(finished_at) FILTER (WHERE status = 'success') AS ok_at,
                (SELECT error FROM scraper_run_logs l2 WHERE l2.source_id = $1 AND l2.trigger = 'batch'
                  ORDER BY finished_at DESC LIMIT 1) AS last_error
           FROM scraper_run_logs WHERE source_id = $1 AND trigger = 'batch'`,
        [s.sourceId]
      )
    );
    const lastOk = rows[0]?.ok_at == null ? null : String(rows[0].ok_at);
    const lastError = rows[0]?.last_error == null ? null : String(rows[0].last_error);
    out.push(
      check(`intel.custom:${s.slug}`, "intel", `야간 배치 · ${s.name}`, judgeFreshness(lastOk, nowMs, DAILY_BATCH_MAX_AGE_H, lastError), lastOk)
    );
  }
  return out;
}

async function adtChecks(db: PgDatabase, hbs: Map<string, Heartbeat>, nowMs: number): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const hb = hbs.get("adt.collector");
  out.push(
    check(
      "adt.collector",
      "adt",
      "사내 PC · 캡스 근태 수집기",
      hb ? judgeFreshness(hb.lastOkAt, nowMs, HOURLY_COLLECTOR_MAX_AGE_H, pendingError(hb)) : { status: "unknown", reason: "수집기 심장박동 기록 없음(수집기 갱신 전)" },
      hb?.lastOkAt ?? null
    )
  );

  const { ymd, dow } = kstParts(nowMs);
  const holiday = rowsToObjects(await db.exec(`SELECT 1 FROM company_holidays WHERE holiday_date = $1::date`, [ymd])).length > 0;
  const r = rowsToObjects(await db.exec(`SELECT ${ISO("max(event_at)")} AS at FROM adt_event_raw`));
  const lastEvent = r[0]?.at == null ? null : String(r[0].at);
  out.push(
    check("adt.events", "adt", "근태 출입 태그", judgeWorkdayActivity(lastEvent, nowMs, dow >= 1 && dow <= 5 && !holiday), lastEvent)
  );
  return out;
}

async function bidChecks(db: PgDatabase, nowMs: number): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const sources = new Map<string, { sourceId: string; slug: string; name: string; batchHour: number | null; lastBatchDate: string | null }>();
  for (const { source } of await listEnabledCustomCollectors(db, "bid")) sources.set(source.sourceId, source);
  for (const s of sources.values()) {
    const judged = judgeDailySlot(s.lastBatchDate, s.batchHour ?? DEFAULT_BATCH_HOUR, nowMs);
    if (judged.status === "failing") {
      const err = rowsToObjects(
        await db.exec(
          `SELECT error FROM scraper_run_logs WHERE source_id = $1 AND status = 'error' AND trigger = 'batch'
            ORDER BY finished_at DESC LIMIT 1`,
          [s.sourceId]
        )
      );
      if (err[0]?.error) judged.reason = `${judged.reason} — 최근 오류: ${String(err[0].error).slice(0, 200)}`;
    }
    out.push(check(`bid.${s.slug}`, "bid", `공공입찰 · ${s.name}`, judged, null, { lastBatchDate: s.lastBatchDate }));
  }
  return out;
}

async function barobillChecks(db: PgDatabase, nowMs: number): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const rows = rowsToObjects(
    await db.exec(
      `SELECT kind,
              max(finished_at) FILTER (WHERE status = 'ok') AS ok_at,
              max(finished_at) FILTER (WHERE status = 'error') AS err_at,
              (SELECT error FROM finance_sync_logs l2 WHERE l2.kind = l.kind AND l2.status = 'error'
                ORDER BY finished_at DESC NULLS LAST LIMIT 1) AS last_error
         FROM finance_sync_logs l
        WHERE kind IN ('bank', 'card', 'hometax')
        GROUP BY kind`
    )
  );
  const byKind = new Map(rows.map((r) => [String(r.kind), r]));
  const errAfterOk = (r: Record<string, unknown> | undefined): string | null => {
    if (!r?.err_at) return null;
    if (r.ok_at && String(r.ok_at) >= String(r.err_at)) return null;
    return r.last_error == null ? "오류" : String(r.last_error).slice(0, 200);
  };
  // 계좌·카드: 한 번이라도 동기화한 적이 있을 때만 감시(미사용 환경 제외).
  for (const kind of ["bank", "card"] as const) {
    const r = byKind.get(kind);
    if (!r) continue;
    const lastOk = kstTextToIso(r.ok_at == null ? null : String(r.ok_at));
    out.push(
      check(`barobill.${kind}`, "barobill", kind === "bank" ? "바로빌 · 계좌 거래내역" : "바로빌 · 카드 승인내역",
        judgeFreshness(lastOk, nowMs, DAILY_LOCAL_MAX_AGE_H, errAfterOk(r)), lastOk)
    );
  }
  // 홈택스 세금계산서는 수동 경로라 마지막 실행의 오류만 본다.
  const ht = byKind.get("hometax");
  if (ht) {
    const err = errAfterOk(ht);
    const lastOk = kstTextToIso(ht.ok_at == null ? null : String(ht.ok_at));
    out.push(
      check("barobill.hometax", "barobill", "바로빌 · 홈택스 세금계산서",
        err ? { status: "failing", reason: `마지막 수집 실패 — ${err}` } : { status: "ok", reason: null }, lastOk)
    );
  }
  return out;
}

/** 전 대상 판정. 그룹 하나가 실패해도 나머지는 판정한다(그 그룹은 unknown 한 줄로 남긴다). */
export async function collectChecks(nowMs = Date.now()): Promise<CheckResult[]> {
  const db = await getDb();
  const hbs = await loadHeartbeats(db);
  const groups: Array<[CheckGroup, string, () => Promise<CheckResult[]>]> = [
    ["intel", "영업 수집", () => intelChecks(db, hbs, nowMs)],
    ["adt", "근태", () => adtChecks(db, hbs, nowMs)],
    ["bid", "공공입찰", () => bidChecks(db, nowMs)],
    ["barobill", "바로빌", () => barobillChecks(db, nowMs)],
  ];
  const out: CheckResult[] = [];
  for (const [grp, name, fn] of groups) {
    try {
      out.push(...(await fn()));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[integration-watch] ${grp} 판정 실패`, err);
      out.push({ key: `${grp}._check`, grp, label: `${name} 판정`, status: "unknown", reason: `판정 오류: ${msg.slice(0, 200)}`, lastOkAt: null });
    }
  }
  return out;
}

// ── 저장·알림 ──────────────────────────────────────────────────────────────

async function loadPrev(db: PgDatabase): Promise<Map<string, PrevState>> {
  const rows = rowsToObjects(
    await db.exec(`SELECT check_key, status, ${ISO("failing_since")} AS fs, ${ISO("last_alert_at")} AS la FROM integration_health`)
  );
  return new Map(
    rows.map((r) => [
      String(r.check_key),
      {
        key: String(r.check_key),
        status: String(r.status) as HealthStatus,
        failingSince: r.fs == null ? null : String(r.fs),
        lastAlertAt: r.la == null ? null : String(r.la),
      },
    ])
  );
}

async function systemAdminRecipients(db: PgDatabase): Promise<{ userIds: string[]; emails: string[] }> {
  const today = kstParts(Date.now()).ymd;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT u.user_id, u.email FROM users u
         JOIN user_permission_assignments a ON a.user_id = u.user_id
        WHERE u.status = 'active' AND a.template_id = 'tpl-system-admin' AND a.revoked_at IS NULL
          AND (a.effective_from IS NULL OR left(a.effective_from, 10) <= $1)
          AND (a.effective_to IS NULL OR left(a.effective_to, 10) >= $1)`,
      [today]
    )
  );
  return {
    userIds: rows.map((r) => String(r.user_id)),
    emails: rows.map((r) => (r.email == null ? "" : String(r.email).trim())).filter(Boolean),
  };
}

async function dispatch(
  kind: "failing" | "recovered",
  msg: { title: string; body: string },
  keys: string[],
  nowMs: number
): Promise<string[]> {
  const channels: string[] = [];
  const db = await getDb();
  try {
    await withDbWrite(async (wdb) => {
      await wdb.run(
        `INSERT INTO alerts (severity, source, code, title, body, payload_json, created_at)
         VALUES ($1, 'integration', $2, $3, $4, $5::jsonb, $6)`,
        [
          kind === "failing" ? "error" : "info",
          kind === "failing" ? "integration-failing" : "integration-recovered",
          msg.title,
          msg.body,
          JSON.stringify({ keys }),
          new Date(nowMs).toISOString(),
        ]
      );
    });
    channels.push("bell");
  } catch (e) {
    console.warn(`[integration-watch] alerts 적재 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  const { userIds, emails } = await systemAdminRecipients(db);
  if (userIds.length) {
    const r = await sendPush(userIds, {
      event: "ops.integration",
      title: msg.title,
      body: msg.body,
      link: SCREEN_LINK,
      dedupKey: `integration:${kind}:${keys.join(",")}:${new Date(nowMs).toISOString().slice(0, 13)}`,
    });
    if (r.ok) channels.push("push");
  }
  if (emails.length) {
    const r = await sendNotifyEmail({
      to: emails,
      subject: `[MCM] ${msg.title}`,
      text: `${msg.body}\n\n연동 상태 화면: ${SCREEN_LINK}`,
    });
    if (r.ok) channels.push("email");
  }
  return channels;
}

export interface WatchRunSummary {
  checkedAt: string;
  total: number;
  failing: number;
  newlyFailing: string[];
  reminders: string[];
  recovered: string[];
  channels: { failing: string[]; recovered: string[] };
}

/** 한 번 점검: 판정 → 상태 저장 → (send 면) 이상·복구 알림. */
export async function runIntegrationWatch(opts: { send?: boolean; nowMs?: number } = {}): Promise<WatchRunSummary> {
  const nowMs = opts.nowMs ?? Date.now();
  const send = opts.send !== false;
  const results = await collectChecks(nowMs);
  const db = await getDb();
  const prev = await loadPrev(db);
  const plan = planWatch(prev, results, nowMs);

  await withDbWrite(async (wdb) => {
    for (const n of plan.next) {
      await wdb.run(
        `INSERT INTO integration_health
           (check_key, grp, label, status, reason, last_ok_at, failing_since, last_alert_at, last_checked_at, detail)
         VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::timestamptz,$9::timestamptz,$10::jsonb)
         ON CONFLICT (check_key) DO UPDATE SET
           grp = EXCLUDED.grp, label = EXCLUDED.label, status = EXCLUDED.status,
           reason = COALESCE(EXCLUDED.reason, CASE WHEN EXCLUDED.status = integration_health.status THEN integration_health.reason END),
           last_ok_at = COALESCE(EXCLUDED.last_ok_at, integration_health.last_ok_at),
           failing_since = EXCLUDED.failing_since, last_alert_at = EXCLUDED.last_alert_at,
           last_checked_at = EXCLUDED.last_checked_at, detail = EXCLUDED.detail`,
        [n.key, n.grp, n.label, n.status, n.reason, n.lastOkAt, n.failingSince, send ? n.lastAlertAt : (prev.get(n.key)?.lastAlertAt ?? null),
          new Date(nowMs).toISOString(), n.detail ? JSON.stringify(n.detail) : null]
      );
    }
    // 더 이상 감시하지 않는 대상(소스 비활성·삭제)은 지운다.
    const keys = plan.next.map((n) => n.key);
    await wdb.run(`DELETE FROM integration_health WHERE NOT (check_key = ANY($1::text[]))`, [keys]);
  });

  const msgs = buildWatchMessages(plan, nowMs);
  const channels = { failing: [] as string[], recovered: [] as string[] };
  if (send && msgs.failing) {
    channels.failing = await dispatch("failing", msgs.failing, [...plan.newlyFailing, ...plan.reminders].map((r) => r.key), nowMs);
  }
  if (send && msgs.recovered) {
    channels.recovered = await dispatch("recovered", msgs.recovered, plan.recovered.map((r) => r.key), nowMs);
  }
  return {
    checkedAt: new Date(nowMs).toISOString(),
    total: plan.next.length,
    failing: plan.next.filter((n) => n.status === "failing").length,
    newlyFailing: plan.newlyFailing.map((r) => r.key),
    reminders: plan.reminders.map((r) => r.key),
    recovered: plan.recovered.map((r) => r.key),
    channels,
  };
}

export interface IntegrationHealthRow {
  key: string;
  grp: CheckGroup;
  label: string;
  status: HealthStatus;
  reason: string | null;
  lastOkAt: string | null;
  failingSince: string | null;
  lastAlertAt: string | null;
  lastCheckedAt: string | null;
}

/** 연동 상태 화면용 — 이상 먼저, 그룹·이름 순. */
export async function listIntegrationHealth(): Promise<IntegrationHealthRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT check_key, grp, label, status, reason,
              ${ISO("last_ok_at")} AS last_ok_at, ${ISO("failing_since")} AS failing_since,
              ${ISO("last_alert_at")} AS last_alert_at, ${ISO("last_checked_at")} AS last_checked_at
         FROM integration_health
        ORDER BY CASE status WHEN 'failing' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END, grp, label`
    )
  );
  const s = (v: unknown) => (v == null ? null : String(v));
  return rows.map((r) => ({
    key: String(r.check_key),
    grp: String(r.grp) as CheckGroup,
    label: String(r.label),
    status: String(r.status) as HealthStatus,
    reason: s(r.reason),
    lastOkAt: s(r.last_ok_at),
    failingSince: s(r.failing_since),
    lastAlertAt: s(r.last_alert_at),
    lastCheckedAt: s(r.last_checked_at),
  }));
}
