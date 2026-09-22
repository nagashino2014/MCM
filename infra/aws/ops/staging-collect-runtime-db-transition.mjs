#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectScheduleObservation } from "./runtime-db-transition-schedule.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index++) {
    const token = values[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (index + 1 >= values.length || values[index + 1].startsWith("--")) throw new Error(`missing value for --${key}`);
    result[key] = values[++index];
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const allowedArguments = new Set([
  "output", "next-candidate", "worker-candidate", "aws-profile", "region", "cluster", "next-service", "worker-family",
  "aws-command", "psql-command", "aws-prefix-json", "psql-prefix-json",
]);
for (const name of Object.keys(args)) if (!allowedArguments.has(name)) throw new Error(`unknown argument: --${name}`);
for (const name of ["output", "next-candidate", "worker-candidate"]) {
  if (!args[name]) throw new Error(`--${name} is required`);
}

const contractPath = path.join(here, "runtime-db-transition-contract.json");
const contract = JSON.parse(await readFile(contractPath, "utf8"));
const awsCommand = args["aws-command"] || "aws";
const psqlCommand = args["psql-command"] || "psql";
const awsPrefix = args["aws-prefix-json"] ? JSON.parse(args["aws-prefix-json"]) : [];
const psqlPrefix = args["psql-prefix-json"] ? JSON.parse(args["psql-prefix-json"]) : [];
const testAdapterArguments = ["aws-command", "psql-command", "aws-prefix-json", "psql-prefix-json"].filter(name => args[name] !== undefined);
if (testAdapterArguments.length && (process.env.MCM_RUNTIME_TRANSITION_TEST_ADAPTERS !== "1" || String(process.env.NODE_ENV ?? "").trim().toLowerCase() === "production")) {
  throw new Error(`${testAdapterArguments.map(name => `--${name}`).join(", ")} are test-only adapter arguments`);
}
if (!Array.isArray(awsPrefix) || !awsPrefix.every(item => typeof item === "string")) throw new Error("--aws-prefix-json must be a JSON string array");
if (!Array.isArray(psqlPrefix) || !psqlPrefix.every(item => typeof item === "string")) throw new Error("--psql-prefix-json must be a JSON string array");
const awsProfile = args["aws-profile"] ?? "mcm-kesi-staging";
const region = args.region || contract.region;
const cluster = args.cluster || contract.cluster;
const nextService = args["next-service"] || contract.nextService;
const workerFamily = args["worker-family"] || contract.components.worker.family;
const outputPath = path.resolve(args.output);
const nowIso = () => new Date().toISOString();

try {
  await access(outputPath);
  throw new Error(`output already exists: ${outputPath}`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

function run(command, commandArgs, label, { sensitive = false, env = process.env } = {}) {
  const value = spawnSync(command, commandArgs, { encoding: "utf8", windowsHide: true, env });
  if (value.error) throw new Error(`${label} failed to start: ${value.error.message}`);
  if (value.status !== 0) {
    const detail = sensitive ? "sensitive command output suppressed" : (value.stderr || value.stdout || `exit ${value.status}`).trim();
    throw new Error(`${label} failed: ${detail}`);
  }
  return value.stdout.trim();
}

function assertNoDuplicateJsonKeys(text, label) {
  let index = 0;
  const whitespace = () => { while (/\s/u.test(text[index] ?? "")) index++; };
  const parseString = () => {
    const start = index;
    if (text[index++] !== '"') throw new Error(`${label} returned invalid JSON`);
    while (index < text.length) {
      const character = text[index++];
      if (character === '"') return JSON.parse(text.slice(start, index));
      if (character === "\\") {
        const escaped = text[index++];
        if (escaped === "u") {
          if (!/^[0-9A-Fa-f]{4}$/u.test(text.slice(index, index + 4))) throw new Error(`${label} returned invalid JSON`);
          index += 4;
        } else if (!'"\\/bfnrt'.includes(escaped)) throw new Error(`${label} returned invalid JSON`);
      } else if (character.charCodeAt(0) < 0x20) throw new Error(`${label} returned invalid JSON`);
    }
    throw new Error(`${label} returned invalid JSON`);
  };
  const parseValue = () => {
    whitespace();
    if (text[index] === "{") return parseObject();
    if (text[index] === "[") return parseArray();
    if (text[index] === '"') { parseString(); return; }
    const tail = text.slice(index);
    const primitive = tail.match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u)?.[0];
    if (!primitive) throw new Error(`${label} returned invalid JSON`);
    index += primitive.length;
  };
  const parseObject = () => {
    index++;
    whitespace();
    const keys = new Set();
    if (text[index] === "}") { index++; return; }
    while (index < text.length) {
      whitespace();
      const key = parseString();
      if (keys.has(key)) throw new Error(`${label} contains duplicate JSON key '${key}'`);
      keys.add(key);
      whitespace();
      if (text[index++] !== ":") throw new Error(`${label} returned invalid JSON`);
      parseValue();
      whitespace();
      if (text[index] === "}") { index++; return; }
      if (text[index++] !== ",") throw new Error(`${label} returned invalid JSON`);
    }
    throw new Error(`${label} returned invalid JSON`);
  };
  const parseArray = () => {
    index++;
    whitespace();
    if (text[index] === "]") { index++; return; }
    while (index < text.length) {
      parseValue();
      whitespace();
      if (text[index] === "]") { index++; return; }
      if (text[index++] !== ",") throw new Error(`${label} returned invalid JSON`);
    }
    throw new Error(`${label} returned invalid JSON`);
  };
  parseValue();
  whitespace();
  if (index !== text.length) throw new Error(`${label} returned invalid JSON`);
}

function aws(service, operation, operationArgs, label, options = {}) {
  const common = [];
  if (awsProfile) common.push("--profile", awsProfile);
  common.push("--region", region, "--output", "json", "--no-cli-pager");
  const raw = run(awsCommand, [...awsPrefix, service, operation, ...operationArgs, ...common], label, options);
  assertNoDuplicateJsonKeys(raw, label);
  try { return JSON.parse(raw); }
  catch { throw new Error(`${label} returned invalid JSON`); }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value, policyPath = "$") {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") throw new Error(`IAM policy number is forbidden at ${policyPath}`);
  if (Array.isArray(value)) return `[${value.map((item, index) => canonicalJson(item, `${policyPath}[${index}]`)).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], `${policyPath}.${key}`)}`).join(",")}}`;
  }
  throw new Error(`unsupported IAM policy value at ${policyPath}`);
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function iamPatternMatches(pattern, value) {
  if (typeof pattern !== "string") return false;
  const expression = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*");
  const match = new RegExp(`^(?:${expression})$`, "iu").exec(value);
  return match?.[0] === value;
}

function statementCoversPassRole(statement, roleArn) {
  const actions = statement.Action === undefined ? null : (Array.isArray(statement.Action) ? statement.Action : [statement.Action]);
  const notActions = statement.NotAction === undefined ? null : (Array.isArray(statement.NotAction) ? statement.NotAction : [statement.NotAction]);
  const actionCovered = actions
    ? actions.some(action => iamPatternMatches(action, "iam:PassRole"))
    : notActions
      ? !notActions.some(action => iamPatternMatches(action, "iam:PassRole"))
      : false;
  const resources = statement.Resource === undefined ? null : (Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource]);
  const notResources = statement.NotResource === undefined ? null : (Array.isArray(statement.NotResource) ? statement.NotResource : [statement.NotResource]);
  const resourceCovered = resources
    ? resources.some(resource => iamPatternMatches(resource, roleArn))
    : notResources
      ? !notResources.some(resource => iamPatternMatches(resource, roleArn))
      : true;
  return actionCovered && resourceCovered;
}

function allowedPassRoleResources(document) {
  const result = new Set();
  const statements = Array.isArray(document?.Statement) ? document.Statement : document?.Statement ? [document.Statement] : [];
  for (const statement of statements) {
    if (!statement || typeof statement !== "object" || Array.isArray(statement) || statement.Effect !== "Allow") continue;
    const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
    if (!actions.some(action => typeof action === "string" && action.toLowerCase() === "iam:passrole")) continue;
    const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
    for (const resource of resources) if (typeof resource === "string") result.add(resource);
  }
  return result;
}

function passRoleExplicitlyDenied(document, roleArn) {
  const statements = Array.isArray(document?.Statement) ? document.Statement : document?.Statement ? [document.Statement] : [];
  return statements.some(statement => statement && typeof statement === "object" && !Array.isArray(statement)
    && statement.Effect === "Deny" && statementCoversPassRole(statement, roleArn));
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value ?? {}).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} property set mismatch`);
}

