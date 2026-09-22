import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [rootArg, targetArg, outArg] = process.argv.slice(2);
if (!rootArg || !targetArg || !outArg) throw new Error("usage: node preflight-run.mjs <root> <target> <output-directory>");
const root = path.resolve(rootArg);
const target = path.resolve(targetArg);
const out = path.resolve(outArg);
const script = path.join(target, "infra/aws/ops/staging-plan-runtime-db-transition.ps1");
const contract = JSON.parse(fs.readFileSync(path.join(target, "infra/aws/ops/runtime-db-transition-contract.json"), "utf8"));
fs.mkdirSync(out, { recursive: false });

const account = "195748745315";
const region = "ap-northeast-2";
const appSecretArn = `arn:aws:secretsmanager:${region}:${account}:secret:mcm-ieps-staging/app-Ab12Cd`;
const dbAppArn = `arn:aws:secretsmanager:${region}:${account}:secret:mcm-ieps-staging/db-app-Q7x2Lm`;
const dbWorkerArn = `arn:aws:secretsmanager:${region}:${account}:secret:mcm-ieps-staging/db-worker-Z9y8Xw`;
const roleArn = name => `arn:aws:iam::${account}:role/${name}`;
const scheduleHash = value => createHash("sha256").update(stableCanonical(value)).digest("hex");
const scheduleNetwork = { awsvpcConfiguration: { AssignPublicIp: "ENABLED", SecurityGroups: ["sg-test"], Subnets: ["subnet-a", "subnet-b"] } };
const scheduleInput = { containerOverrides: [{ command: ["run", "batch"] }] };
const scheduleFields = name => ({ roleArn: roleArn(`${name}-events`), scheduleExpression: name.endsWith("adt-ingest") ? "rate(1 hour)" : "cron(0 18 * * ? *)", taskCount: 1, launchType: "FARGATE", networkConfigurationSha256: scheduleHash(scheduleNetwork), inputSha256: contract.scheduleApprovedInputSha256[name], platformVersion: null, enableExecuteCommand: null, propagateTags: null, ruleRoleArn: null, retryPolicySha256: null, deadLetterConfigSha256: null });
const capturedAt = process.env.R0B_CAPTURED_AT || new Date().toISOString();
const captureFinishedAt = new Date(capturedAt).toISOString();
const captureStartedAt = new Date(Date.parse(captureFinishedAt) - 30_000).toISOString();
const factTime = offsetMs => new Date(Date.parse(captureStartedAt) + offsetMs).toISOString();

function environment(values) {
  return Object.entries(values).map(([name, value]) => ({ name, value }));
}

function stableCanonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCanonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableCanonical(value[key])}`).join(",")}}`;
}

function sortCanonical(values) {
  return [...(values ?? [])].sort((left, right) => Buffer.compare(Buffer.from(stableCanonical(left)), Buffer.from(stableCanonical(right))));
}

function normalizeTaskForHash(definition) {
  const copy = structuredClone(definition);
  for (const name of ["requiresCompatibilities", "placementConstraints", "volumes", "inferenceAccelerators", "tags"]) {
    if (Array.isArray(copy[name])) copy[name] = sortCanonical(copy[name]);
  }
  if (Array.isArray(copy.proxyConfiguration?.properties)) copy.proxyConfiguration.properties = sortCanonical(copy.proxyConfiguration.properties);
  for (const container of copy.containerDefinitions ?? []) {
    for (const name of ["environment", "secrets", "portMappings", "mountPoints", "volumesFrom", "ulimits", "dependsOn", "systemControls", "extraHosts", "resourceRequirements", "dockerSecurityOptions"]) {
      if (Array.isArray(container[name])) container[name] = sortCanonical(container[name]);
    }
    for (const name of ["add", "drop"]) {
      if (Array.isArray(container.linuxParameters?.capabilities?.[name])) container.linuxParameters.capabilities[name] = sortCanonical(container.linuxParameters.capabilities[name]);
    }
    if (Array.isArray(container.linuxParameters?.devices)) {
      for (const device of container.linuxParameters.devices) if (Array.isArray(device.permissions)) device.permissions = sortCanonical(device.permissions);
      container.linuxParameters.devices = sortCanonical(container.linuxParameters.devices);
    }
    if (Array.isArray(container.linuxParameters?.tmpfs)) {
      for (const tmpfs of container.linuxParameters.tmpfs) if (Array.isArray(tmpfs.mountOptions)) tmpfs.mountOptions = sortCanonical(tmpfs.mountOptions);
      container.linuxParameters.tmpfs = sortCanonical(container.linuxParameters.tmpfs);
    }
    if (Array.isArray(container.logConfiguration?.secretOptions)) container.logConfiguration.secretOptions = sortCanonical(container.logConfiguration.secretOptions);
  }
  copy.containerDefinitions = sortCanonical(copy.containerDefinitions);
  return stableCanonical(copy);
}

const sha256 = value => createHash("sha256").update(value).digest("hex");

