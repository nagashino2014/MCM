/**
 * 외부 연동 상태 감시 — 순수 판정·전이 계산(DB·시계 의존 없음, tests/integration-watch.test.ts).
 * docs/integration-watchdog-blueprint.md §2·§3.
 *
 * 판정은 "마지막 성공 시각"을 기대 주기와 비교한다. 결과 상태:
 *   ok      — 기대 주기 안에 성공 기록이 있다
 *   failing — 기대 주기를 넘겼거나 마지막 실행이 실패했다(알림 대상)
 *   unknown — 판정 근거가 없다(수집기 갱신 전 등). 알림하지 않는다
 *   skip    — 지금은 판정하지 않는 시간(휴일·야간 근태 등). 이전 상태를 그대로 둔다
 */

export type HealthStatus = "ok" | "failing" | "unknown";
export type CheckStatus = HealthStatus | "skip";
export type CheckGroup = "intel" | "adt" | "bid" | "barobill";

export interface CheckResult {
  key: string;
  grp: CheckGroup;
  label: string;
  status: CheckStatus;
  reason: string | null;
  /** ISO(UTC). 알 수 없으면 null */
  lastOkAt: string | null;
  detail?: Record<string, unknown>;
}

export interface PrevState {
  key: string;
  status: HealthStatus;
  failingSince: string | null;
  lastAlertAt: string | null;
}

export interface NextState {
  key: string;
  grp: CheckGroup;
  label: string;
  status: HealthStatus;
  reason: string | null;
  lastOkAt: string | null;
  failingSince: string | null;
  lastAlertAt: string | null;
  detail: Record<string, unknown> | null;
}

export interface WatchPlan {
  /** ok/unknown → failing 으로 바뀐 대상 — 즉시 알림 */
  newlyFailing: CheckResult[];
  /** failing 지속 + 마지막 알림 후 remindHours 경과 — 재알림 */
  reminders: CheckResult[];
  /** failing → ok — 복구 알림 */
  recovered: Array<CheckResult & { failingSince: string | null }>;
  next: NextState[];
}

const HOUR_MS = 3600 * 1000;

/** KST 달력·시각. dow: 0=일 … 6=토 */
export function kstParts(nowMs: number): { ymd: string; hour: number; dow: number } {
  const d = new Date(nowMs + 9 * HOUR_MS);
  const ymd = d.toISOString().slice(0, 10);
  return { ymd, hour: d.getUTCHours(), dow: d.getUTCDay() };
}

/** KST 날짜(YYYY-MM-DD)에 일수를 더한다. */
export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 경과 시간을 "45분" · "5시간" · "3일 4시간" 으로. */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0분";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}시간`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}일 ${rest}시간` : `${days}일`;
}