function parseCandidate(file, label) {
  return readFile(path.resolve(file), "utf8").then(text => {
    const parsed = JSON.parse(text);
    const value = parsed.taskDefinition ?? parsed;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} candidate is invalid`);
    return value;
  });
}

function collectDatabase() {
  const sql = `SELECT pg_catalog.json_build_object(
    'version', 'r0b-runtime-database-facts-v1',
    'capturedAt', pg_catalog.to_char(pg_catalog.clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'name', pg_catalog.current_database(),
    'proofVersion', public.mcm_assert_runtime_privileges()->>'version',
    'roles', pg_catalog.json_build_object(
      'app', pg_catalog.json_build_object('name', 'mcm_app', 'login', (SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname = 'mcm_app')),
      'worker', pg_catalog.json_build_object('name', 'mcm_worker', 'login', (SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname = 'mcm_worker'))
    ),
    'collectorExists', pg_catalog.to_regrole('mcm_collector') IS NOT NULL,
    'masterRuntimeSessionCount', (
      SELECT pg_catalog.count(*) FROM pg_catalog.pg_stat_activity
      WHERE backend_type = 'client backend' AND pid <> pg_catalog.pg_backend_pid()
        AND usename IS NOT NULL AND usename NOT IN ('mcm_app', 'mcm_worker')
    )
  )::text
  WHERE pg_catalog.current_setting('transaction_read_only') = 'on';`;
  const databaseEnvironment = { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" };
  delete databaseEnvironment.PGSERVICE;
  delete databaseEnvironment.PGSERVICEFILE;
  const raw = run(psqlCommand, [...psqlPrefix, "-X", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-c", sql], "database fact query", { sensitive: true, env: databaseEnvironment });
  if (!raw) throw new Error("database fact query did not run in a read-only session");
  let facts;
  try { facts = JSON.parse(raw); } catch { throw new Error("database fact query returned invalid JSON"); }
  exactKeys(facts, ["version", "capturedAt", "name", "proofVersion", "roles", "collectorExists", "masterRuntimeSessionCount"], "database facts");
  if (facts.version !== contract.collector.databaseFactsVersion) throw new Error("database facts version mismatch");
  return facts;
}

function collectSecret(component) {
  const metadata = aws("secretsmanager", "describe-secret", ["--secret-id", component.secret], `${component.role} secret metadata`);
  const versions = aws("secretsmanager", "list-secret-version-ids", ["--secret-id", component.secret, "--include-deprecated"], `${component.role} secret versions`);
  const value = aws("secretsmanager", "get-secret-value", ["--secret-id", component.secret, "--version-stage", "AWSCURRENT"], `${component.role} secret value`, { sensitive: true });
  let secret;
  try { secret = JSON.parse(value.SecretString); } catch { throw new Error(`${component.role} secret string is invalid`); }
  const current = (versions.Versions ?? []).filter(item => (item.VersionStages ?? []).includes("AWSCURRENT"));
  const pending = (versions.Versions ?? []).filter(item => (item.VersionStages ?? []).includes("AWSPENDING"));
  const result = {
    arn: metadata.ARN,
    username: secret.username,
    passwordPresent: typeof secret.password === "string" && secret.password.length > 0,
    currentVersionCount: current.length,
    currentVersionId: current.length === 1 ? current[0].VersionId : "",
    pendingVersionCount: pending.length,
    pendingVersionIds: pending.map(item => item.VersionId).sort(),
  };
  secret = null;
  value.SecretString = null;
  return result;
}

function collectPolicies() {
  let legacyPassRoleEnabled = true;
  let currentAndCandidateRolesCovered = true;
  const inlinePolicies = [];
  for (const item of contract.iamTransitionPolicies) {
    const response = aws("iam", "get-role-policy", ["--role-name", item.roleName, "--policy-name", item.policyName], `IAM policy ${item.roleName}/${item.policyName}`);
    const document = response.PolicyDocument;
    const canonical = canonicalJson(document);
    const resources = allowedPassRoleResources(document);
    const roleArn = name => `arn:${contract.partition}:iam::${contract.accountId}:role/${name}`;
    legacyPassRoleEnabled &&= item.requiredLegacyRoleNames.every(name => resources.has(roleArn(name)) && !passRoleExplicitlyDenied(document, roleArn(name)));
    currentAndCandidateRolesCovered &&= item.requiredCandidateRoleNames.every(name => resources.has(roleArn(name)) && !passRoleExplicitlyDenied(document, roleArn(name)));
    inlinePolicies.push({ roleName: item.roleName, policyName: item.policyName, documentSha256: sha256(Buffer.from(canonical, "utf8")) });
  }
  return { legacyPassRoleEnabled, currentAndCandidateRolesCovered, inlinePolicies };
}

function queueUrl(name) {
  const response = aws("sqs", "get-queue-url", ["--queue-name", name], `queue URL ${name}`);
  if (!response.QueueUrl) throw new Error(`queue URL ${name} is missing`);
  return response.QueueUrl;
}

function queueAttributes(url, label) {
  const response = aws("sqs", "get-queue-attributes", ["--queue-url", url, "--attribute-names", "All"], label);
  return response.Attributes ?? {};
}

function metric(name, statistic) {
  const end = new Date();
  const start = new Date(end.getTime() - 5 * 60_000);
  const response = aws("cloudwatch", "get-metric-statistics", [
    "--namespace", "AWS/SQS", "--metric-name", name,
    "--dimensions", `Name=QueueName,Value=${contract.queue.name}`,
    "--start-time", start.toISOString(), "--end-time", end.toISOString(),
    "--period", "300", "--statistics", statistic,
  ], `queue metric ${name}`);
  const values = (response.Datapoints ?? []).map(item => Number(item[statistic])).filter(Number.isFinite);
  if (!values.length) throw new Error(`queue metric ${name} returned no datapoints`);
  return statistic === "Sum" ? Math.round(values.reduce((left, right) => left + right, 0)) : Math.round(Math.max(...values));
}

function collectQueue() {
  const url = queueUrl(contract.queue.name);
  const dlqUrl = queueUrl(contract.queue.dlqName);
  const attributes = queueAttributes(url, "jobs queue attributes");
  const dlq = queueAttributes(dlqUrl, "jobs DLQ attributes");
  const running = aws("ecs", "list-tasks", ["--cluster", cluster, "--family", workerFamily, "--desired-status", "RUNNING"], "running worker tasks");
  const pending = aws("ecs", "list-tasks", ["--cluster", cluster, "--family", workerFamily, "--desired-status", "PENDING"], "pending worker tasks");
  return {
    name: contract.queue.name,
    retentionSeconds: Number(attributes.MessageRetentionPeriod ?? 0),
    visibleMessages: Number(attributes.ApproximateNumberOfMessages ?? 0),
    notVisibleMessages: Number(attributes.ApproximateNumberOfMessagesNotVisible ?? 0),
    oldestMessageAgeSeconds: metric("ApproximateAgeOfOldestMessage", "Maximum"),
    dlqVisibleMessages: Number(dlq.ApproximateNumberOfMessages ?? 0),
    dlqNotVisibleMessages: Number(dlq.ApproximateNumberOfMessagesNotVisible ?? 0),
    runningWorkerTasks: (running.taskArns ?? []).length + (pending.taskArns ?? []).length,
    publishedLast5Minutes: metric("NumberOfMessagesSent", "Sum"),
  };
}

function collectCurrent() {
  const services = aws("ecs", "describe-services", ["--cluster", cluster, "--services", nextService], "Next service");
  if ((services.services ?? []).length !== 1) throw new Error("Next service lookup did not return exactly one service");
  const service = services.services[0];
  const nextTask = aws("ecs", "describe-task-definition", ["--task-definition", service.taskDefinition], "current Next task definition").taskDefinition;
  const workerTask = aws("ecs", "describe-task-definition", ["--task-definition", workerFamily], "current worker task definition").taskDefinition;
  const schedules = contract.scheduleRules.map(name => {
    const rule = aws("events", "describe-rule", ["--name", name], `EventBridge rule ${name}`);
    const targets = aws("events", "list-targets-by-rule", ["--rule", name], `EventBridge targets ${name}`);
    return projectScheduleObservation(contract, rule, targets);
  });
  return {
    nextTaskDefinition: nextTask,
    workerTaskDefinition: workerTask,
    nextService: {
      name: service.serviceName,
      taskDefinitionArn: service.taskDefinition,
      desiredCount: service.desiredCount,
      runningCount: service.runningCount,
      pendingCount: service.pendingCount,
      deployments: (service.deployments ?? []).map(item => ({ id: item.id, createdAt: item.createdAt, status: item.status, rolloutState: item.rolloutState })),
    },
    schedules,
  };
}

const captureStartedAt = nowIso();
const caller = aws("sts", "get-caller-identity", [], "collector identity");
const database = collectDatabase();
const databaseCapturedAt = database.capturedAt;
delete database.version;
delete database.capturedAt;
const secrets = {
  app: collectSecret(contract.components.next),
  worker: collectSecret(contract.components.worker),
};
const secretsCapturedAt = nowIso();
const iam = collectPolicies();
const iamCapturedAt = nowIso();
const queue = collectQueue();
const queueCapturedAt = nowIso();
const current = collectCurrent();
const currentCapturedAt = nowIso();
const candidates = {
  nextTaskDefinition: await parseCandidate(args["next-candidate"], "Next"),
  workerTaskDefinition: await parseCandidate(args["worker-candidate"], "worker"),
};
const candidatesCapturedAt = nowIso();
const captureFinishedAt = nowIso();

if (String(caller.Account) !== String(contract.accountId)) throw new Error("collector account mismatch");
if (database.name !== contract.database) throw new Error("database name mismatch");
if (Date.parse(captureFinishedAt) - Date.parse(captureStartedAt) > contract.snapshot.maximumCollectionWindowSeconds * 1000) throw new Error("collector capture window is too wide");

const snapshot = {
  version: contract.snapshotVersion,
  generatedAt: nowIso(),
  collector: { name: contract.collector.name, version: contract.collector.version, principal: caller.Arn },
  captureWindow: { startedAt: captureStartedAt, finishedAt: captureFinishedAt },
  factCapturedAt: {
    database: databaseCapturedAt,
    secrets: secretsCapturedAt,
    iam: iamCapturedAt,
    queue: queueCapturedAt,
    current: currentCapturedAt,
    candidates: candidatesCapturedAt,
  },
  aws: { partition: contract.partition, region, accountId: String(caller.Account), cluster },
  database,
  secrets,
  iam,
  queue,
  current,
  candidates,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${stableJson(snapshot)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`runtime-db-transition-snapshot-ok:${sha256(Buffer.from(stableJson(snapshot), "utf8"))}\n`);
