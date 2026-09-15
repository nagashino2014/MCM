#!/usr/bin/env npx ts-node
/**
 * AWS SQS worker wrapper for cli-collect.
 *
 * The existing cli-collect pipeline remains the single implementation of
 * scrape/download/parse/upsert. This worker only translates SQS messages into
 * cli-collect arguments so ECS tasks do not depend on Next.js child_process.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { connectQualityDb } from "../lib/facility-quality/postgres";
import { processQualityRun } from "../lib/facility-enrichment/runner";

type JobType = "collect" | "parse" | "facility-enrich";
type ParseCategory = "integratedFirst" | "integratedChange" | "annualReport";

interface QueueMessage {
  jobId: string;
  type: JobType;
  config: unknown;
  runId?: string;
  maxPages?: number;
  backendUrl?: string;
  dryRun?: boolean;
  parseOnly?: ParseCategory;
}

const QUEUE_URL = process.env.MCM_JOB_QUEUE_URL;
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-northeast-2";

if (!QUEUE_URL) {
  throw new Error("MCM_JOB_QUEUE_URL is required");
}

function resolveWorkerBackendUrl(input?: string): string | undefined {
  if (process.env.NODE_ENV === "production" || process.env.MCM_JOB_QUEUE_URL) {
    return undefined;
  }
  return input;
}

async function loadAwsSqs() {
  return import("@aws-sdk/client-sqs");
}

function runCliCollect(message: QueueMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcm-worker-"));
    const configPath = path.join(tmpDir, "collection-config.json");
    fs.writeFileSync(configPath, JSON.stringify(message.config, null, 2), "utf8");

    const args = [
      "ts-node",
      "--project",
      "tsconfig.json",
      "scripts/cli-collect.ts",
      "--json-progress",
      "--config=" + configPath,
    ];
    if (message.maxPages != null) args.push("--max-pages=" + message.maxPages);
    const backendUrl = resolveWorkerBackendUrl(message.backendUrl);
    if (backendUrl) args.push("--backend=" + backendUrl);
    if (message.dryRun) args.push("--dry-run");
    if (message.type === "collect") args.push("--download-only");
    if (message.type === "parse" && message.parseOnly) args.push("--parse-only=" + message.parseOnly);

    const child = spawn("npx", args, {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, MCM_JOB_ID: message.jobId },
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("exit", (code) => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (code === 0) resolve();
      else reject(new Error(`cli-collect exited with code ${code}`));
    });
    child.on("error", (err) => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      reject(err);
    });
  });
}

async function pollOnce(): Promise<boolean> {
  const aws = await loadAwsSqs();
  const client = new aws.SQSClient({ region: REGION });
  const received = await client.send(
    new aws.ReceiveMessageCommand({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 900,
    })
  );

  const message = received.Messages?.[0];
  if (!message?.Body || !message.ReceiptHandle) return false;

  const body = JSON.parse(message.Body) as QueueMessage;
  console.log(`[worker] received ${body.type} job ${body.jobId}`);
  let visibilityLost = false;
  const heartbeat = setInterval(() => {
    client.send(new aws.ChangeMessageVisibilityCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: message.ReceiptHandle!, VisibilityTimeout: 900 }))
      .catch(() => { visibilityLost = true; });
  }, 60000);
  try {
    if (body.type === "facility-enrich") {
      if (!body.runId || !/^[a-f0-9-]{36}$/.test(body.runId)) throw new Error("Invalid facility quality run ID");
      const connection = connectQualityDb();
      try { await processQualityRun(connection.db, connection.tx, body.runId); } finally { await connection.close(); }
    } else if (body.type === "collect" || body.type === "parse") await runCliCollect(body);
    else throw new Error("Unsupported worker job type");
    if (visibilityLost) throw new Error("SQS visibility heartbeat failed; durable progress retained");
  } finally { clearInterval(heartbeat); }

  await client.send(
    new aws.DeleteMessageCommand({
      QueueUrl: QUEUE_URL,
      ReceiptHandle: message.ReceiptHandle,
    })
  );
  console.log(`[worker] completed ${body.jobId}`);
  return true;
}

async function main() {
  const once = process.argv.includes("--once");
  const drain = process.argv.includes("--drain");
  do {
    const processed = await pollOnce();
    if (drain && !processed) break;
  } while (!once);
}

main().catch((err) => {
  console.error("[worker] failed", err);
  process.exit(1);
});