function currentNext() {
  return {
    taskDefinitionArn: `arn:aws:ecs:${region}:${account}:task-definition/mcm-ieps-staging-next:41`,
    revision: 41,
    status: "ACTIVE",
    family: "mcm-ieps-staging-next",
    taskRoleArn: roleArn("mcm-ieps-staging-ecs-task"),
    executionRoleArn: roleArn("mcm-ieps-staging-ecs-execution"),
    networkMode: "awsvpc",
    cpu: "512",
    memory: "1024",
    requiresCompatibilities: ["FARGATE"],
    containerDefinitions: [{
      name: "next",
      image: "195748745315.dkr.ecr.ap-northeast-2.amazonaws.com/mcm-ieps-staging-next:r0b-source",
      essential: true,
      command: ["node", "server.js"],
      environment: environment({ NODE_ENV: "production", PGHOST: "db.example", PGPORT: "5432", PGDATABASE: "mcm", MCM_FACILITY_QUALITY_WORKER_READY: "true" }),
      secrets: [
        { name: "AUTH_SECRET", valueFrom: `${appSecretArn}:AUTH_SECRET::` },
        { name: "PGUSER", valueFrom: "arn:aws:secretsmanager:ap-northeast-2:195748745315:secret:rds!cluster-old:username::" },
        { name: "PGPASSWORD", valueFrom: "arn:aws:secretsmanager:ap-northeast-2:195748745315:secret:rds!cluster-old:password::" },
      ],
      logConfiguration: { logDriver: "awslogs", options: { "awslogs-group": "/ecs/mcm-next", "awslogs-region": region, "awslogs-stream-prefix": "next" } },
    }],
  };
}

function candidateNext() {
  const value = structuredClone(currentNext());
  delete value.taskDefinitionArn;
  delete value.revision;
  delete value.status;
  value.executionRoleArn = roleArn("mcm-ieps-staging-ecs-execution-next");
  value.containerDefinitions[0].environment.push(
    { name: "PGSSL", value: "require" },
    { name: "PGSSL_REJECT_UNAUTHORIZED", value: "true" },
    { name: "MCM_DB_ROLE_REQUIRED", value: "true" },
    { name: "MCM_DB_EXPECTED_ROLE", value: "mcm_app" },
  );
  value.containerDefinitions[0].environment.find(item => item.name === "MCM_FACILITY_QUALITY_WORKER_READY").value = "false";
  value.containerDefinitions[0].secrets = [
    { name: "AUTH_SECRET", valueFrom: `${appSecretArn}:AUTH_SECRET::` },
    { name: "PGUSER", valueFrom: `${dbAppArn}:username::` },
    { name: "PGPASSWORD", valueFrom: `${dbAppArn}:password::` },
  ];
  return value;
}

function currentWorker() {
  return {
    taskDefinitionArn: `arn:aws:ecs:${region}:${account}:task-definition/mcm-ieps-staging-worker:12`,
    revision: 12,
    status: "ACTIVE",
    family: "mcm-ieps-staging-worker",
    taskRoleArn: roleArn("mcm-ieps-staging-ecs-task"),
    executionRoleArn: roleArn("mcm-ieps-staging-ecs-execution"),
    networkMode: "awsvpc",
    cpu: "1024",
    memory: "3072",
    requiresCompatibilities: ["FARGATE"],
    containerDefinitions: [{
      name: "worker",
      image: "195748745315.dkr.ecr.ap-northeast-2.amazonaws.com/mcm-ieps-staging-worker:r0b-source",
      essential: true,
      command: ["npm", "run", "worker:aws"],
      environment: environment({ AWS_REGION: region, PGHOST: "db.example", PGPORT: "5432", PGDATABASE: "mcm" }),
      secrets: [
        { name: "DART_API_KEY", valueFrom: `${appSecretArn}:DART_API_KEY::` },
        { name: "PGUSER", valueFrom: "arn:aws:secretsmanager:ap-northeast-2:195748745315:secret:rds!cluster-old:username::" },
        { name: "PGPASSWORD", valueFrom: "arn:aws:secretsmanager:ap-northeast-2:195748745315:secret:rds!cluster-old:password::" },
      ],
    }],
  };
}

function candidateWorker() {
  const value = structuredClone(currentWorker());
  delete value.taskDefinitionArn;
  delete value.revision;
  delete value.status;
  value.taskRoleArn = roleArn("mcm-ieps-staging-ecs-task-worker");
  value.executionRoleArn = roleArn("mcm-ieps-staging-ecs-execution-worker");
  value.containerDefinitions[0].environment.push(
    { name: "PGSSL", value: "require" },
    { name: "PGSSL_REJECT_UNAUTHORIZED", value: "true" },
    { name: "MCM_DB_ROLE_REQUIRED", value: "true" },
    { name: "MCM_DB_EXPECTED_ROLE", value: "mcm_worker" },
  );
  value.containerDefinitions[0].secrets = [
    { name: "DART_API_KEY", valueFrom: `${appSecretArn}:DART_API_KEY::` },
    { name: "PGUSER", valueFrom: `${dbWorkerArn}:username::` },
    { name: "PGPASSWORD", valueFrom: `${dbWorkerArn}:password::` },
  ];
  return value;
}

