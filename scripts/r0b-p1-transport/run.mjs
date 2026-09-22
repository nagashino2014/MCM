import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [workspaceArg, outputArg] = process.argv.slice(2);
if (!workspaceArg || !outputArg || process.argv.length !== 4) {
  throw new Error("usage: node run.mjs <workspace> <new-output-directory>");
}
const workspace = path.resolve(workspaceArg);
const output = path.resolve(outputArg);
await mkdir(output, { recursive: false });
const temporaryDirectory = path.join(output, "temporary");
await mkdir(temporaryDirectory);
const ops = path.join(workspace, "infra/aws/ops");
const contract = JSON.parse(await readFile(path.join(ops, "runtime-db-transition-contract.json"), "utf8"));
const { createScheduleAwsTransport } = await import(pathToFileURL(path.join(ops, "runtime-db-transition-schedule-transport.mjs")));
const { scheduleAwsCliEnvironment } = await import(pathToFileURL(path.join(ops, "runtime-db-transition-schedule-transport.mjs")));
const { createScheduleSwitchOperation } = await import(pathToFileURL(path.join(ops, "runtime-db-transition-schedule-write.mjs")));
const { createScheduleTransitionStage } = await import(pathToFileURL(path.join(ops, "runtime-db-transition-schedule-stage.mjs")));
const { projectScheduleObservation } = await import(pathToFileURL(path.join(ops, "runtime-db-transition-schedule.mjs")));
const { projectNextService } = await import(pathToFileURL(path.join(ops, "runtime-db-transition-adapter.mjs")));
const { sha256, stableJson } = await import(pathToFileURL(path.join(ops, "runtime-db-transition-state.mjs")));
const names = contract.scheduleRules;
const identity = { Account: contract.accountId,
  Arn: `arn:${contract.partition}:sts::${contract.accountId}:assumed-role/${contract.collector.allowedStsRoleNames[0]}/local-test` };
const clusterArn = `arn:${contract.partition}:ecs:${contract.region}:${contract.accountId}:cluster/${contract.cluster}`;
const family = `arn:${contract.partition}:ecs:${contract.region}:${contract.accountId}:task-definition/${contract.components.next.family}`;
const beforeArn = `${family}:618`;
const afterArn = `${family}:620`;
function approvedRule(name) {
  return { Name: name, State: "ENABLED", EventBusName: "default",
    ScheduleExpression: contract.scheduleApprovedDefaults.expressions[name] };
}
function approvedTarget(name, revision = beforeArn) {
  return { Id: name.endsWith("adt-ingest") ? "adt-ingest" : "intel-batch", Arn: clusterArn,
    RoleArn: `arn:${contract.partition}:iam::${contract.accountId}:role/${name}-events`,
    Input: JSON.stringify({ containerOverrides: [{ name: "next",
      command: name.endsWith("adt-ingest") ? ["node", ".next/adt-ingest.cjs"] : ["node", ".next/intel-batch.cjs"],
      ...(name.endsWith("adt-ingest") ? { environment: [{ name: "ADT_INGEST_MODE", value: "db" }] } : {}),
    }] }),
    EcsParameters: { TaskDefinitionArn: revision, TaskCount: 1, LaunchType: "FARGATE",
      EnableECSManagedTags: false, EnableExecuteCommand: false,
      NetworkConfiguration: { awsvpcConfiguration: {
        Subnets: ["subnet-a", "subnet-b"], SecurityGroups: ["sg-a"], AssignPublicIp: "ENABLED",
      } },
    },
  };
}
const plan = { version: contract.planVersion, current: { schedules: names.map(name =>
  projectScheduleObservation(contract, approvedRule(name), { Targets: [approvedTarget(name)] })) } };
const target = approvedTarget(names[0], afterArn);
function approvedProof(name, revision = afterArn, { compensation = false, rollback = false, deadlineAt = "2099-01-01T00:00:00.000Z" } = {}) {
  const preCas = { rules: structuredClone(plan.current.schedules) };
  const plannedEffect = structuredClone(preCas);
  for (const row of plannedEffect.rules) row.taskDefinitionArn = afterArn;
  return { phase: "schedules_switched", preCas, plannedEffect, rollback, compensation,
    checkOnly: false, targetName: name, taskDefinitionArn: revision, deadlineAt };
}
const checks = [];
async function check(name, run) { await run(); checks.push(name); }