/** finance_sync_logs 같은 KST 텍스트(YYYY-MM-DD HH:MM:SS)를 ISO(UTC)로. 형식이 아니면 null. */
export function kstTextToIso(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(String(text));
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}+09:00`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * 신선도 판정 — 마지막 성공이 maxAgeHours 안이면 ok.
 * lastOkIso 가 없으면 unknown(근거 없음). failError 가 있으면(마지막 실행이 실패) 사유에 붙인다.
 */
export function judgeFreshness(
  lastOkIso: string | null,
  nowMs: number,
  maxAgeHours: number,
  failError?: string | null
): { status: HealthStatus; reason: string | null } {
  if (!lastOkIso) {
    return failError
      ? { status: "failing", reason: `성공 기록 없음 — 최근 오류: ${failError}` }
      : { status: "unknown", reason: "성공 기록 없음" };
  }
  const t = Date.parse(lastOkIso);
  if (!Number.isFinite(t)) return { status: "unknown", reason: "시각 형식 오류" };
  const age = nowMs - t;
  if (age <= maxAgeHours * HOUR_MS) return { status: "ok", reason: null };
  const base = `마지막 성공 ${formatAge(age)} 전(기준 ${maxAgeHours}시간)`;
  return { status: "failing", reason: failError ? `${base} — 최근 오류: ${failError}` : base };
}

/**
 * 공공입찰처럼 "매일 정해진 시각(KST)에 1회" 수집하는 소스 판정.
 * 오늘 수집했으면 ok. 아직 마감(batchHour + graceHours) 전이면 어제 수집까지 ok.
 */
export function judgeDailySlot(
  lastRunYmd: string | null,
  batchHour: number,
  nowMs: number,
  graceHours = 2
): { status: HealthStatus; reason: string | null } {
  const { ymd, hour } = kstParts(nowMs);
  if (lastRunYmd === ymd) return { status: "ok", reason: null };
  const due = hour >= batchHour + graceHours;
  if (!due && lastRunYmd === addDaysYmd(ymd, -1)) return { status: "ok", reason: null };
  if (!lastRunYmd) return { status: "failing", reason: `수집 기록 없음(매일 ${batchHour}시 수집)` };
  return {
    status: "failing",
    reason: due
      ? `오늘 ${batchHour}시 수집이 없음(마지막 ${lastRunYmd})`
      : `어제 수집이 없음(마지막 ${lastRunYmd})`,
  };
}

/**
 * 근태 태그 판정 — 근무일 11~18시(KST)에만 본다. 그 밖에는 skip(이전 상태 유지).
 * 근무일 업무 시간에 maxGapHours 넘게 태그가 하나도 없으면 failing.
 */
export function judgeWorkdayActivity(
  lastEventIso: string | null,
  nowMs: number,
  isWorkday: boolean,
  maxGapHours = 4
): { status: CheckStatus; reason: string | null } {
  const { hour } = kstParts(nowMs);
  if (!isWorkday || hour < 11 || hour >= 19) return { status: "skip", reason: "판정 시간 아님(근무일 11~18시만)" };
  const r = judgeFreshness(lastEventIso, nowMs, maxGapHours);
  if (r.status === "failing") return { status: "failing", reason: r.reason?.replace("마지막 성공", "마지막 출입 태그") ?? null };
  return r;
}

/** 이전 상태와 이번 결과로 알림·저장할 다음 상태를 계산한다. */
export function planWatch(
  prev: ReadonlyMap<string, PrevState>,
  results: readonly CheckResult[],
  nowMs: number,
  remindHours = 24
): WatchPlan {
  const nowIso = new Date(nowMs).toISOString();
  const plan: WatchPlan = { newlyFailing: [], reminders: [], recovered: [], next: [] };
  for (const r of results) {
    const p = prev.get(r.key);
    if (r.status === "skip") {
      // 판정 시간이 아니면 이전 상태를 그대로 둔다(처음 보는 대상은 unknown 으로 남긴다).
      plan.next.push({
        key: r.key, grp: r.grp, label: r.label,
        status: p?.status ?? "unknown",
        reason: p ? null : r.reason,
        lastOkAt: r.lastOkAt,
        failingSince: p?.failingSince ?? null,
        lastAlertAt: p?.lastAlertAt ?? null,
        detail: r.detail ?? null,
      });
      continue;
    }
    let failingSince: string | null = null;
    let lastAlertAt = p?.lastAlertAt ?? null;
    if (r.status === "failing") {
      if (p?.status === "failing") {
        failingSince = p.failingSince ?? nowIso;
        const last = lastAlertAt ? Date.parse(lastAlertAt) : NaN;
        if (!Number.isFinite(last) || nowMs - last >= remindHours * HOUR_MS) {
          plan.reminders.push(r);
          lastAlertAt = nowIso;
        }
      } else {
        failingSince = nowIso;
        plan.newlyFailing.push(r);
        lastAlertAt = nowIso;
      }
    } else if (r.status === "ok" && p?.status === "failing") {
      plan.recovered.push({ ...r, failingSince: p.failingSince });
    }
    plan.next.push({
      key: r.key, grp: r.grp, label: r.label,
      status: r.status, reason: r.reason, lastOkAt: r.lastOkAt,
      failingSince, lastAlertAt,
      detail: r.detail ?? null,
    });
  }
  return plan;
}

/** 알림 본문 — 이상(신규·지속)과 복구를 각각 한 통으로 묶는다. */
export function buildWatchMessages(plan: WatchPlan, nowMs: number): {
  failing: { title: string; body: string } | null;
  recovered: { title: string; body: string } | null;
} {
  const failingItems = [
    ...plan.newlyFailing.map((r) => `• ${r.label}: ${r.reason ?? "이상"}`),
    ...plan.reminders.map((r) => `• ${r.label}: ${r.reason ?? "이상"} (계속 이상)`),
  ];
  const failing = failingItems.length
    ? { title: `외부 연동 이상 ${failingItems.length}건`, body: failingItems.join("\n") }
    : null;
  const recovered = plan.recovered.length
    ? {
        title: `외부 연동 복구 ${plan.recovered.length}건`,
        body: plan.recovered
          .map((r) => {
            const since = r.failingSince ? Date.parse(r.failingSince) : NaN;
            return Number.isFinite(since)
              ? `• ${r.label}: 정상화(이상 ${formatAge(nowMs - since)} 지속)`
              : `• ${r.label}: 정상화`;
          })
          .join("\n"),
      }
    : null;
  return { failing, recovered };
}
