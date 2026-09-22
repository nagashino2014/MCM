import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const [workspaceArg, outputArg] = process.argv.slice(2);
if (!workspaceArg || !outputArg || process.argv.length !== 4) throw new Error("usage: node cli-run.mjs <workspace> <new-output-file>");
const workspace = path.resolve(workspaceArg);
const contract = JSON.parse(await readFile(path.join(workspace, "infra/aws/ops/runtime-db-schedule-pin-contract-20260921.json"), "utf8"));
const cli = path.join(workspace, "infra/aws/ops/staging-pin-next-schedules.mjs");
const temporary = await mkdtemp(path.join(tmpdir(), "mcm-pin-cli-test-"));
const fixture = path.join(import.meta.dirname, "aws-fixture.mjs");
const statePath = path.join(temporary, "state.json");
const logPath = path.join(temporary, "calls.txt");
const recoveryPath = path.join(temporary, "recovery.json");
const familyArn = `arn:${contract.partition}:ecs:${contract.region}:${contract.accountId}:task-definition/${contract.components.next.family}`;
const revisionArn = `${familyArn}:42`;
const clusterArn = `arn:${contract.partition}:ecs:${contract.region}:${contract.accountId}:cluster/${contract.cluster}`;
const input = name => name.endsWith("adt-ingest")
  ? { containerOverrides: [{ name: "next", command: ["node", ".next/adt-ingest.cjs"], environment: [{ name: "ADT_INGEST_MODE", value: "db" }] }] }
  : { containerOverrides: [{ name: "next", command: ["node", ".next/intel-batch.cjs"] }] };
const state = {
  caller: { Account: contract.accountId },
  service: { services: [{ serviceName: contract.nextService, status: "ACTIVE", taskDefinition: revisionArn, desiredCount: 1, runningCount: 1, pendingCount: 0, deployments: [{ status: "PRIMARY", taskDefinition: revisionArn, rolloutState: "COMPLETED" }] }], failures: [] },
  newest: { taskDefinitionArns: [revisionArn] },
  rules: Object.fromEntries(contract.scheduleRules.map(name => [name, { Name: name, State: "ENABLED", EventBusName: "default", ScheduleExpression: contract.scheduleApprovedDefaults.expressions[name] }])),
  targets: Object.fromEntries(contract.scheduleRules.map((name, index) => [name, {
    Id: index ? "intel-batch" : "adt-ingest", Arn: clusterArn,
    RoleArn: `arn:${contract.partition}:iam::${contract.accountId}:role/${name}-events`,
    Input: JSON.stringify(input(name)),
    EcsParameters: { TaskDefinitionArn: familyArn, TaskCount: 1, LaunchType: "FARGATE", EnableECSManagedTags: false, EnableExecuteCommand: false,
      NetworkConfiguration: { awsvpcConfiguration: { Subnets: ["subnet-a", "subnet-b"], SecurityGroups: ["sg-a"], AssignPublicIp: "ENABLED" } } },
  }])),
};
await writeFile(statePath, JSON.stringify(state), { flag: "wx" });
await writeFile(logPath, "", { flag: "wx" });
const env = { ...process.env, PATH: temporary, MCM_RUNTIME_TRANSITION_TEST_ADAPTERS: "1", NODE_ENV: "test", MCM_SCHEDULE_PIN_AWS_COMMAND_JSON: JSON.stringify([process.execPath, fixture]), MCM_PIN_FAKE_STATE: statePath, MCM_PIN_FAKE_LOG: logPath };
const run = args => spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8", windowsHide: true, timeout: 20000 });
const planned = run(["plan"]);
assert.equal(planned.status, 0, planned.stderr);
const summary = JSON.parse(planned.stdout);
assert.equal(summary.mode, "pin_required");
assert.equal(summary.ruleCount, 2);
assert.match(summary.planId, /^[0-9a-f]{64}$/u);
assert.equal((await readFile(logPath, "utf8")).includes("put-targets"), false);
const stale = run(["apply", "--approved-plan-id", "0".repeat(64), "--recovery-file", recoveryPath]);
assert.notEqual(stale.status, 0);
assert.equal((await readFile(logPath, "utf8")).includes("put-targets"), false);
const applied = run(["apply", "--approved-plan-id", summary.planId, "--recovery-file", recoveryPath]);
assert.equal(applied.status, 0, applied.stderr);
assert.equal(JSON.parse(applied.stdout).status, "pinned");
const after = JSON.parse(await readFile(statePath, "utf8"));
for (const name of contract.scheduleRules) assert.equal(after.targets[name].EcsParameters.TaskDefinitionArn, revisionArn);
const recovery = JSON.parse(await readFile(recoveryPath, "utf8"));
assert.equal(recovery.originalTargets.length, 2);
for (const row of recovery.originalTargets) assert.equal(row.target.EcsParameters.TaskDefinitionArn, familyArn);
const calls = (await readFile(logPath, "utf8")).trim().split("\n");
assert.equal(calls.filter(item => item === "events:put-targets").length, 2);
assert.equal((await readdir(temporary)).some(name => name.startsWith("mcm-schedule-pin-") && name.endsWith(".json")), false);
const originalRecoveryText = await readFile(recoveryPath, "utf8");
const canary = "PRIVATE_NETWORK_CANARY";
await writeFile(recoveryPath, `{"Input":"${canary}",`);
const broken = run(["rollback", "--approved-plan-id", summary.planId, "--recovery-file", recoveryPath]);
assert.notEqual(broken.status, 0);
assert.equal(broken.stderr.includes(canary), false);
assert.match(broken.stderr, /recovery file could not be read as JSON/u);
assert.equal((await readFile(logPath, "utf8")).trim().split("\n").filter(item => item === "events:put-targets").length, 2);
await writeFile(recoveryPath, originalRecoveryText);
const restored = run(["rollback", "--approved-plan-id", summary.planId, "--recovery-file", recoveryPath]);
assert.equal(restored.status, 0, restored.stderr);
assert.equal(JSON.parse(restored.stdout).status, "restored");
const final = JSON.parse(await readFile(statePath, "utf8"));
for (const name of contract.scheduleRules) assert.equal(final.targets[name].EcsParameters.TaskDefinitionArn, familyArn);
const finalCalls = (await readFile(logPath, "utf8")).trim().split("\n");
assert.equal(finalCalls.filter(item => item === "events:put-targets").length, 4);
await writeFile(path.resolve(outputArg), `${JSON.stringify({ complete: true, planIdMatchesApply: true, stalePlanWrites: 0, putTargetsCalls: 4, recoveryBeforeWrites: true, rollbackRestored: true, malformedRecoveryLeakedCanary: false, temporaryPayloadFiles: 0 }, null, 2)}\n`, { flag: "wx" });
for (const file of [statePath, logPath, recoveryPath]) await unlink(file);
await rmdir(temporary);
process.stdout.write("schedule pin CLI 9/9\n");
