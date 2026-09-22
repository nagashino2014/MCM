import { sha256, stableJson } from "./runtime-db-transition-state.mjs";
import { projectScheduleObservation } from "./runtime-db-transition-schedule.mjs";
import { projectNextService } from "./runtime-db-transition-adapter.mjs";

const PLAN_VERSION = "r0b-schedule-pin-plan-v1";

function digest(value) { return sha256(Buffer.from(stableJson(value), "utf8")); }
function copy(value) { return structuredClone(value); }

function revisionArn(contract, value) {
  const prefix = `arn:${contract.partition}:ecs:${contract.region}:${contract.accountId}:task-definition/${contract.components.next.family}:`;
  if (typeof value !== "string" || !value.startsWith(prefix) || !/^[1-9][0-9]*$/u.test(value.slice(prefix.length))) {
    throw new Error("Next task definition requires a numeric revision");
  }
  return value;
}

export async function collectSchedulePinPlan(contract, readAws) {
  if (typeof readAws !== "function" || !Array.isArray(contract?.scheduleRules) || contract.scheduleRules.length !== 2) {
    throw new Error("schedule pin inputs are invalid");
  }
  const caller = await readAws("sts", "get-caller-identity", []);
  if (String(caller?.Account) !== String(contract.accountId)) throw new Error("staging account mismatch");
  const serviceResponse = await readAws("ecs", "describe-services", ["--cluster", contract.cluster, "--services", contract.nextService]);
  const service = projectNextService(contract, serviceResponse);
  if (service.desiredCount < 1 || service.desiredCount !== service.runningCount || service.pendingCount !== 0 ||
      service.primaryTaskDefinitionArn !== service.taskDefinitionArn || service.primaryRolloutState !== "COMPLETED") {
    throw new Error("Next service is not stable");
  }
  const newest = await readAws("ecs", "list-task-definitions", ["--family-prefix", contract.components.next.family, "--status", "ACTIVE", "--sort", "DESC", "--max-results", "1"]);
  if (!Array.isArray(newest?.taskDefinitionArns) || newest.taskDefinitionArns.length !== 1 || newest.taskDefinitionArns[0] !== service.taskDefinitionArn) {
    throw new Error("Next service is not the latest ACTIVE revision");
  }
  const familyArn = service.taskDefinitionArn.slice(0, service.taskDefinitionArn.lastIndexOf(":"));
  const schedules = [];
  for (const name of contract.scheduleRules) {
    const rule = await readAws("events", "describe-rule", ["--name", name]);
    const listing = await readAws("events", "list-targets-by-rule", ["--rule", name]);
    const projection = projectScheduleObservation(contract, rule, listing);
    if (projection.name !== name || projection.state !== "ENABLED") {
      throw new Error("schedule rule or target mismatch");
    }
    if (![familyArn, service.taskDefinitionArn].includes(projection.taskDefinitionArn)) {
      throw new Error("schedule target is neither family-only nor pinned to the current service");
    }
    schedules.push({ name, rule: copy(rule), target: copy(listing.Targets[0]), projection });
  }
  const modes = new Set(schedules.map(item => item.projection.taskDefinitionArn));
  if (modes.size !== 1) throw new Error("schedule targets are in a mixed state");
  const mode = modes.has(familyArn) ? "pin_required" : "already_pinned";
  const contractSha256 = digest(contract);
  const basis = {
    version: PLAN_VERSION,
    contractSha256,
    serviceTaskDefinitionSha256: digest(service.taskDefinitionArn),
    mode,
    schedules: schedules.map(item => ({ name: item.name, ruleSha256: digest(item.rule), targetSha256: digest(item.target) })),
  };
  return {
    version: PLAN_VERSION,
    planId: digest(basis),
    mode,
    revision: service.taskDefinitionArn.slice(service.taskDefinitionArn.lastIndexOf(":") + 1),
    serviceTaskDefinitionArn: service.taskDefinitionArn,
    contractSha256,
    schedules,
  };
}

export function publicSchedulePinPlan(plan) {
  return {
    version: plan.version,
    planId: plan.planId,
    mode: plan.mode,
    revision: plan.revision,
    ruleCount: plan.schedules.length,
    approvedInputMatches: true,
  };
}

function changedTarget(original, revision) {
  const target = copy(original);
  target.EcsParameters.TaskDefinitionArn = revision;
  return target;
}

function comparableTarget(contract, rule, target) {
  const projection = projectScheduleObservation(contract, rule, { Targets: [target] });
  // EventBridge can omit a false default after PutTargets; both mean command execution is disabled.
  return { ...projection, enableExecuteCommand: projection.enableExecuteCommand ?? false };
}

function sameTarget(contract, rule, left, right, ignoreRevision = false) {
  const a = comparableTarget(contract, rule, left);
  const b = comparableTarget(contract, rule, right);
  if (ignoreRevision) { delete a.taskDefinitionArn; delete b.taskDefinitionArn; }
  return digest(a) === digest(b);
}

async function readTarget(readAws, name) {
  const listing = await readAws("events", "list-targets-by-rule", ["--rule", name]);
  if (listing?.NextToken || !Array.isArray(listing?.Targets) || listing.Targets.length !== 1) throw new Error("schedule target listing changed");
  return listing.Targets[0];
}

async function waitForTarget(contract, rule, readAws, name, expected, pause) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const current = await readTarget(readAws, name);
    if (sameTarget(contract, rule, current, expected)) return;
    if (!sameTarget(contract, rule, current, expected, true)) throw new Error("schedule target changed outside the pin operation");
    if (attempt < 29) await pause(1000);
  }
  throw new Error("schedule target did not converge after PutTargets");
}

