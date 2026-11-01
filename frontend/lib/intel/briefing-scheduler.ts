import crypto from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import { getDb, rowsToObjects } from "@/lib/db";
import { nextOfficialCollectionDue } from "./official-sources";
import { briefingError } from "./briefing-schedule";

interface Wakeup { nextDueAt: string | null; checkedAt: string; expiresAt: string }
export function nextImportantScanAt(lastScan: string | null, now = new Date()): string {
  const kst = new Date(now.getTime()+9*3600000); const day = kst.toISOString().slice(0,10);
  if (kst.getUTCHours()<7) return new Date(`${day}T07:00:00+09:00`).toISOString();
  if (kst.getUTCHours()>=22) return new Date(Date.parse(`${day}T07:00:00+09:00`)+86400000).toISOString();
  return new Date(Math.max(now.getTime(),lastScan ? Date.parse(lastScan)+15*60000 : now.getTime())).toISOString();
}
let local: Wakeup | null = null;
const cacheKey = "internal/intel-briefing-wakeup.json";
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-2" });
const bucket = () => process.env.MCM_STORAGE_BUCKET?.trim();
/** 다음 작업에는 보고서뿐 아니라 재시도·전달·lease 회수·공식 소스 수집도 포함한다. */
export async function refreshBriefingWakeup(): Promise<Wakeup> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT min(due_at) AS due_at FROM (
    SELECT next_run_at AS due_at FROM intel_briefing_profiles WHERE enabled=true
    UNION ALL SELECT next_attempt_at FROM intel_briefing_runs WHERE status IN ('queued','waiting_sources','failed') AND attempt<3
    UNION ALL SELECT lease_until FROM intel_briefing_runs WHERE status IN ('running','ready')
    UNION ALL SELECT next_attempt_at FROM intel_notification_outbox WHERE status IN ('pending','failed') AND attempt<retry_limit
    UNION ALL SELECT lease_until FROM intel_notification_outbox WHERE status='sending'
  ) due`));
  const scan = rowsToObjects(await db.exec("SELECT EXISTS(SELECT 1 FROM intel_briefing_profiles WHERE enabled=true AND config->>'importantAlerts'='true') AS active,(SELECT updated_at FROM intel_briefing_runtime WHERE key='last_signal_scan') AS last_scan"))[0];
  const official = await nextOfficialCollectionDue();
  const raw = rows[0]?.due_at; const date = raw instanceof Date ? raw.toISOString() : raw ? String(raw) : null;
  const scanDue = scan.active ? nextImportantScanAt(scan.last_scan ? new Date(String(scan.last_scan)).toISOString() : null) : null;
  const dates = [date, official, scanDue].filter((v): v is string => !!v && Date.parse(v)<Date.parse('9999-01-01')).sort((a, b) => Date.parse(a) - Date.parse(b));
  local = { nextDueAt: dates[0] ?? null, checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + (dates.length ? 15 : 60) * 60000).toISOString() };
  if (bucket()) await s3.send(new PutObjectCommand({ Bucket: bucket(), Key: cacheKey, Body: JSON.stringify(local), ContentType: "application/json", CacheControl: "no-store" }));
  return local;
}
async function loadWakeup(): Promise<Wakeup> {
  // 다른 프로세스의 프로필 변경도 읽는다. 유효한 공유 캐시 조회는 DB를 깨우지 않는다.
  if (bucket()) {
    try {
      const r = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: cacheKey }));
      const state = JSON.parse(await r.Body!.transformToString()) as Wakeup;
      if (state.expiresAt && Date.parse(state.expiresAt) > Date.now()) { local = state; return state; }
    } catch (error) { console.warn("[briefing] 공유 실행 캐시 복구", error instanceof Error ? error.name : "error"); }
  } else if (local && Date.parse(local.expiresAt) > Date.now()) return local;
  return refreshBriefingWakeup();
}
export async function triggerDueBriefingWorker(): Promise<{ skipped?: string; taskArn?: string }> {
  if (process.env.INTEL_BRIEFING_ENABLED !== "true") return { skipped: "disabled" };
  const wake = await loadWakeup();
  if (!wake.nextDueAt || Date.parse(wake.nextDueAt) > Date.now()) return { skipped: "not-due" };
  const cluster = process.env.INTEL_BRIEFING_ECS_CLUSTER;
  const taskDefinition = process.env.INTEL_BRIEFING_TASK_DEFINITION;
  const subnets = process.env.INTEL_BRIEFING_SUBNETS?.split(",").map(s => s.trim()).filter(Boolean);
  const securityGroups = process.env.INTEL_BRIEFING_SECURITY_GROUPS?.split(",").map(s => s.trim()).filter(Boolean);
  const assignPublicIp = process.env.INTEL_BRIEFING_ASSIGN_PUBLIC_IP;
  if (!cluster || !taskDefinition || !subnets?.length || !securityGroups?.length) throw briefingError("정기 브리핑 실행기 설정이 완료되지 않았습니다. 전용 작업 정의·네트워크를 확인하세요.", 503);
  if (assignPublicIp !== "ENABLED" && assignPublicIp !== "DISABLED") throw briefingError("실행기 네트워크의 공개 IP 설정(ENABLED/DISABLED)이 필요합니다.", 503);
  const token = crypto.createHash("sha256").update(`${taskDefinition}:${Math.floor(Date.now() / 300000)}`).digest("hex");
  const client = new ECSClient({ region: process.env.AWS_REGION ?? "ap-northeast-2" });
  const response = await client.send(new RunTaskCommand({ cluster, taskDefinition, launchType: "FARGATE", count: 1, clientToken: token,
    networkConfiguration: { awsvpcConfiguration: { subnets, securityGroups, assignPublicIp } },
    overrides: { containerOverrides: [{ name: process.env.INTEL_BRIEFING_CONTAINER_NAME ?? "next", command: ["node", ".next/intel-briefing-batch.cjs"] }] },
  }));
  if (response.failures?.length || !response.tasks?.[0]?.taskArn) throw briefingError(`정기 브리핑 작업을 시작하지 못했습니다: ${response.failures?.map(f => f.reason).join(", ") ?? "작업 응답 없음"}`, 502);
  return { taskArn: response.tasks[0].taskArn };
}