function baseSnapshot() {
  const next = currentNext();
  return {
    version: "r0b2b-runtime-transition-snapshot-v4",
    generatedAt: capturedAt,
    collector: {
      name: "staging-collect-runtime-db-transition",
      version: "r0b2b-runtime-transition-collector-v5",
      principal: `arn:aws:sts::${account}:assumed-role/AWSReservedSSO_AdministratorAccess_b2a94913dfd435bd/local-review`,
    },
    captureWindow: { startedAt: captureStartedAt, finishedAt: captureFinishedAt },
    factCapturedAt: {
      database: factTime(2_000),
      secrets: factTime(7_000),
      iam: factTime(12_000),
      queue: factTime(17_000),
      current: factTime(22_000),
      candidates: factTime(27_000),
    },
    aws: { partition: "aws", region, accountId: account, cluster: "mcm-ieps-staging" },
    database: {
      name: "mcm",
      proofVersion: "r0b-runtime-roles-v2",
      roles: { app: { name: "mcm_app", login: true }, worker: { name: "mcm_worker", login: true } },
      collectorExists: false,
      masterRuntimeSessionCount: 0,
    },
    secrets: {
      app: { arn: dbAppArn, username: "mcm_app", passwordPresent: true, currentVersionCount: 1, currentVersionId: "11111111-1111-4111-8111-111111111111", pendingVersionCount: 0, pendingVersionIds: [] },
      worker: { arn: dbWorkerArn, username: "mcm_worker", passwordPresent: true, currentVersionCount: 1, currentVersionId: "22222222-2222-4222-8222-222222222222", pendingVersionCount: 0, pendingVersionIds: [] },
    },
    iam: {
      legacyPassRoleEnabled: true,
      currentAndCandidateRolesCovered: true,
      inlinePolicies: [
        { roleName: "mcm-ieps-staging-ecs-task", policyName: "mcm-ieps-staging-facility-quality-worker-start", documentSha256: "a".repeat(64) },
        { roleName: "mcm-ieps-staging-adt-ingest-events", policyName: "mcm-ieps-staging-adt-ingest-events", documentSha256: "b".repeat(64) },
        { roleName: "mcm-ieps-staging-intel-batch-events", policyName: "mcm-ieps-staging-intel-batch-events", documentSha256: "c".repeat(64) },
      ],
    },
    queue: {
      name: "mcm-ieps-staging-jobs",
      retentionSeconds: 1209600,
      visibleMessages: 0,
      notVisibleMessages: 0,
      oldestMessageAgeSeconds: 0,
      dlqVisibleMessages: 0,
      dlqNotVisibleMessages: 0,
      runningWorkerTasks: 0,
      publishedLast5Minutes: 0,
    },
    current: {
      nextTaskDefinition: next,
      workerTaskDefinition: currentWorker(),
      nextService: { name: "mcm-ieps-staging-next", taskDefinitionArn: next.taskDefinitionArn, desiredCount: 1, runningCount: 1, pendingCount: 0, deployments: [{ id: "ecs-svc/9223372036854775001", createdAt: factTime(20_000), status: "PRIMARY", rolloutState: "COMPLETED" }] },
      schedules: [
        { name: "mcm-ieps-staging-adt-ingest", state: "ENABLED", taskDefinitionArn: next.taskDefinitionArn, targetId: "adt-ingest", eventBusName: "default", ...scheduleFields("mcm-ieps-staging-adt-ingest") },
        { name: "mcm-ieps-staging-intel-batch", state: "ENABLED", taskDefinitionArn: next.taskDefinitionArn, targetId: "intel-batch", eventBusName: "default", ...scheduleFields("mcm-ieps-staging-intel-batch") },
      ],
    },
    candidates: { nextTaskDefinition: candidateNext(), workerTaskDefinition: candidateWorker() },
  };
}