function fixture({ caller = identity, authorize = async () => true, fail = null, onSts = () => {}, now = () => new Date() } = {}) {
  const calls = [];
  let written;
  const runCommand = async args => {
    calls.push(args);
    const operation = `${args[0]}:${args[1]}`;
    if (operation === "sts:get-caller-identity") { onSts(); return { status: 0, stdout: JSON.stringify(caller) }; }
    if (operation === "events:put-targets") {
      const fileArgument = args[args.indexOf("--targets") + 1];
      assert.ok(fileArgument.startsWith("file://"));
      written = JSON.parse(await readFile(fileArgument.slice(7), "utf8"));
      if (fail === "throw") throw new Error("SENSITIVE-INPUT-MUST-NOT-LEAK");
      if (fail === "status") return { status: 1, stdout: "", stderr: "SENSITIVE-INPUT-MUST-NOT-LEAK" };
      return { status: 0, stdout: JSON.stringify({ FailedEntryCount: 0, FailedEntries: [] }) };
    }
    return { status: 0, stdout: JSON.stringify({ operation, marker: "read-only" }) };
  };
  const transport = createScheduleAwsTransport({ contract, plan, profile: "mcm-kesi-staging",
    authorizeMutation: authorize, runCommand, temporaryDirectory, now });
  return { transport, calls, written: () => written };
}