function assertPutResult(result) {
  if (result?.FailedEntryCount !== 0 || (result.FailedEntries !== undefined &&
      (!Array.isArray(result.FailedEntries) || result.FailedEntries.length !== 0))) {
    throw new Error("PutTargets reported a failed entry");
  }
}

export async function applySchedulePinPlan({ contract, approvedPlanId, readAws, putTarget, saveRecovery, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!/^[0-9a-f]{64}$/u.test(approvedPlanId ?? "")) throw new Error("approved plan ID is invalid");
  if (typeof putTarget !== "function" || typeof saveRecovery !== "function") throw new Error("schedule pin write and recovery adapters are required");
  const plan = await collectSchedulePinPlan(contract, readAws);
  if (plan.planId !== approvedPlanId) throw new Error("schedule pin plan changed since approval");
  if (plan.mode === "already_pinned") return { status: "already_pinned", planId: plan.planId, writes: 0 };
  const recovery = {
    version: "r0b-schedule-pin-recovery-v1",
    planId: plan.planId,
    contractSha256: plan.contractSha256,
    revision: plan.revision,
    originalTargets: plan.schedules.map(item => ({ name: item.name, rule: item.rule, target: item.target })),
  };
  await saveRecovery(recovery); // durable, exclusive write must finish before either AWS mutation
  const attempted = new Set();
  try {
    for (const item of plan.schedules) {
      const before = await readTarget(readAws, item.name);
      if (digest(before) !== digest(item.target)) throw new Error("schedule target changed since approval");
      const intended = changedTarget(item.target, plan.serviceTaskDefinitionArn);
      attempted.add(item.name);
      assertPutResult(await putTarget(item.name, intended));
      await waitForTarget(contract, item.rule, readAws, item.name, intended, pause);
    }
    return { status: "pinned", planId: plan.planId, writes: plan.schedules.length };
  } catch (error) {
    let rollbackComplete = true;
    for (const item of plan.schedules) {
      try {
        const current = await readTarget(readAws, item.name);
        const intended = changedTarget(item.target, plan.serviceTaskDefinitionArn);
        if (!sameTarget(contract, item.rule, current, item.target) && !sameTarget(contract, item.rule, current, intended)) throw new Error("external schedule change during rollback");
        if (!attempted.has(item.name)) continue;
        assertPutResult(await putTarget(item.name, item.target));
        await waitForTarget(contract, item.rule, readAws, item.name, item.target, pause);
      } catch { rollbackComplete = false; }
    }
    const suffix = rollbackComplete ? "all targets restored" : "manual recovery required from the saved original targets";
    throw new Error(`schedule pin failed; ${suffix}: ${error.message}`);
  }
}

export async function rollbackSchedulePin({ contract, approvedPlanId, recovery, readAws, putTarget, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!/^[0-9a-f]{64}$/u.test(approvedPlanId ?? "") || recovery?.version !== "r0b-schedule-pin-recovery-v1" ||
      recovery.planId !== approvedPlanId || recovery.contractSha256 !== digest(contract) ||
      !/^[1-9][0-9]*$/u.test(recovery.revision ?? "") ||
      !Array.isArray(recovery.originalTargets) || recovery.originalTargets.length !== contract.scheduleRules.length) {
    throw new Error("schedule pin recovery record or approval is invalid");
  }
  const intendedArn = revisionArn(contract, `arn:${contract.partition}:ecs:${contract.region}:${contract.accountId}:task-definition/${contract.components.next.family}:${recovery.revision}`);
  const familyArn = intendedArn.slice(0, intendedArn.lastIndexOf(":"));
  const rows = [];
  for (const name of contract.scheduleRules) {
    const matches = recovery.originalTargets.filter(item => item?.name === name);
    if (matches.length !== 1) throw new Error("recovery rule set mismatch");
    const item = matches[0];
    const projection = projectScheduleObservation(contract, item.rule, { Targets: [item.target] });
    if (projection.name !== name || projection.state !== "ENABLED" || projection.taskDefinitionArn !== familyArn) {
      throw new Error("recovery target is not the approved family-only baseline");
    }
    rows.push(item);
  }
  const basis = {
    version: PLAN_VERSION,
    contractSha256: recovery.contractSha256,
    serviceTaskDefinitionSha256: digest(intendedArn),
    mode: "pin_required",
    schedules: rows.map(item => ({ name: item.name, ruleSha256: digest(item.rule), targetSha256: digest(item.target) })),
  };
  if (digest(basis) !== approvedPlanId) throw new Error("recovery target content differs from the approved plan");
  const caller = await readAws("sts", "get-caller-identity", []);
  if (String(caller?.Account) !== String(contract.accountId)) throw new Error("staging account mismatch");
  for (const item of rows) {
    const current = await readTarget(readAws, item.name);
    if (!sameTarget(contract, item.rule, current, item.target) && !sameTarget(contract, item.rule, current, changedTarget(item.target, intendedArn))) {
      throw new Error("schedule target changed outside the approved pin operation");
    }
  }
  let writes = 0;
  for (const item of rows) {
    const current = await readTarget(readAws, item.name);
    if (sameTarget(contract, item.rule, current, item.target)) continue;
    if (!sameTarget(contract, item.rule, current, changedTarget(item.target, intendedArn))) throw new Error("schedule target changed during rollback");
    assertPutResult(await putTarget(item.name, item.target));
    await waitForTarget(contract, item.rule, readAws, item.name, item.target, pause);
    writes++;
  }
  return { status: "restored", planId: approvedPlanId, writes };
}
