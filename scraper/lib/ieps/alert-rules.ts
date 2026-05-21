/**
 * IEPS 라운드 3 — 운영 알람 룰.
 *
 * cli-collect 가 잡 종료 직후 호출한다. 다운로드 흐름은 변경하지 않고,
 * 누적 통계(`DownloadJobStats`)와 직전 시도 이벤트(`DownloadAttemptRecord[]`)를
 * 받아 임계값을 검사한 뒤 `alerts` 테이블에 INSERT 한다.
 *
 * 임계값은 라운드 3 한정으로 하드코드. 후속 라운드에서 설정 페이지 도입 시
 * `RuleConfig` 인터페이스만 외부에서 주입하도록 확장 가능.
 */

import type { Database } from "sql.js";

export interface DownloadAttemptRecord {
  fileId?: string | null;
  downloadUrl: string;
  method: "http" | "playwright" | "cache" | "skipped";
  status: "ok" | "failed";
  attemptNo: number;
  bytes?: number | null;
  error?: string | null;
  occurredAt: string;
}

export interface DownloadJobStats {
  totalAttachments: number;
  httpSucceeded: number;
  playwrightSucceeded: number;
  failed: number;
}

export interface AlertRecord {
  severity: "info" | "warn" | "error";
  source: "download" | "scrape" | "parse";
  code: "high-failure-rate" | "playwright-spike" | "persistent-failure";
  title: string;
  body: string;
  payload: Record<string, unknown>;
}

export interface RuleConfig {
  highFailureRate: { minFailures: number; minRatio: number };
  playwrightSpike: { minPlaywright: number; minRatio: number };
  persistentFailure: { lookbackDays: number; minOccurrences: number };
}

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  highFailureRate: { minFailures: 5, minRatio: 0.3 },
  playwrightSpike: { minPlaywright: 5, minRatio: 0.5 },
  persistentFailure: { lookbackDays: 7, minOccurrences: 3 },
};

/**
 * `download_events` 에 시도 단위 이벤트를 일괄 INSERT 한다.
 * cli-collect 가 잡 종료 직전 한 번만 호출 — write lock 경합 최소화.
 */
export function flushDownloadEvents(
  db: Database,
  jobId: string | null,
  events: DownloadAttemptRecord[]
): void {
  if (!events.length) return;
  for (const e of events) {
    try {
      db.run(
        `INSERT INTO download_events
          (file_id, download_url, method, status, attempt_no, bytes, error, job_id, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.fileId ?? null,
          e.downloadUrl ?? null,
          e.method,
          e.status,
          e.attemptNo,
          e.bytes ?? null,
          e.error ? e.error.slice(0, 500) : null,
          jobId,
          e.occurredAt,
        ]
      );
    } catch (err) {
      console.warn(`[alert-rules] flushDownloadEvents row 실패: ${(err as Error).message}`);
    }
  }
}

/**
 * 임계값 검사 후 위반된 룰만 `AlertRecord[]` 로 반환.
 * persistent-failure 는 download_events 를 조회하므로 db 가 필수.
 */
export function evaluateAlertRules(args: {
  db: Database;
  stats: DownloadJobStats;
  events: DownloadAttemptRecord[];
  config?: RuleConfig;
}): AlertRecord[] {
  const cfg = args.config ?? DEFAULT_RULE_CONFIG;
  const { stats, events, db } = args;
  const out: AlertRecord[] = [];

  // 1) high-failure-rate
  if (
    stats.totalAttachments > 0 &&
    stats.failed >= cfg.highFailureRate.minFailures &&
    stats.failed / stats.totalAttachments >= cfg.highFailureRate.minRatio
  ) {
    const ratio = stats.failed / stats.totalAttachments;
    out.push({
      severity: "warn",
      source: "download",
      code: "high-failure-rate",
      title: `다운로드 실패율 ${(ratio * 100).toFixed(1)}%`,
      body: `이번 잡에서 ${stats.totalAttachments}건 중 ${stats.failed}건 실패. 임계값 ${(cfg.highFailureRate.minRatio * 100).toFixed(0)}% 초과.`,
      payload: { stats, threshold: cfg.highFailureRate, ratio },
    });
  }

  // 2) playwright-spike
  if (
    stats.totalAttachments > 0 &&
    stats.playwrightSucceeded >= cfg.playwrightSpike.minPlaywright &&
    stats.playwrightSucceeded / Math.max(stats.totalAttachments, 1) >=
      cfg.playwrightSpike.minRatio
  ) {
    const ratio = stats.playwrightSucceeded / stats.totalAttachments;
    out.push({
      severity: "info",
      source: "download",
      code: "playwright-spike",
      title: `Playwright 폴백 비중 ${(ratio * 100).toFixed(1)}%`,
      body: `HTTP 1차 시도가 자주 실패하고 있습니다. 게시판 다운로드 정책 변경 가능성을 검토하세요.`,
      payload: { stats, threshold: cfg.playwrightSpike, ratio },
    });
  }

  // 3) persistent-failure — 이번 잡의 실패 url 들 중에서 7일 누적 N회 이상이 있는지
  const failedUrls = Array.from(
    new Set(events.filter((e) => e.status === "failed" && e.downloadUrl).map((e) => e.downloadUrl))
  );
  if (failedUrls.length) {
    const lookback = new Date(
      Date.now() - cfg.persistentFailure.lookbackDays * 24 * 60 * 60 * 1000
    ).toISOString();
    const persistent: { url: string; count: number; lastError: string | null }[] = [];
    for (const url of failedUrls) {
      try {
        const r = db.exec(
          `SELECT COUNT(*) as cnt, MAX(error) as err
             FROM download_events
            WHERE download_url = ? AND status = 'failed' AND occurred_at >= ?`,
          [url, lookback]
        );
        if (!r.length) continue;
        const cnt = Number(r[0].values[0][0]);
        const err = r[0].values[0][1] != null ? String(r[0].values[0][1]) : null;
        if (cnt >= cfg.persistentFailure.minOccurrences) {
          persistent.push({ url, count: cnt, lastError: err });
        }
      } catch (err) {
        console.warn(
          `[alert-rules] persistent-failure 조회 실패: ${(err as Error).message}`
        );
      }
    }
    if (persistent.length) {
      out.push({
        severity: "error",
        source: "download",
        code: "persistent-failure",
        title: `반복 실패 첨부 ${persistent.length}건 감지`,
        body: `최근 ${cfg.persistentFailure.lookbackDays}일 내 ${cfg.persistentFailure.minOccurrences}회 이상 실패한 다운로드가 있습니다. 게시물 URL/세션 정책을 점검하세요.`,
        payload: { urls: persistent, threshold: cfg.persistentFailure },
      });
    }
  }

  return out;
}

/**
 * `evaluateAlertRules()` 의 결과를 `alerts` 테이블에 INSERT.
 */
export function persistAlerts(
  db: Database,
  jobId: string | null,
  alerts: AlertRecord[]
): void {
  const now = new Date().toISOString();
  for (const a of alerts) {
    try {
      db.run(
        `INSERT INTO alerts
          (severity, source, code, title, body, payload_json, job_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          a.severity,
          a.source,
          a.code,
          a.title,
          a.body ?? null,
          JSON.stringify(a.payload ?? {}),
          jobId,
          now,
        ]
      );
    } catch (err) {
      console.warn(`[alert-rules] alert INSERT 실패: ${(err as Error).message}`);
    }
  }
}
