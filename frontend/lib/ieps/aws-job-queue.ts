import crypto from "node:crypto";
import type { CollectionConfig } from "./types";
import type { ParseCategory } from "./job-runner";
import { resolveJobBackendUrl } from "./job-backend-url";

export type AwsJobType = "collect" | "parse" | "facility-enrich";

export interface AwsJobRequest {
  type: AwsJobType;
  config?: CollectionConfig;
  runId?: string;
  maxPages?: number;
  backendUrl?: string;
  dryRun?: boolean;
  parseOnly?: ParseCategory;
}

export interface AwsQueuedJob {
  jobId: string;
  queueUrl: string;
}

export function isAwsJobQueueEnabled(): boolean {
  return process.env.MCM_JOB_QUEUE_MODE === "sqs" && Boolean(process.env.MCM_JOB_QUEUE_URL);
}

/** 새 작업 유형을 이해하는 워커가 배포된 뒤 활성화한다. 기존 수집 워커에 잘못 전달하지 않는다. */
export function isFacilityQualityQueueEnabled(): boolean {
  return isAwsJobQueueEnabled() && process.env.MCM_FACILITY_QUALITY_WORKER_READY === "true" &&
    ["TASK_DEFINITION", "CLUSTER", "SUBNETS", "SECURITY_GROUPS"].every(key => Boolean(process.env[`MCM_FACILITY_QUALITY_${key}`]));
}

/** 상시 태스크 없이 요청 시 큐를 비우는 워커를 기동한다. 실행 설정은 서버 환경에서만 읽는다. */
async function startQualityWorker(jobId: string) {
  if (!isFacilityQualityQueueEnabled()) throw new Error("사업장 정보 조회 워커 연결이 준비되지 않았습니다");
  const { ECSClient, RunTaskCommand } = await import("@aws-sdk/client-ecs");
  const client = new ECSClient({ region: process.env.AWS_REGION || "ap-northeast-2" });
  const split = (key: string) => process.env[`MCM_FACILITY_QUALITY_${key}`]!.split(",").map(s => s.trim()).filter(Boolean);
  const result = await client.send(new RunTaskCommand({
    cluster: process.env.MCM_FACILITY_QUALITY_CLUSTER,
    taskDefinition: process.env.MCM_FACILITY_QUALITY_TASK_DEFINITION,
    launchType: "FARGATE", count: 1, clientToken: jobId, startedBy: "facility-quality",
    networkConfiguration: { awsvpcConfiguration: { subnets: split("SUBNETS"), securityGroups: split("SECURITY_GROUPS"), assignPublicIp: "ENABLED" } },
    overrides: { containerOverrides: [{ name: "worker", command: ["npm", "run", "worker:aws", "--", "--drain"] }] },
  }));
  if (result.failures?.length || !result.tasks?.length) throw new Error("사업장 정보 조회 워커 기동 실패. 저장된 작업을 재개하세요");
}

export async function enqueueAwsJob(request: AwsJobRequest): Promise<AwsQueuedJob> {
  const queueUrl = process.env.MCM_JOB_QUEUE_URL;
  if (!queueUrl) {
    throw new Error("MCM_JOB_QUEUE_URL is required when MCM_JOB_QUEUE_MODE=sqs");
  }

  const jobId = crypto.randomUUID();
  const backendUrl = resolveJobBackendUrl(request.backendUrl);
  const messageBody = JSON.stringify({
    jobId,
    requestedAt: new Date().toISOString(),
    ...request,
    backendUrl,
  });

  const aws = await import("@aws-sdk/client-sqs");
  const client = new aws.SQSClient({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-northeast-2",
  });
  await client.send(
    new aws.SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: messageBody,
      MessageGroupId: undefined,
      MessageDeduplicationId: undefined,
    })
  );

  if (request.type === "facility-enrich") await startQualityWorker(jobId);

  return { jobId, queueUrl };
}
