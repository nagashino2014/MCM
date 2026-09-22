import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [workspaceArg, outputArg] = process.argv.slice(2);
if (!workspaceArg || !outputArg || process.argv.length !== 4) throw new Error("usage: node run.mjs <workspace> <new-output-file>");
const workspace = path.resolve(workspaceArg);
const ops = path.join(workspace, "infra/aws/ops");
const contract = JSON.parse(await readFile(path.join(ops, "runtime-db-schedule-pin-contract-20260921.json"), "utf8"));
const { collectSchedulePinPlan, publicSchedulePinPlan, applySchedulePinPlan, rollbackSchedulePin } = await import(pathToFileURL(path.join(ops, "runtime-db-schedule-pin.mjs")));
const { stableJson } = await import(pathToFileURL(path.join(ops, "runtime-db-transition-state.mjs")));
const clone = structuredClone;
const familyArn = `arn:${contract.partition}:ecs:${contract.region}:${contract.accountId}:task-definition/${contract.components.next.family}`;
const revisionArn = `${familyArn}:42`;
const clusterArn = `arn:${contract.partition}:ecs:${contract.region}:${contract.accountId}:cluster/${contract.cluster}`;
const input = name => name.endsWith("adt-ingest")
  ? { containerOverrides: [{ name: "next", command: ["node", ".next/adt-ingest.cjs"], environment: [{ name: "ADT_INGEST_MODE", value: "db" }] }] }
  : { containerOverrides: [{ name: "next", command: ["node", ".next/intel-batch.cjs"] }] };

function fixture() {
  return {
    caller: { Account: contract.accountId },
    service: { services: [{
      serviceName: contract.nextService, status: "ACTIVE", taskDefinition: revisionArn,
      desiredCount: 1, runningCount: 1, pendingCount: 0,
      deployments: [{ status: "PRIMARY", taskDefinition: revisionArn, rolloutState: "COMPLETED" }],
    }], failures: [] },
    newest: { taskDefinitionArns: [revisionArn] },
    rules: Object.fromEntries(contract.scheduleRules.map(name => [name, { Name: name, State: "ENABLED", EventBusName: "default", ScheduleExpression: contract.scheduleApprovedDefaults.expressions[name] }])),
    targets: Object.fromEntries(contract.scheduleRules.map((name, index) => [name, {
      Id: index ? "intel-batch" : "adt-ingest", Arn: clusterArn,
      RoleArn: `arn:${contract.partition}:iam::${contract.accountId}:role/${name}-events`,
      Input: JSON.stringify(input(name)),
      EcsParameters: {
        TaskDefinitionArn: familyArn, TaskCount: 1, LaunchType: "FARGATE", EnableECSManagedTags: false, EnableExecuteCommand: false,
        NetworkConfiguration: { awsvpcConfiguration: { Subnets: ["subnet-a", "subnet-b"], SecurityGroups: ["sg-a"], AssignPublicIp: "ENABLED" } },
      },
    }])),
  };
}

function adapters(state, behavior = {}) {
  const calls = [];
  let recovery;
  const readAws = async (service, operation, args) => {
    calls.push(`${service}:${operation}`);
    if (service === "sts") return clone(state.caller);
    if (operation === "describe-services") return clone(state.service);
    if (operation === "list-task-definitions") return clone(state.newest);
    const name = args[1];
    if (operation === "describe-rule") return clone(state.rules[name]);
    if (operation === "list-targets-by-rule") return { Targets: [clone(state.targets[name])] };
    throw new Error("unexpected AWS read");
  };
  let putNumber = 0;
  const putTarget = async (name, target) => {
    calls.push(`events:put-targets:${name}`);
    assert.ok(recovery, "recovery record must precede writes");
    putNumber++;
    if (behavior.externalAt === putNumber) {
      state.targets[name].EcsParameters.TaskCount = 2;
      throw new Error("external write");
    }
    if (behavior.failAt === putNumber) return { FailedEntryCount: 1, FailedEntries: [{ TargetId: target.Id, ErrorCode: "ThrottlingException" }] };
    state.targets[name] = clone(target);
    if (behavior.throwAfterAt === putNumber) throw new Error("response lost");
    return { FailedEntryCount: 0 };
  };
  const saveRecovery = async value => { calls.push("save-recovery"); recovery = clone(value); };
  return { readAws, putTarget, saveRecovery, calls, getRecovery: () => recovery };
}

