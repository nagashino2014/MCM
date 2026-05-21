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

type JobType = "collect" | "parse";
type ParseCategory = "integratedFirst" | "integratedChange" | "annualReport";

interface QueueMessage {
  jobId: string;
  type: JobType;
  config: unknown;
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
    if (message.backendUrl) args.push("--backend=" + message.backendUrl);
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
  await runCliCollect(body);

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
  do {
    await pollOnce();
  } while (!once);
}

main().catch((err) => {
  console.error("[worker] failed", err);
  process.exit(1);
});
