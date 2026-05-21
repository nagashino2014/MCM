import fs from "node:fs";
import path from "node:path";

export type ScheduleBackoff = "exponential" | "fixed";

export type ScheduleRetryPolicy = {
  max: number;
  backoff: ScheduleBackoff;
  base_sec: number;
};

export type ScheduleConcurrency = {
  global: number;
  per_org: number;
};

export type ScheduleRateLimit = {
  rps: number;
  burst: number;
};

export type ScraperSchedule = {
  schedule_id: string;
  name: string;
  org_ids: string[]; // selected organization(org_id) list
  targets: string[]; // board_id list
  cron: string;
  timezone: string;
  max_runtime_sec: number;
  concurrency: ScheduleConcurrency;
  retry_policy: ScheduleRetryPolicy;
  rate_limit: ScheduleRateLimit;
  enabled: boolean;
};

export type ScraperRunStatus = "success" | "failed" | "running";

export type ScraperRun = {
  run_id: string;
  schedule_id: string;
  triggered_by: "manual" | "cron";
  started_at: string;
  finished_at?: string;
  status: ScraperRunStatus;
  summary?: string;
  metrics?: {
    new_records?: number;
    skipped_duplicates?: number;
    failed_records?: number;
    duration_ms?: number;
  };
};

export type ScraperSchedulesFile = {
  schedules: ScraperSchedule[];
  runs: ScraperRun[];
  updated_at: string;
};

function schedulesFilePath() {
  const cwd = process.cwd();
  const isFrontendCwd = path.basename(cwd).toLowerCase() === "frontend";
  if (isFrontendCwd) {
    return path.join(cwd, "data", "scraper-schedules.json");
  }

  const frontendDir = path.join(cwd, "frontend");
  if (fs.existsSync(frontendDir) && fs.statSync(frontendDir).isDirectory()) {
    return path.join(frontendDir, "data", "scraper-schedules.json");
  }

  return path.join(cwd, "data", "scraper-schedules.json");
}

export function readScraperSchedules(): ScraperSchedulesFile {
  const p = schedulesFilePath();
  if (!fs.existsSync(p)) {
    return { schedules: [], runs: [], updated_at: new Date().toISOString() };
  }
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as ScraperSchedulesFile;
}

export function writeScraperSchedules(next: Omit<ScraperSchedulesFile, "updated_at">) {
  const p = schedulesFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const payload: ScraperSchedulesFile = {
    ...next,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), "utf8");
}