function runCase(id, mutate, expectedSuccess, expectedPattern = null) {
  const snapshot = baseSnapshot();
  mutate?.(snapshot);
  const snapshotPath = path.join(out, `${id}-snapshot.json`);
  const planPath = path.join(out, `${id}-plan.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n");
  const shell = process.env.R0B_POWERSHELL || "powershell.exe";
  const run = spawnSync(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-SnapshotJson", snapshotPath, "-OutputPath", planPath], { encoding: "utf8" });
  if (expectedSuccess) {
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
    assert.equal(plan.ready, true);
    assert.equal(plan.version, "r0b2b-runtime-transition-plan-v4");
    assert.equal(plan.phases.length, 9);
    assert.equal(plan.current.schedules.length, 2);
    assert.equal(plan.collector.name, "staging-collect-runtime-db-transition");
    assert.equal(Date.parse(plan.captureWindow.facts.queue), Date.parse(snapshot.factCapturedAt.queue));
    assert.equal(plan.secretVersions.app.currentVersionId, snapshot.secrets.app.currentVersionId);
    assert.equal(plan.secretVersions.worker.currentVersionId, snapshot.secrets.worker.currentVersionId);
    assert.equal(plan.secretVersions.app.pendingVersionCount, 0);
    assert.equal(plan.secretVersions.worker.pendingVersionCount, 0);
    assert.equal(plan.current.nextDeployment.id, snapshot.current.nextService.deployments[0].id);
    assert.equal(Date.parse(plan.current.nextDeployment.createdAt), Date.parse(snapshot.current.nextService.deployments[0].createdAt));
    assert.equal(plan.current.schedules[0].targetId, snapshot.current.schedules.find(item => item.name === plan.current.schedules[0].name).targetId);
    assert.equal(plan.iamPolicies.length, 3);
    assert.deepEqual(plan.iamPolicies.map(item => item.documentSha256).sort(), snapshot.iam.inlinePolicies.map(item => item.documentSha256).sort());
    assert.ok(!JSON.stringify(plan).includes("r0b-source"));
    assert.ok(!JSON.stringify(plan).toLowerCase().includes("passwordpresent"));
    assert.ok(!JSON.stringify(plan).includes(dbAppArn));
    assert.ok(!JSON.stringify(plan).includes(dbWorkerArn));
    return { id, passed: true, expected: "success", planSha: plan.sourceSnapshotSha256 };
  }
  assert.notEqual(run.status, 0, `${id} unexpectedly succeeded`);
  const message = `${run.stdout}\n${run.stderr}`;
  if (expectedPattern) assert.match(message, expectedPattern);
  assert.equal(fs.existsSync(planPath), false, `${id} wrote a plan after rejection`);
  return { id, passed: true, expected: "rejection", matched: expectedPattern?.source ?? "nonzero exit" };
}

const cases = [];
cases.push(runCase("TP-01", null, true));
cases.push(runCase("TP-02", s => { s.candidates.nextTaskDefinition.containerDefinitions[0].image += "-drift"; }, false, /outside the approved/));
cases.push(runCase("TP-03", s => { s.candidates.workerTaskDefinition.containerDefinitions[0].command = ["echo", "drift"]; }, false, /outside the approved/));
cases.push(runCase("TP-04", s => { s.candidates.nextTaskDefinition.containerDefinitions[0].secrets.find(x => x.name === "PGPASSWORD").valueFrom = "arn:aws:secretsmanager:ap-northeast-2:195748745315:secret:rds!cluster-master:password::"; }, false, /expected role-specific DB secret/));
cases.push(runCase("TP-05", s => { s.candidates.nextTaskDefinition.containerDefinitions[0].secrets.find(x => x.name === "AUTH_SECRET").valueFrom = `${dbAppArn}:AUTH_SECRET::`; }, false, /approved application secret/));
cases.push(runCase("TP-06", s => { s.candidates.nextTaskDefinition.containerDefinitions.push({ name: "leak", image: "x", environment: [], secrets: [{ name: "PGPASSWORD", valueFrom: `${dbAppArn}:password::` }] }); }, false, /unapproved sidecar/));
cases.push(runCase("TP-07", s => { s.candidates.nextTaskDefinition.containerDefinitions[0].environment.find(x => x.name === "MCM_FACILITY_QUALITY_WORKER_READY").value = "true"; }, false, /worker feature disabled/));
cases.push(runCase("TP-08", s => { s.database.proofVersion = "r0b-runtime-roles-v1"; }, false, /proof version/));
cases.push(runCase("TP-09", s => { s.database.collectorExists = true; }, false, /must not exist/));
cases.push(runCase("TP-10", s => { s.database.masterRuntimeSessionCount = 1; }, false, /master runtime sessions/));
cases.push(runCase("TP-11", s => { s.secrets.app.passwordPresent = false; }, false, /password is missing/));
cases.push(runCase("TP-12", s => { s.secrets.worker.pendingVersionCount = 1; }, false, /AWSPENDING/));
cases.push(runCase("TP-13", s => { s.iam.legacyPassRoleEnabled = false; }, false, /PassRole transition window/));
cases.push(runCase("TP-14", s => { s.current.nextService.pendingCount = 1; }, false, /pending tasks/));
cases.push(runCase("TP-15", s => { s.current.nextService.deployments.push({ ...s.current.nextService.deployments[0], id: "ecs-svc/9223372036854775002", status: "ACTIVE" }); }, false, /multiple deployments/));
cases.push(runCase("TP-16", s => { s.current.schedules[0].taskDefinitionArn = `arn:aws:ecs:${region}:${account}:task-definition/mcm-ieps-staging-next`; }, false, /not pinned/));
cases.push(runCase("TP-17", s => { s.current.schedules.pop(); }, false, /schedule set mismatch/));
cases.push(runCase("TP-18", s => { s.queue.retentionSeconds = 604800; }, false, /queue retention/));
cases.push(runCase("TP-19", s => { s.aws.accountId = "000000000000"; }, false, /AWS account/));
cases.push(runCase("TP-20", s => { s.candidates.workerTaskDefinition.containerDefinitions[0].environment.find(x => x.name === "PGSSL").value = "disable"; }, false, /PGSSL must be require/));
cases.push(runCase("TP-21", s => { s.candidates.workerTaskDefinition.containerDefinitions[0].environment.push({ name: "DATABASE_URL", value: "postgres://master" }); }, false, /DATABASE_URL is forbidden/));
cases.push(runCase("TP-22", s => { s.candidates.workerTaskDefinition.family = "mcm-ieps-staging-worker-shadow"; }, false, /family mismatch/));
cases.push(runCase("TP-23", s => {
  s.candidates.nextTaskDefinition.containerDefinitions[0].environment.reverse();
  s.candidates.nextTaskDefinition.containerDefinitions[0].secrets.reverse();
  s.candidates.workerTaskDefinition.containerDefinitions[0].environment.reverse();
  s.candidates.workerTaskDefinition.containerDefinitions[0].secrets.reverse();
}, true));

cases.push(runCase("TP-24", s => { s.current.nextService.deployments[0].rolloutState = "FAILED"; }, false, /primary deployment is not completed/));
cases.push(runCase("TP-25", s => { s.current.schedules[0].state = "DISABLED"; }, false, /must be enabled/));
cases.push(runCase("TP-26", s => { s.queue.visibleMessages = 1; }, false, /visible queue backlog/));
cases.push(runCase("TP-27", s => { s.queue.notVisibleMessages = 1; s.queue.oldestMessageAgeSeconds = 60; }, false, /in-flight queue work/));
cases.push(runCase("TP-28", s => { s.queue.dlqVisibleMessages = 1; }, false, /DLQ must be empty/));
cases.push(runCase("TP-29", s => { s.queue.runningWorkerTasks = 1; }, false, /worker tasks must be stopped/));
cases.push(runCase("TP-30", s => { s.queue.publishedLast5Minutes = 1; }, false, /publishers must be quiescent/));
cases.push(runCase("TP-31", s => {
  s.current.workerTaskDefinition.containerDefinitions[0].environment.push({ name: "MCM_FACILITY_QUALITY_WORKER_READY", value: "false" });
  s.candidates.workerTaskDefinition.containerDefinitions[0].environment.push({ name: "MCM_FACILITY_QUALITY_WORKER_READY", value: "false" });
}, false, /worker candidate must not carry/));
cases.push(runCase("TP-32", s => {
  s.generatedAt = "2001-01-01T00:00:30.000Z";
  s.captureWindow = { startedAt: "2001-01-01T00:00:00.000Z", finishedAt: "2001-01-01T00:00:30.000Z" };
  for (const name of Object.keys(s.factCapturedAt)) s.factCapturedAt[name] = "2001-01-01T00:00:15.000Z";
}, false, /older than the allowed/));
cases.push(runCase("TP-33", s => { s.unexpected = true; }, false, /property set mismatch/));
cases.push(runCase("TP-34", s => {
  for (const definition of [s.current.nextTaskDefinition, s.candidates.nextTaskDefinition]) {
    definition.containerDefinitions[0].environment.push({ name: "STABLE_JSON_PROBE", value: "<>&'" });
  }
  for (const definition of [s.current.workerTaskDefinition, s.candidates.workerTaskDefinition]) {
    definition.containerDefinitions[0].environment.push({ name: "STABLE_JSON_PROBE", value: "<>&'" });
  }
}, true));

const orderedPlan = JSON.parse(fs.readFileSync(path.join(out, "TP-01-plan.json"), "utf8"));
const reorderedPlan = JSON.parse(fs.readFileSync(path.join(out, "TP-23-plan.json"), "utf8"));
assert.equal(reorderedPlan.candidates.nextTaskDefinitionSha256, orderedPlan.candidates.nextTaskDefinitionSha256);
assert.equal(reorderedPlan.candidates.workerTaskDefinitionSha256, orderedPlan.candidates.workerTaskDefinitionSha256);
cases.push({ id: "TP-35", passed: true, expected: "equivalent candidate hashes", nextSha: orderedPlan.candidates.nextTaskDefinitionSha256, workerSha: orderedPlan.candidates.workerTaskDefinitionSha256 });

cases.push(runCase("TP-36", s => { s.collector.name = "unknown-collector"; }, false, /collector name mismatch/));
cases.push(runCase("TP-37", s => { s.collector.principal = "arn:aws:iam::000000000000:role/AWSReservedSSO_AdministratorAccess_b2a94913dfd435bd"; }, false, /collector principal mismatch/));
cases.push(runCase("TP-38", s => { s.captureWindow.startedAt = new Date(Date.parse(s.captureWindow.finishedAt) - 61_000).toISOString(); }, false, /capture window is too wide/));
cases.push(runCase("TP-39", s => { s.factCapturedAt.queue = new Date(Date.parse(s.captureWindow.startedAt) - 1).toISOString(); }, false, /fact 'queue' was captured outside/));
cases.push(runCase("TP-40", s => { s.generatedAt = new Date(Date.parse(s.captureWindow.finishedAt) - 1).toISOString(); }, false, /generatedAt precedes/));
cases.push(runCase("TP-41", s => { s.generatedAt = new Date(Date.parse(s.captureWindow.finishedAt) + 31_000).toISOString(); }, false, /generation was delayed/));
cases.push(runCase("TP-42", s => { s.collector.extra = true; }, false, /snapshot.collector property set mismatch/));
const addUnorderedArrays = (definition, reverse) => {
    const c = definition.containerDefinitions[0];
    c.ulimits = [{ name: "nofile", softLimit: 1024, hardLimit: 2048 }, { name: "nproc", softLimit: 512, hardLimit: 1024 }];
    c.dependsOn = [{ containerName: "config", condition: "SUCCESS" }, { containerName: "proxy", condition: "HEALTHY" }];
    c.systemControls = [{ namespace: "net.ipv4.tcp_keepalive_time", value: "60" }, { namespace: "net.core.somaxconn", value: "1024" }];
    c.extraHosts = [{ hostname: "a.local", ipAddress: "10.0.0.1" }, { hostname: "b.local", ipAddress: "10.0.0.2" }];
    c.linuxParameters = { capabilities: { add: ["SYS_PTRACE", "NET_ADMIN"], drop: ["MKNOD", "SETUID"] } };
    c.logConfiguration ??= { logDriver: "awslogs", options: {} };
    c.logConfiguration.secretOptions = [{ name: "LOG_ALPHA", valueFrom: `${appSecretArn}:LOG_ALPHA::` }, { name: "LOG_BETA", valueFrom: `${appSecretArn}:LOG_BETA::` }];
    if (reverse) {
      c.ulimits.reverse(); c.dependsOn.reverse(); c.systemControls.reverse(); c.extraHosts.reverse();
      c.linuxParameters.capabilities.add.reverse(); c.linuxParameters.capabilities.drop.reverse(); c.logConfiguration.secretOptions.reverse();
    }
};
cases.push(runCase("TP-43", s => {
  for (const definition of [s.current.nextTaskDefinition, s.candidates.nextTaskDefinition, s.current.workerTaskDefinition, s.candidates.workerTaskDefinition]) addUnorderedArrays(definition, false);
}, true));
cases.push(runCase("TP-44", s => {
  for (const definition of [s.current.nextTaskDefinition, s.candidates.nextTaskDefinition, s.current.workerTaskDefinition, s.candidates.workerTaskDefinition]) addUnorderedArrays(definition, true);
}, true));
cases.push(runCase("TP-45", s => {
  s.candidates.nextTaskDefinition.containerDefinitions[0].command.reverse();
}, false, /outside the approved/));
cases.push(runCase("TP-46", s => {
  s.current.nextTaskDefinition.containerDefinitions[0].command.reverse();
  s.candidates.nextTaskDefinition.containerDefinitions[0].command.reverse();
}, true));
cases.push(runCase("TP-47", s => { s.collector.principal = `arn:aws:sts::${account}:role/not-an-sts-principal`; }, false, /collector principal mismatch/));
cases.push(runCase("TP-48", s => { s.collector.principal = `arn:aws:sts::${account}:assumed-role/AWSReservedSSO_AdministratorAccess_b2a94913dfd435bd/session-01`; }, true));
cases.push(runCase("P1-old-placeholder-role-rejected", s => { s.collector.principal = `arn:aws:sts::${account}:assumed-role/mcm-ieps-staging-deployment-operator/session-01`; }, false, /collector principal mismatch/));
cases.push(runCase("TP-49", s => {
  const finish = Date.parse(capturedAt) + 600_000;
  s.captureWindow = { startedAt: new Date(finish - 30_000).toISOString(), finishedAt: new Date(finish).toISOString() };
  s.generatedAt = new Date(finish).toISOString();
  for (const name of Object.keys(s.factCapturedAt)) s.factCapturedAt[name] = new Date(finish - 15_000).toISOString();
}, false, /capture time is too far in the future/));
cases.push(runCase("TP-50", s => {
  const finish = Date.parse(capturedAt) + 20_000;
  s.captureWindow = { startedAt: new Date(finish - 10_000).toISOString(), finishedAt: new Date(finish).toISOString() };
  s.generatedAt = new Date(finish).toISOString();
  for (const name of Object.keys(s.factCapturedAt)) s.factCapturedAt[name] = new Date(finish - 5_000).toISOString();
}, true));
cases.push(runCase("TP-51", s => { s.captureWindow.startedAt = new Date(Date.parse(s.captureWindow.finishedAt) + 1_000).toISOString(); }, false, /capture window is reversed/));
cases.push(runCase("TP-52", s => {
  const finish = Date.parse(s.captureWindow.finishedAt);
  s.captureWindow.startedAt = new Date(finish - 60_000).toISOString();
  for (const name of Object.keys(s.factCapturedAt)) s.factCapturedAt[name] = new Date(finish - 30_000).toISOString();
}, true));
cases.push(runCase("TP-53", s => {
  const base = Date.now();
  s.captureWindow = { startedAt: new Date(base).toISOString(), finishedAt: new Date(base + 40_000).toISOString() };
  s.generatedAt = new Date(base + 40_000).toISOString();
  for (const name of Object.keys(s.factCapturedAt)) s.factCapturedAt[name] = new Date(base + 20_000).toISOString();
}, false, /capture completion is too far in the future/));
cases.push(runCase("TP-54", s => { s.collector.principal += "\n"; }, false, /collector principal mismatch/));
cases.push(runCase("TP-55", s => { s.collector.principal = `arn:aws:sts::${account}:assumed-role/AWSReservedSSO_AdministratorAccess_b2a94913dfd435bd`; }, false, /collector principal mismatch/));
cases.push(runCase("TP-56", s => { s.current.nextService.taskDefinitionArn += "\"injected"; }, false, /not pinned to an approved revision/));
cases.push(runCase("TP-57", s => { s.current.nextService.taskDefinitionArn += "\\injected"; }, false, /not pinned to an approved revision/));
cases.push(runCase("TP-58", s => {
  for (const definition of [s.current.nextTaskDefinition, s.candidates.nextTaskDefinition, s.current.workerTaskDefinition, s.candidates.workerTaskDefinition]) addUnorderedArrays(definition, false);
}, true));
cases.push(runCase("TP-59", s => {
  for (const definition of [s.current.nextTaskDefinition, s.candidates.nextTaskDefinition, s.current.workerTaskDefinition, s.candidates.workerTaskDefinition]) addUnorderedArrays(definition, true);
}, true));
cases.push(runCase("TP-60", s => {
  addUnorderedArrays(s.current.nextTaskDefinition, false);
  addUnorderedArrays(s.candidates.nextTaskDefinition, true);
  addUnorderedArrays(s.current.workerTaskDefinition, true);
  addUnorderedArrays(s.candidates.workerTaskDefinition, false);
}, true));
cases.push(runCase("TP-61", s => {
  for (const definition of [s.current.nextTaskDefinition, s.candidates.nextTaskDefinition, s.current.workerTaskDefinition, s.candidates.workerTaskDefinition]) {
    definition.containerDefinitions[0].environment.push({ name: "Probe", value: "upper" }, { name: "probe", value: "lower" });
  }
}, true));
cases.push(runCase("TP-62", s => {
  for (const definition of [s.current.nextTaskDefinition, s.candidates.nextTaskDefinition, s.current.workerTaskDefinition, s.candidates.workerTaskDefinition]) {
    definition.containerDefinitions[0].environment.push({ name: "probe", value: "lower" }, { name: "Probe", value: "upper" });
  }
}, true));
cases.push(runCase("TP-63", s => { s.secrets.app.currentVersionId = "too-short"; }, false, /AWSCURRENT version ID is invalid/));
cases.push(runCase("TP-64", s => { s.secrets.worker.pendingVersionIds = ["33333333-3333-4333-8333-333333333333"]; }, false, /pending version metadata mismatch/));
cases.push(runCase("TP-65", s => {
  const probe = "a\"b\\c\t\u0001\b\n\r\f";
  for (const definition of [s.current.nextTaskDefinition, s.candidates.nextTaskDefinition, s.current.workerTaskDefinition, s.candidates.workerTaskDefinition]) {
    definition.containerDefinitions[0].environment.push({ name: "CANONICAL_PROBE", value: probe });
  }
}, true));
cases.push(runCase("TP-66", s => { s.secrets.app.arn += "\n"; }, false, /secret ARN mismatch/));
cases.push(runCase("TP-67", s => { s.current.nextService.taskDefinitionArn += "\n"; s.current.nextTaskDefinition.taskDefinitionArn += "\n"; }, false, /not pinned to an approved revision/));
cases.push(runCase("TP-68", s => { s.current.schedules[0].taskDefinitionArn += "\n"; }, false, /not pinned to a Next revision/));
cases.push(runCase("TP-69", s => { s.collector.principal = `arn:aws:sts::${account}:assumed-role/collector/session/extra`; }, false, /collector principal mismatch/));
cases.push(runCase("TP-70", s => { s.current.nextTaskDefinition.containerDefinitions[0].environment.push({ name: "INVALID_UNICODE", value: "\ud800" }); }, false, /invalid Unicode surrogate/));
cases.push(runCase("TP-71", s => { s.current.nextTaskDefinition.containerDefinitions[0].environment.push({ name: "INVALID_UNICODE", value: "\udc00" }); }, false, /invalid Unicode surrogate/));
cases.push(runCase("TP-72", s => {
  for (const definition of [s.current.nextTaskDefinition, s.candidates.nextTaskDefinition, s.current.workerTaskDefinition, s.candidates.workerTaskDefinition]) definition.containerDefinitions[0].environment.push({ name: "VALID_UNICODE", value: "😀" });
}, true));
cases.push(runCase("TP-73", s => { s.current.nextService.deployments[0].id = "deployment/invalid"; }, false, /deployment ID is invalid/));
cases.push(runCase("TP-74", s => { s.current.schedules[0].targetId += "\n"; }, false, /target ID is invalid/));
cases.push(runCase("TP-75", s => { s.iam.inlinePolicies[0].policyName = "unexpected"; }, false, /policy set mismatch/));
cases.push(runCase("TP-76", s => { s.iam.inlinePolicies[0].documentSha256 = "A".repeat(64); }, false, /policy document hash is invalid/));
cases.push(runCase("TP-77", s => { s.current.nextService.deployments[0].createdAt = new Date(Date.parse(s.captureWindow.finishedAt) + 31_000).toISOString(); }, false, /deployment timestamp is too far in the future/));
cases.push(runCase("TP-78", s => {
  for (const definition of [s.current.nextTaskDefinition, s.candidates.nextTaskDefinition, s.current.workerTaskDefinition, s.candidates.workerTaskDefinition]) definition.containerDefinitions[0].environment.push({ name: "LITERAL_ESCAPE_TEXT", value: "\\ud800" });
}, true));
{
  const id = "TP-79";
  const snapshot = baseSnapshot();
  for (const definition of [snapshot.current.nextTaskDefinition, snapshot.candidates.nextTaskDefinition, snapshot.current.workerTaskDefinition, snapshot.candidates.workerTaskDefinition]) definition.containerDefinitions[0].environment.push({ name: "ESCAPED_PAIR", value: "PAIR_SENTINEL" });
  const snapshotPath = path.join(out, `${id}-snapshot.json`);
  const planPath = path.join(out, `${id}-plan.json`);
  const raw = (JSON.stringify(snapshot, null, 2) + "\n").replaceAll('"PAIR_SENTINEL"', '"\\ud83d\\ude00"');
  fs.writeFileSync(snapshotPath, raw);
  const shell = process.env.R0B_POWERSHELL || "powershell.exe";
  const run = spawnSync(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-SnapshotJson", snapshotPath, "-OutputPath", planPath], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  JSON.parse(fs.readFileSync(planPath, "utf8"));
  cases.push({ id, passed: true, expected: "success with escaped surrogate pair" });
}
cases.push(runCase("TP-80", s => { s.current.schedules[0].eventBusName += "\n"; }, false, /event bus name is invalid/));
cases.push(runCase("TP-81", s => { s.candidates.nextTaskDefinition.containerDefinitions[0].environment.push({ name: "PG_POOL_MAX", value: "10\n" }); }, false, /PG_POOL_MAX must be an integer/));
cases.push(runCase("TP-82", s => { s.candidates.nextTaskDefinition.containerDefinitions[0].environment.push({ name: "PG_POOL_MAX", value: "10\r" }); }, false, /PG_POOL_MAX must be an integer/));
cases.push(runCase("TP-83", s => { s.candidates.nextTaskDefinition.containerDefinitions[0].secrets.find(x => x.name === "PGUSER").valueFrom += "\n"; }, false, /expected role-specific DB secret/));
cases.push(runCase("TP-84", s => { s.candidates.nextTaskDefinition.containerDefinitions[0].secrets.find(x => x.name === "PGPASSWORD").valueFrom += "\n"; }, false, /expected role-specific DB secret/));
cases.push(runCase("TP-85", s => { s.candidates.nextTaskDefinition.containerDefinitions[0].secrets.find(x => x.name === "AUTH_SECRET").valueFrom += "\n"; }, false, /approved application secret/));
cases.push(runCase("TP-86", s => { s.candidates.workerTaskDefinition.containerDefinitions[0].secrets.find(x => x.name === "PGUSER").valueFrom += "\r"; }, false, /expected role-specific DB secret/));
cases.push(runCase("TP-87", s => { s.candidates.workerTaskDefinition.containerDefinitions[0].secrets.find(x => x.name === "PGPASSWORD").valueFrom += "\r"; }, false, /expected role-specific DB secret/));
cases.push(runCase("TP-88", s => { s.candidates.workerTaskDefinition.containerDefinitions[0].secrets.find(x => x.name === "DART_API_KEY").valueFrom += "\r"; }, false, /approved application secret/));
cases.push(runCase("TP-89", s => { delete s.current.schedules[0].roleArn; }, false, /property set mismatch/));
cases.push(runCase("TP-90", s => { s.current.schedules[0].roleArn = roleArn("other-events"); }, false, /execution role mismatch/));
cases.push(runCase("TP-91", s => { s.current.schedules[0].taskCount = 0; }, false, /task count is invalid/));
cases.push(runCase("TP-92", s => { s.current.schedules[0].launchType = "EC2"; }, false, /launch type mismatch/));
cases.push(runCase("TP-93", s => { s.current.schedules[0].networkConfigurationSha256 = "x"; }, false, /network digest is invalid/));
cases.push(runCase("TP-94", s => { s.current.schedules[0].inputSha256 = "x"; }, false, /input digest is invalid/));
cases.push(runCase("TP-95", s => { s.current.schedules[0].scheduleExpression = ""; }, false, /expression is missing/));
cases.push(runCase("TP-96", s => { s.current.schedules[0].ruleRoleArn = roleArn("other"); }, false, /unsupported settings must be null/));
cases.push(runCase("TP-97", s => { s.current.schedules[0].enableExecuteCommand = "false"; }, false, /execute-command flag is invalid/));
cases.push(runCase("TP-98", s => { s.current.schedules[0].scheduleExpression = "rate(2 hours)"; }, false, /expression differs from approved rule/));

const extendedPlan = JSON.parse(fs.readFileSync(path.join(out, "TP-58-plan.json"), "utf8"));
const extendedReversedPlan = JSON.parse(fs.readFileSync(path.join(out, "TP-59-plan.json"), "utf8"));
assert.equal(extendedPlan.candidates.nextTaskDefinitionSha256, extendedReversedPlan.candidates.nextTaskDefinitionSha256);
assert.equal(extendedPlan.candidates.workerTaskDefinitionSha256, extendedReversedPlan.candidates.workerTaskDefinitionSha256);
const casePlan = JSON.parse(fs.readFileSync(path.join(out, "TP-61-plan.json"), "utf8"));
const caseReversedPlan = JSON.parse(fs.readFileSync(path.join(out, "TP-62-plan.json"), "utf8"));
assert.equal(casePlan.candidates.nextTaskDefinitionSha256, caseReversedPlan.candidates.nextTaskDefinitionSha256);
assert.equal(casePlan.candidates.workerTaskDefinitionSha256, caseReversedPlan.candidates.workerTaskDefinitionSha256);
const probeSnapshot = JSON.parse(fs.readFileSync(path.join(out, "TP-65-snapshot.json"), "utf8"));
const probePlan = JSON.parse(fs.readFileSync(path.join(out, "TP-65-plan.json"), "utf8"));
assert.equal(probePlan.candidates.nextTaskDefinitionSha256, sha256(normalizeTaskForHash(probeSnapshot.candidates.nextTaskDefinition)));
assert.equal(probePlan.candidates.workerTaskDefinitionSha256, sha256(normalizeTaskForHash(probeSnapshot.candidates.workerTaskDefinition)));

const unorderedPlan = JSON.parse(fs.readFileSync(path.join(out, "TP-43-plan.json"), "utf8"));
const unorderedReversedPlan = JSON.parse(fs.readFileSync(path.join(out, "TP-44-plan.json"), "utf8"));
assert.equal(unorderedPlan.candidates.nextTaskDefinitionSha256, unorderedReversedPlan.candidates.nextTaskDefinitionSha256);
assert.equal(unorderedPlan.candidates.workerTaskDefinitionSha256, unorderedReversedPlan.candidates.workerTaskDefinitionSha256);
const commandPlan = JSON.parse(fs.readFileSync(path.join(out, "TP-46-plan.json"), "utf8"));
assert.notEqual(commandPlan.candidates.nextTaskDefinitionSha256, orderedPlan.candidates.nextTaskDefinitionSha256);

const result = { complete: true, passed: cases.length, failed: 0, cases };
fs.writeFileSync(path.join(out, "preflight-result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ complete: true, passed: cases.length, failed: 0 }));