await check("T01-approved-read-binds-operator-profile-and-region", async () => {
  const f = fixture();
  const response = await f.transport.readAws("ecs", "describe-services", ["--cluster", contract.cluster, "--services", contract.nextService]);
  assert.equal(response.marker, "read-only");
  assert.deepEqual(f.calls.map(args => `${args[0]}:${args[1]}`), ["sts:get-caller-identity", "ecs:describe-services"]);
  for (const args of f.calls) {
    assert.equal(args[args.indexOf("--profile") + 1], "mcm-kesi-staging");
    assert.equal(args[args.indexOf("--region") + 1], contract.region);
  }
});
await check("T02-read-operation-and-argument-allowlist", async () => {
  const f = fixture();
  for (const action of [
    () => f.transport.readAws("events", "put-targets", []),
    () => f.transport.readAws("ecs", "describe-services", ["--cluster", contract.cluster, "--query", "Secrets"]),
    () => f.transport.readAws("events", "describe-rule", ["--name", "unapproved"]),
    () => f.transport.readAws("events", "list-targets-by-rule", ["--rule", names[0], "--max-items", "1"]),
  ]) await assert.rejects(action(), /outside the schedule transition allowlist/u);
  assert.equal(f.calls.length, 0);
});
await check("T03-cross-account-and-wrong-role-denied-before-read", async () => {
  for (const caller of [
    { ...identity, Account: "000000000000" },
    { ...identity, Arn: `arn:${contract.partition}:sts::${contract.accountId}:assumed-role/unapproved/session` },
    { ...identity, Arn: `${identity.Arn}/extra` },
  ]) {
    const f = fixture({ caller });
    await assert.rejects(f.transport.readAws("events", "describe-rule", ["--name", names[0]]), /not the approved transition operator/u);
    assert.deepEqual(f.calls.map(args => `${args[0]}:${args[1]}`), ["sts:get-caller-identity"]);
  }
});
await check("T04-mutation-requires-durable-authorization", async () => {
  const f = fixture({ authorize: async () => false });
  await assert.rejects(f.transport.putTarget(names[0], target, approvedProof(names[0])), error =>
    error.schedulePreWriteFailure === true && /stopped before AWS submission/u.test(error.message));
  assert.deepEqual(f.calls.map(args => `${args[0]}:${args[1]}`), ["sts:get-caller-identity"]);
});
await check("T05-target-identity-and-revision-checked-before-AWS", async () => {
  const f = fixture();
  for (const wrong of [
    { ...target, Id: "other" },
    { ...target, Arn: "arn:aws:ecs:other" },
    { ...target, EcsParameters: { ...target.EcsParameters, TaskDefinitionArn: `${family}:latest` } },
  ]) await assert.rejects(f.transport.putTarget(names[0], wrong, approvedProof(names[0])), error => error.schedulePreWriteFailure === true);
  await assert.rejects(f.transport.putTarget("other", target, approvedProof("other")), error => error.schedulePreWriteFailure === true);
  assert.equal(f.calls.length, 0);
});
await check("T06-authorized-target-sent-by-private-file-and-removed", async () => {
  const f = fixture({ authorize: async ({ name, target: candidate, identity: caller, proof }) => {
    assert.equal(name, names[0]); assert.equal(candidate.EcsParameters.TaskDefinitionArn, `${family}:620`);
    assert.equal(caller.Arn, identity.Arn);
    assert.equal(proof.phase, "schedules_switched");
    assert.equal(proof.checkOnly, false);
    assert.equal(proof.deadlineAt, "2099-01-01T00:00:00.000Z");
    candidate.Id = "tampered-local-copy";
    return true;
  } });
  const result = await f.transport.putTarget(names[0], target, approvedProof(names[0]));
  assert.equal(result.FailedEntryCount, 0);
  assert.deepEqual(f.written(), [target]);
  assert.equal(f.calls.at(-1)[f.calls.at(-1).indexOf("--rule") + 1], names[0]);
  assert.deepEqual(await readdir(temporaryDirectory), []);
});
await check("T07-response-loss-keeps-details-private-and-cleans-file", async () => {
  for (const fail of ["throw", "status"]) {
    const f = fixture({ fail });
    await assert.rejects(f.transport.putTarget(names[0], target, approvedProof(names[0])), error =>
      /did not complete/u.test(error.message) && !/SENSITIVE/u.test(error.message));
    assert.deepEqual(await readdir(temporaryDirectory), []);
  }
});
await check("T08-invalid-profile-or-plan-refused", async () => {
  assert.throws(() => createScheduleAwsTransport({ contract, plan, profile: "bad profile",
    authorizeMutation: async () => true, runCommand: async () => ({}) }), /requires an approved/u);
  assert.throws(() => createScheduleAwsTransport({ contract, plan: { current: { schedules: [plan.current.schedules[0], plan.current.schedules[0]] } },
    authorizeMutation: async () => true, runCommand: async () => ({}) }), /two approved rules/u);
});