const results = [];
async function check(id, fn) { await fn(); results.push({ id, passed: true }); }
await check("SP01-plan", async () => {
  const plan = await collectSchedulePinPlan(contract, adapters(fixture()).readAws);
  const summary = publicSchedulePinPlan(plan);
  assert.equal(summary.mode, "pin_required");
  assert.equal(summary.revision, "42");
  assert.equal(summary.ruleCount, 2);
  assert.match(summary.planId, /^[0-9a-f]{64}$/u);
  assert.equal(stableJson(summary).includes(contract.accountId), false);
});
await check("SP02-deterministic", async () => {
  const first = await collectSchedulePinPlan(contract, adapters(fixture()).readAws);
  const second = await collectSchedulePinPlan(contract, adapters(fixture()).readAws);
  assert.equal(first.planId, second.planId);
});
await check("SP03-apply-two-targets", async () => {
  const state = fixture(); const a = adapters(state);
  const plan = await collectSchedulePinPlan(contract, a.readAws);
  const originals = clone(state.targets);
  const outcome = await applySchedulePinPlan({ contract, approvedPlanId: plan.planId, ...a, pause: async () => {} });
  assert.equal(outcome.writes, 2);
  assert.ok(a.calls.indexOf("save-recovery") < a.calls.findIndex(item => item.startsWith("events:put-targets")));
  for (const name of contract.scheduleRules) {
    assert.equal(state.targets[name].EcsParameters.TaskDefinitionArn, revisionArn);
    const before = clone(originals[name]); const after = clone(state.targets[name]);
    delete before.EcsParameters.TaskDefinitionArn; delete after.EcsParameters.TaskDefinitionArn;
    assert.equal(stableJson(after), stableJson(before));
  }
  assert.equal(a.getRecovery().originalTargets.length, 2);
});
await check("SP04-stale-plan-no-write", async () => {
  const state = fixture(); const a = adapters(state);
  const plan = await collectSchedulePinPlan(contract, a.readAws);
  state.targets[contract.scheduleRules[0]].EcsParameters.NetworkConfiguration.awsvpcConfiguration.Subnets.push("subnet-c");
  await assert.rejects(applySchedulePinPlan({ contract, approvedPlanId: plan.planId, ...a }), /plan changed/);
  assert.equal(a.getRecovery(), undefined);
  assert.equal(a.calls.some(item => item.startsWith("events:put-targets")), false);
});
await check("SP05-partial-failure-restored", async () => {
  const state = fixture(); const a = adapters(state, { failAt: 2 });
  const original = clone(state.targets);
  const plan = await collectSchedulePinPlan(contract, a.readAws);
  await assert.rejects(applySchedulePinPlan({ contract, approvedPlanId: plan.planId, ...a, pause: async () => {} }), /all targets restored/);
  assert.equal(stableJson(state.targets), stableJson(original));
});
await check("SP06-response-lost-restored", async () => {
  const state = fixture(); const a = adapters(state, { throwAfterAt: 1 });
  const original = clone(state.targets);
  const plan = await collectSchedulePinPlan(contract, a.readAws);
  await assert.rejects(applySchedulePinPlan({ contract, approvedPlanId: plan.planId, ...a, pause: async () => {} }), /all targets restored/);
  assert.equal(stableJson(state.targets), stableJson(original));
});
await check("SP07-external-change-manual", async () => {
  const state = fixture(); const a = adapters(state, { externalAt: 2 });
  const plan = await collectSchedulePinPlan(contract, a.readAws);
  await assert.rejects(applySchedulePinPlan({ contract, approvedPlanId: plan.planId, ...a, pause: async () => {} }), /manual recovery required/);
  assert.equal(state.targets[contract.scheduleRules[0]].EcsParameters.TaskDefinitionArn, familyArn);
});
await check("SP08-already-pinned-no-write", async () => {
  const state = fixture(); for (const target of Object.values(state.targets)) target.EcsParameters.TaskDefinitionArn = revisionArn;
  const a = adapters(state); const plan = await collectSchedulePinPlan(contract, a.readAws);
  const result = await applySchedulePinPlan({ contract, approvedPlanId: plan.planId, ...a });
  assert.equal(result.status, "already_pinned"); assert.equal(a.getRecovery(), undefined);
});
await check("SP09-mixed-state-rejected", async () => {
  const state = fixture(); state.targets[contract.scheduleRules[1]].EcsParameters.TaskDefinitionArn = revisionArn;
  await assert.rejects(collectSchedulePinPlan(contract, adapters(state).readAws), /mixed state/);
});
await check("SP10-service-not-latest", async () => {
  const state = fixture(); state.newest.taskDefinitionArns = [`${familyArn}:43`];
  await assert.rejects(collectSchedulePinPlan(contract, adapters(state).readAws), /latest ACTIVE/);
});
await check("SP11-service-rolling", async () => {
  const state = fixture(); state.service.services[0].runningCount = 0;
  await assert.rejects(collectSchedulePinPlan(contract, adapters(state).readAws), /not stable/);
});
await check("SP12-account-mismatch", async () => {
  const state = fixture(); state.caller.Account = "000000000000";
  await assert.rejects(collectSchedulePinPlan(contract, adapters(state).readAws), /account mismatch/);
});
await check("SP13-input-drift", async () => {
  const state = fixture(); state.targets[contract.scheduleRules[0]].Input = "{}";
  await assert.rejects(collectSchedulePinPlan(contract, adapters(state).readAws), /Input differs/);
});
await check("SP14-missing-target", async () => {
  const state = fixture(); delete state.targets[contract.scheduleRules[0]];
  await assert.rejects(collectSchedulePinPlan(contract, adapters(state).readAws));
});
await check("SP15-explicit-rollback", async () => {
  const state = fixture(); const a = adapters(state); const original = clone(state.targets);
  const plan = await collectSchedulePinPlan(contract, a.readAws);
  await applySchedulePinPlan({ contract, approvedPlanId: plan.planId, ...a, pause: async () => {} });
  const outcome = await rollbackSchedulePin({ contract, approvedPlanId: plan.planId, recovery: a.getRecovery(), ...a, pause: async () => {} });
  assert.equal(outcome.writes, 2);
  assert.equal(stableJson(state.targets), stableJson(original));
});
await check("SP16-tampered-recovery-no-write", async () => {
  const state = fixture(); const a = adapters(state);
  const plan = await collectSchedulePinPlan(contract, a.readAws);
  await applySchedulePinPlan({ contract, approvedPlanId: plan.planId, ...a, pause: async () => {} });
  const count = a.calls.filter(item => item.startsWith("events:put-targets")).length;
  const recovery = clone(a.getRecovery()); recovery.originalTargets[0].target.EcsParameters.TaskCount = 2;
  await assert.rejects(rollbackSchedulePin({ contract, approvedPlanId: plan.planId, recovery, ...a }), /schedule task count differs|recovery target content differs/);
  assert.equal(a.calls.filter(item => item.startsWith("events:put-targets")).length, count);
});
await check("SP17-external-change-blocks-rollback", async () => {
  const state = fixture(); const a = adapters(state);
  const plan = await collectSchedulePinPlan(contract, a.readAws);
  await applySchedulePinPlan({ contract, approvedPlanId: plan.planId, ...a, pause: async () => {} });
  state.targets[contract.scheduleRules[1]].EcsParameters.TaskCount = 2;
  const count = a.calls.filter(item => item.startsWith("events:put-targets")).length;
  await assert.rejects(rollbackSchedulePin({ contract, approvedPlanId: plan.planId, recovery: a.getRecovery(), ...a }), /outside the approved pin operation|schedule task count differs/);
  assert.equal(a.calls.filter(item => item.startsWith("events:put-targets")).length, count);
});
await check("SP18-stale-read-still-restores-attempted-write", async () => {
  const state = fixture(); const a = adapters(state); const original = clone(state.targets);
  const plan = await collectSchedulePinPlan(contract, a.readAws);
  const readAws = async (service, operation, args) => {
    const name = args[1];
    if (operation === "list-targets-by-rule" && a.calls.some(item => item.startsWith("events:put-targets")) &&
        state.targets[name]?.EcsParameters.TaskDefinitionArn === revisionArn) {
      return { Targets: [clone(original[name])] };
    }
    return a.readAws(service, operation, args);
  };
  await assert.rejects(applySchedulePinPlan({ contract, approvedPlanId: plan.planId, ...a, readAws, pause: async () => {} }), /all targets restored/);
  assert.equal(a.calls.filter(item => item.startsWith("events:put-targets")).length, 2);
  assert.equal(stableJson(state.targets), stableJson(original));
});
await check("SP19-default-omission-and-network-order", async () => {
  const state = fixture(); const a = adapters(state);
  const plan = await collectSchedulePinPlan(contract, a.readAws);
  const readAws = async (service, operation, args) => {
    const result = await a.readAws(service, operation, args);
    if (operation === "list-targets-by-rule" && a.calls.includes(`events:put-targets:${args[1]}`)) {
      delete result.Targets[0].EcsParameters.EnableECSManagedTags;
      delete result.Targets[0].EcsParameters.EnableExecuteCommand;
      result.Targets[0].EcsParameters.NetworkConfiguration.awsvpcConfiguration.Subnets.reverse();
    }
    return result;
  };
  const outcome = await applySchedulePinPlan({ contract, approvedPlanId: plan.planId, ...a, readAws, pause: async () => {} });
  assert.equal(outcome.status, "pinned");
  assert.equal(a.calls.filter(item => item.startsWith("events:put-targets")).length, 2);
  const restored = await rollbackSchedulePin({ contract, approvedPlanId: plan.planId, recovery: a.getRecovery(), ...a, readAws, pause: async () => {} });
  assert.equal(restored.status, "restored");
  assert.equal(restored.writes, 2);
});
await check("SP20-external-role-change-still-blocked", async () => {
  const state = fixture(); const a = adapters(state);
  const plan = await collectSchedulePinPlan(contract, a.readAws);
  let writes = 0;
  const putTarget = async (name, target) => {
    const result = await a.putTarget(name, target); writes++;
    if (writes === 1) state.targets[name].RoleArn = "arn:aws:iam::000000000000:role/foreign";
    return result;
  };
  await assert.rejects(applySchedulePinPlan({ contract, approvedPlanId: plan.planId, ...a, putTarget, pause: async () => {} }), /manual recovery required/);
  assert.equal(writes, 1);
  assert.equal(state.targets[contract.scheduleRules[0]].RoleArn.endsWith("foreign"), true);
});

await check("P1-frozen-recovery-survives-new-operator-contract", async () => {
  const current = JSON.parse(await readFile(path.join(ops, "runtime-db-transition-contract.json"), "utf8"));
  assert.notDeepEqual(current.collector, contract.collector);
  const state = fixture(); const a = adapters(state);
  const plan = await collectSchedulePinPlan(contract, a.readAws);
  await applySchedulePinPlan({ contract, approvedPlanId: plan.planId, ...a, pause: async () => {} });
  const writesBefore = a.calls.filter(item => item.startsWith("events:put-targets")).length;
  await assert.rejects(
    rollbackSchedulePin({ contract: current, approvedPlanId: plan.planId, recovery: a.getRecovery(), ...a }),
    /recovery record or approval is invalid/,
  );
  assert.equal(a.calls.filter(item => item.startsWith("events:put-targets")).length, writesBefore);
  const result = await rollbackSchedulePin({ contract, approvedPlanId: plan.planId, recovery: a.getRecovery(), ...a, pause: async () => {} });
  assert.equal(result.status, "restored");
});

await writeFile(path.resolve(outputArg), `${JSON.stringify({ complete: true, passed: results.length, results }, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`schedule pin plan ${results.length}/${results.length}\n`);
