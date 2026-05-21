import crypto from "node:crypto";
import type { CollectionConfig } from "./types";
import type { ParseCategory } from "./job-runner";

export type AwsJobType = "collect" | "parse";

export interface AwsJobRequest {
  type: AwsJobType;
  config: CollectionConfig;
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

export async function enqueueAwsJob(request: AwsJobRequest): Promise<AwsQueuedJob> {
  const queueUrl = process.env.MCM_JOB_QUEUE_URL;
  if (!queueUrl) {
    throw new Error("MCM_JOB_QUEUE_URL is required when MCM_JOB_QUEUE_MODE=sqs");
  }

  const jobId = crypto.randomUUID();
  const messageBody = JSON.stringify({
    jobId,
    requestedAt: new Date().toISOString(),
    ...request,
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

  return { jobId, queueUrl };
}