function integratedFixture({ denySecond = false, loseFirst = false, failSecondAtAws = false,
  cleanupFailure = false, onAuthorize = () => {}, onSubmission = () => {},
  clock = null, deadlineAt = "2099-01-01T00:00:00.000Z" } = {}) {
  const rules = Object.fromEntries(names.map(name => [name, approvedRule(name)]));
  const targets = Object.fromEntries(names.map(name => [name, approvedTarget(name)]));
  const fullPlan = structuredClone(plan);
  const serviceRaw = { failures: [], services: [{ serviceName: contract.nextService, status: "ACTIVE",
    taskDefinition: afterArn, desiredCount: 1, runningCount: 1, pendingCount: 0,
    deployments: [{ status: "PRIMARY", taskDefinition: afterArn, rolloutState: "COMPLETED" }],
  }] };
  const submissions = [];
  const command = async args => {
    const operation = `${args[0]}:${args[1]}`;
    if (operation === "sts:get-caller-identity") return { status: 0, stdout: JSON.stringify(identity) };
    if (operation === "ecs:describe-services") return { status: 0, stdout: JSON.stringify(serviceRaw) };
    if (operation === "events:describe-rule") {
      const name = args[args.indexOf("--name") + 1];
      return { status: 0, stdout: JSON.stringify(rules[name]) };
    }
    if (operation === "events:list-targets-by-rule") {
      const name = args[args.indexOf("--rule") + 1];
      return { status: 0, stdout: JSON.stringify({ Targets: [structuredClone(targets[name])] }) };
    }
    if (operation === "events:put-targets") {
      const name = args[args.indexOf("--rule") + 1];
      const source = args[args.indexOf("--targets") + 1].slice(7);
      const [sent] = JSON.parse(await readFile(source, "utf8"));
      submissions.push({ name, revision: sent.EcsParameters.TaskDefinitionArn });
      if (failSecondAtAws && submissions.length === 2) {
        return { status: 1, stdout: "", stderr: "AccessDeniedException PRIVATE-TEXT" };
      }
      targets[name] = sent;
      onSubmission({ name, count: submissions.length });
      if (loseFirst && submissions.length === 1) throw new Error("response lost after submission");
      return { status: 0, stdout: JSON.stringify({ FailedEntryCount: 0 }) };
    }
    throw new Error(`unexpected operation ${operation}`);
  };
  const transport = createScheduleAwsTransport({ contract, plan: fullPlan, runCommand: command,
    temporaryDirectory, now: clock ? () => new Date(clock.value) : () => new Date(),
    removeTemporary: async file => { await unlink(file); if (cleanupFailure) throw new Error(`private path ${file}`); },
    authorizeMutation: async request => {
      onAuthorize(request);
      return !(denySecond && request.name === names[1] && request.target.EcsParameters.TaskDefinitionArn === afterArn);
    } });
  const operation = createScheduleSwitchOperation({ contract, plan: fullPlan,
    readAws: transport.readAws, putTarget: transport.putTarget,
    assertDurablePending: async () => ({ deadlineAt }), pause: async () => {} });
  return { beforeArn, afterArn, targets, submissions, operation, transport, fullPlan, serviceRaw };
}
async function approvedEffect(fixture_) {
  const preCas = await fixture_.operation.readCurrent();
  const plannedEffect = structuredClone(preCas);
  for (const row of plannedEffect.rules) row.taskDefinitionArn = fixture_.afterArn;
  return { preCas, plannedEffect };
}
await check("T09-second-pre-submission-denial-compensates-first", async () => {
  const f = integratedFixture({ denySecond: true });
  await assert.rejects(f.operation.invoke(await approvedEffect(f)), /all attempted targets restored/u);
  assert.deepEqual(f.submissions, [
    { name: names[0], revision: f.afterArn },
    { name: names[0], revision: f.beforeArn },
  ]);
  assert.ok(names.every(name => f.targets[name].EcsParameters.TaskDefinitionArn === f.beforeArn));
});
await check("T10-post-submission-loss-remains-unknown", async () => {
  const f = integratedFixture({ loseFirst: true });
  await assert.rejects(f.operation.invoke(await approvedEffect(f)), /outcome is unknown; manual recovery required/u);
  assert.deepEqual(f.submissions, [{ name: names[0], revision: f.afterArn }]);
  assert.equal(f.targets[names[0]].EcsParameters.TaskDefinitionArn, f.afterArn);
  assert.equal(f.targets[names[1]].EcsParameters.TaskDefinitionArn, f.beforeArn);
});
await check("T11-full-target-content-and-old-revision-are-bound", async () => {
  const f = fixture();
  for (const changed of [
    { ...target, RoleArn: "arn:aws:iam::000000000000:role/foreign" },
    { ...target, Input: JSON.stringify({ command: "sh -c unexpected" }) },
    { ...target, RetryPolicy: { MaximumRetryAttempts: 1 } },
    { ...target, EcsParameters: { ...target.EcsParameters, NetworkConfiguration: {
      awsvpcConfiguration: { Subnets: ["subnet-other"], SecurityGroups: ["sg-a"], AssignPublicIp: "ENABLED" },
    } } },
    { ...target, EcsParameters: { ...target.EcsParameters, TaskDefinitionArn: `${family}:1` } },
  ]) await assert.rejects(f.transport.putTarget(names[0], changed, approvedProof(names[0])), error =>
    error.schedulePreWriteFailure === true);
  assert.equal(f.calls.length, 0);
});
await check("T12-proof-shape-and-forward-deadline-block-before-submit", async () => {
  const f = fixture();
  for (const changed of [
    { ...approvedProof(names[0]), checkOnly: true },
    { ...approvedProof(names[0]), targetName: names[1] },
    { ...approvedProof(names[0]), taskDefinitionArn: `${family}:1` },
    { ...approvedProof(names[0]), compensation: "true" },
  ]) await assert.rejects(f.transport.putTarget(names[0], target, changed), error => error.schedulePreWriteFailure === true);
  assert.equal(f.calls.length, 0);
  let clock = Date.parse("2030-01-01T00:00:00.000Z");
  const late = fixture({ now: () => new Date(clock), onSts: () => { clock += 60_000; } });
  await assert.rejects(late.transport.putTarget(names[0], target,
    approvedProof(names[0], afterArn, { deadlineAt: "2030-01-01T00:00:30.000Z" })),
  error => error.schedulePreWriteFailure === true);
  assert.deepEqual(late.calls.map(args => `${args[0]}:${args[1]}`), ["sts:get-caller-identity"]);
});
await check("T13-expired-deadline-does-not-block-approved-compensation", async () => {
  const f = fixture({ now: () => new Date("2031-01-01T00:00:00.000Z") });
  const oldTarget = approvedTarget(names[0]);
  const result = await f.transport.putTarget(names[0], oldTarget, approvedProof(names[0], beforeArn,
    { compensation: true, deadlineAt: "2030-01-01T00:00:00.000Z" }));
  assert.equal(result.FailedEntryCount, 0);
});
await check("T14-one-snapshot-survives-getter-and-authorizer-mutation", async () => {
  const candidate = approvedTarget(names[0], afterArn);
  let reads = 0;
  Object.defineProperty(candidate, "Input", { enumerable: true, get() {
    reads++;
    return reads === 1 ? target.Input : "malicious";
  } });
  const f = fixture({ authorize: async () => { candidate.RoleArn = "foreign"; return true; } });
  await f.transport.putTarget(names[0], candidate, approvedProof(names[0]));
  assert.equal(reads, 1);
  assert.equal(f.written()[0].Input, target.Input);
  assert.equal(f.written()[0].RoleArn, target.RoleArn);
});
await check("T15-nonascii-target-file-is-ascii-and-semantically-preserved", async () => {
  const name = names[0];
  const localContract = structuredClone(contract);
  const localTarget = approvedTarget(name, afterArn);
  localTarget.Input = JSON.stringify({ containerOverrides: [{ name: "next", command: ["배치 모드"] }] });
  localContract.scheduleApprovedInputSha256[name] = createHash("sha256")
    .update(stableJson(JSON.parse(localTarget.Input)), "utf8").digest("hex");
  const localPlan = structuredClone(plan);
  // The baseline Input must carry the same approved content as the candidate.
  const localBaseline = structuredClone(localTarget);
  localBaseline.EcsParameters.TaskDefinitionArn = beforeArn;
  localPlan.current.schedules[0] = projectScheduleObservation(localContract, approvedRule(name), { Targets: [localBaseline] });
  let bytes;
  const runCommand = async args => {
    if (args[0] === "sts") return { status: 0, stdout: JSON.stringify(identity) };
    const source = args[args.indexOf("--targets") + 1].slice(7);
    bytes = await readFile(source);
    return { status: 0, stdout: JSON.stringify({ FailedEntryCount: 0 }) };
  };
  const transport = createScheduleAwsTransport({ contract: localContract, plan: localPlan,
    authorizeMutation: async () => true, runCommand, temporaryDirectory });
  const preCas = { rules: structuredClone(localPlan.current.schedules) };
  const plannedEffect = structuredClone(preCas);
  for (const row of plannedEffect.rules) row.taskDefinitionArn = afterArn;
  await transport.putTarget(name, localTarget, { phase: "schedules_switched", preCas, plannedEffect,
    rollback: false, compensation: false, checkOnly: false, targetName: name,
    taskDefinitionArn: afterArn, deadlineAt: "2099-01-01T00:00:00.000Z" });
  assert.ok([...bytes].every(byte => byte < 128));
  assert.equal(JSON.parse(bytes.toString("ascii"))[0].Input, localTarget.Input);
});
await check("T16-cleanup-failure-preserves-known-AWS-result-without-path", async () => {
  const runCommand = async args => args[0] === "sts"
    ? { status: 0, stdout: JSON.stringify(identity) }
    : { status: 0, stdout: JSON.stringify({ FailedEntryCount: 0 }) };
  const transport = createScheduleAwsTransport({ contract, plan, runCommand,
    authorizeMutation: async () => true, temporaryDirectory,
    removeTemporary: async file => { await unlink(file); throw new Error(`SENSITIVE-PATH ${file}`); } });
  const result = await transport.putTarget(names[0], target, approvedProof(names[0]));
  assert.equal(result.FailedEntryCount, 0);
  assert.equal(result.scheduleTemporaryCleanupFailed, true);
  assert.equal(JSON.stringify(result).includes("SENSITIVE-PATH"), false);
  assert.deepEqual(await readdir(temporaryDirectory), []);
});
await check("T17-stage-pending-deadline-flows-to-transport", async () => {
  let state;
  const f = integratedFixture({ onAuthorize: request => {
    assert.equal(state.phases.schedules_switched.status, "pending");
    assert.equal(request.proof.deadlineAt, "2099-01-01T00:00:00.000Z");
    assert.equal(request.proof.checkOnly, false);
  } });
  const transitionId = "synthetic-schedule-transport-001";
  state = { transitionId, planSha256: sha256(Buffer.from(stableJson(f.fullPlan), "utf8")),
    rollback: null, status: "active", phases: {} };
  for (const phase of contract.durableExecution.phaseOrder.slice(0, 5)) state.phases[phase] = { status: "complete" };
  state.phases.next_registered_disabled.plannedEffect = { taskDefinitionArn: f.afterArn };
  state.phases.next_service_stable.plannedEffect = projectNextService(contract, f.serviceRaw);
  const store = {
    load: async () => state,
    executePhase: async ({ phase, preCas, plannedEffect, readCurrent, invoke }) => {
      assert.deepEqual(await readCurrent(), preCas);
      state.phases[phase] = { status: "pending", preCas, plannedEffect,
        deadlineAt: "2099-01-01T00:00:00.000Z" };
      const result = await invoke({ transitionId, phase, preCas, plannedEffect,
        deadlineAt: state.phases[phase].deadlineAt });
      state.phases[phase].status = "complete";
      return { invoked: true, result, state };
    },
  };
  const stage = createScheduleTransitionStage({ store, contract, plan: f.fullPlan, transitionId,
    readAws: f.transport.readAws, putTarget: f.transport.putTarget,
    now: () => new Date("2030-01-01T00:00:00.000Z"), pause: async () => {} });
  const result = await stage.execute();
  assert.equal(result.invoked, true);
  assert.equal(result.result.status, "switched");
  assert.equal(f.submissions.length, 2);
  assert.ok(names.every(name => f.targets[name].EcsParameters.TaskDefinitionArn === f.afterArn));
});
await check("T18-forged-old-effect-cannot-authorize-rollback-to-revision-one", async () => {
  const f = fixture();
  const forged = approvedProof(names[0], `${family}:1`);
  for (const row of forged.plannedEffect.rules) row.taskDefinitionArn = `${family}:1`;
  const oldTarget = approvedTarget(names[0], `${family}:1`);
  await assert.rejects(f.transport.putTarget(names[0], oldTarget, forged), error =>
    error.schedulePreWriteFailure === true);
  assert.equal(f.calls.length, 0);
});
await check("T19-known-result-cleanup-warning-reaches-durable-operation", async () => {
  const f = integratedFixture({ cleanupFailure: true });
  const result = await f.operation.invoke(await approvedEffect(f));
  assert.equal(result.status, "switched");
  assert.equal(result.cleanupWarnings, 2);
  assert.equal(f.submissions.length, 2);
  assert.deepEqual(await readdir(temporaryDirectory), []);
});
await check("T20-confirmed-AWS-denial-remains-conservative-unknown", async () => {
  const f = integratedFixture({ failSecondAtAws: true });
  await assert.rejects(f.operation.invoke(await approvedEffect(f)), error =>
    /outcome is unknown; manual recovery required/u.test(error.message) &&
    !/PRIVATE-TEXT/u.test(error.message));
  assert.equal(f.targets[names[0]].EcsParameters.TaskDefinitionArn, f.afterArn);
  assert.equal(f.targets[names[1]].EcsParameters.TaskDefinitionArn, f.beforeArn);
  assert.equal(f.submissions.length, 2);
});
await check("TF01-AWS-CLI-stdout-and-file-encoding-use-Python-UTF8", async () => {
  const parent = { PYTHONUTF8: "0", AWS_CLI_FILE_ENCODING: "cp949", AWS_MAX_ATTEMPTS: "9",
    AWS_ENDPOINT_URL_STS: "http://127.0.0.1:1", KEEP: "yes" };
  const child = scheduleAwsCliEnvironment(parent);
  assert.equal(child.PYTHONUTF8, "1");
  assert.equal(child.AWS_CLI_FILE_ENCODING, "UTF-8");
  assert.equal(child.AWS_MAX_ATTEMPTS, "1");
  assert.equal(child.AWS_ENDPOINT_URL_STS, undefined);
  assert.equal(child.KEEP, "yes");
  assert.equal(parent.PYTHONUTF8, "0");
});
await check("TF02-near-deadline-second-rule-compensates-first", async () => {
  const initial = Date.parse("2030-01-01T00:00:00.000Z");
  const deadline = initial + 70_000;
  const clock = { value: initial };
  const f = integratedFixture({ clock, deadlineAt: new Date(deadline).toISOString(),
    onSubmission: ({ count }) => { if (count === 1) clock.value = deadline - 150; } });
  await assert.rejects(f.operation.invoke(await approvedEffect(f)), /all attempted targets restored/u);
  assert.deepEqual(f.submissions, [
    { name: names[0], revision: f.afterArn },
    { name: names[0], revision: f.beforeArn },
  ]);
  assert.ok(names.every(name => f.targets[name].EcsParameters.TaskDefinitionArn === f.beforeArn));
});
await check("TF03-forward-window-boundary-and-compensation", async () => {
  const start = Date.parse("2030-01-01T00:00:00.000Z");
  const make = remaining => fixture({ now: () => new Date(start) });
  for (const remaining of [1, 150, 30_000, 35_000]) {
    const f = make(remaining);
    await assert.rejects(f.transport.putTarget(names[0], target, approvedProof(names[0], afterArn,
      { deadlineAt: new Date(start + remaining).toISOString() })), error => error.schedulePreWriteFailure === true);
    assert.deepEqual(f.calls.map(args => `${args[0]}:${args[1]}`), ["sts:get-caller-identity"]);
  }
  const f = make(35_001);
  const result = await f.transport.putTarget(names[0], target, approvedProof(names[0], afterArn,
    { deadlineAt: new Date(start + 35_001).toISOString() }));
  assert.equal(result.FailedEntryCount, 0);
  const compensation = await f.transport.putTarget(names[0], approvedTarget(names[0]),
    approvedProof(names[0], beforeArn, { compensation: true,
      deadlineAt: new Date(start - 1).toISOString() }));
  assert.equal(compensation.FailedEntryCount, 0);
});
await check("TF04-compensation-cleanup-warning-remains-visible", async () => {
  const f = integratedFixture({ denySecond: true, cleanupFailure: true });
  await assert.rejects(f.operation.invoke(await approvedEffect(f)), error =>
    /all attempted targets restored/u.test(error.message) &&
    /temporary cleanup warnings 2/u.test(error.message) &&
    !/private path/u.test(error.message));
  assert.ok(names.every(name => f.targets[name].EcsParameters.TaskDefinitionArn === f.beforeArn));
});

await writeFile(path.join(output, "result.json"), `${JSON.stringify({ complete: true, passed: checks.length, checks }, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`schedule transport ${checks.length}/${checks.length}\n`);
