import { stableJson } from "./runtime-db-transition-state.mjs";
import {
  assertScheduleSwitchEffect, projectScheduleTargets, validatePhaseProjection,
} from "./runtime-db-transition-adapter.mjs";
import { projectScheduleObservation } from "./runtime-db-transition-schedule.mjs";

function same(a, b) { return stableJson(a) === stableJson(b); }
function copy(value) { return structuredClone(value); }
function normalizeRow(row) { return { ...row, enableExecuteCommand: row.enableExecuteCommand ?? false }; }
function normalizeProjection(value) {
  return { rules: value.rules.map(normalizeRow) };
}
function withoutRevision(row) { return { ...row, taskDefinitionArn: "[revision]" }; }
function rowFor(projection, name) {
  const matches = projection.rules.filter(row => row.name === name);
  if (matches.length !== 1) throw new Error("schedule rule identity changed");
  return matches[0];
}
function assertPutResult(result) {
  if (result?.FailedEntryCount !== 0 ||
      (result.FailedEntries !== undefined && (!Array.isArray(result.FailedEntries) || result.FailedEntries.length !== 0))) {
    throw new Error("PutTargets reported a failed entry");
  }
}
function unknownOutcome(message, cause) {
  const error = new Error(message, { cause });
  error.outcomeUnknown = true;
  return error;
}
function externalChange(message, cause) {
  const error = new Error(message, { cause });
  error.externalChange = true;
  return error;
}

export function createScheduleSwitchOperation({ contract, plan, readAws, putTarget, assertDurablePending, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (plan?.version !== contract?.planVersion || !Array.isArray(plan.current?.schedules) ||
      typeof readAws !== "function" || typeof putTarget !== "function" || typeof assertDurablePending !== "function" || typeof pause !== "function") {
    throw new Error("schedule switch adapters, plan, and durable pending check are required");
  }
  const approvedPlan = copy(plan);
  approvedPlan.current.schedules = approvedPlan.current.schedules.map(normalizeRow);
  const baseline = validatePhaseProjection(contract, "schedules_switched", { rules: approvedPlan.current.schedules });

  async function readRule(name) {
    const rule = await readAws("events", "describe-rule", ["--name", name]);
    const targets = await readAws("events", "list-targets-by-rule", ["--rule", name]);
    if (targets?.NextToken || !Array.isArray(targets?.Targets) || targets.Targets.length !== 1) throw externalChange("schedule target listing changed");
    return { rule, targets };
  }
  async function readAll() {
    const responses = [];
    for (const name of contract.scheduleRules) responses.push(await readRule(name));
    const projection = normalizeProjection(projectScheduleTargets(contract, approvedPlan, responses));
    return { responses, projection };
  }
  // Read both rules so the same strict field and cardinality checks apply at every step.
  async function readCurrent() { return (await readAll()).projection; }
  async function readNamed(name) {
    if (!contract.scheduleRules.includes(name)) throw new Error("schedule name is not approved");
    const response = await readRule(name);
    try {
      const row = normalizeRow(projectScheduleObservation(contract, response.rule, response.targets));
      const expected = rowFor(baseline, name);
      if (row.eventBusName !== expected.eventBusName || row.targetId !== expected.targetId) throw new Error("schedule target identity changed");
      const checked = validatePhaseProjection(contract, "schedules_switched", {
        rules: baseline.rules.map(item => item.name === name ? row : item),
      });
      return { response, row: rowFor(checked, name) };
    } catch (error) { throw externalChange("schedule changed outside the transition", error); }
  }
  async function waitFor(name, expected, base) {
    for (let attempt = 0; attempt < 30; attempt++) {
      let current;
      try { current = (await readNamed(name)).row; }
      catch (error) {
        if (error.externalChange) throw error;
        throw unknownOutcome("schedule readback could not establish the write outcome", error);
      }
      if (same(current, expected)) return;
      if (!same(withoutRevision(current), withoutRevision(base))) throw new Error("schedule changed outside the transition");
      if (attempt < 29) await pause(1000);
    }
    throw unknownOutcome("schedule target did not converge after PutTargets");
  }
  function checkedEffect(preCas, plannedEffect) {
    const before = validatePhaseProjection(contract, "schedules_switched", normalizeProjection(preCas));
    const after = validatePhaseProjection(contract, "schedules_switched", normalizeProjection(plannedEffect));
    if (!same(before, baseline)) throw new Error("schedule pre-CAS differs from approved plan");
    const next = after.rules[0]?.taskDefinitionArn;
    assertScheduleSwitchEffect(contract, before, after, next);
    return { before, after };
  }
  async function guardedPut(name, rawTarget, revision, preCas, plannedEffect, { rollback = false, compensation = false, onAttempt = () => {}, onNotSubmitted = () => {} } = {}) {
    const approvedRevision = rowFor(rollback || compensation ? preCas : plannedEffect, name).taskDefinitionArn;
    if (revision !== approvedRevision) throw new Error("schedule write revision differs from the approved effect");
    const proof = { phase: "schedules_switched", preCas, plannedEffect, rollback, compensation, checkOnly: false,
      targetName: name, taskDefinitionArn: revision };
    const authorization = await assertDurablePending(proof);
    if (authorization?.deadlineAt !== undefined) proof.deadlineAt = authorization.deadlineAt;
    const target = copy(rawTarget);
    target.EcsParameters.TaskDefinitionArn = revision;
    onAttempt();
    let result;
    try { result = await putTarget(name, target, proof); }
    catch (error) {
      if (error?.schedulePreWriteFailure === true) { onNotSubmitted(); throw error; }
      throw unknownOutcome("PutTargets response was not received", error);
    }
    assertPutResult(result);
    return result.scheduleTemporaryCleanupFailed === true;
  }

  return Object.freeze({
    readCurrent,
    async invoke({ preCas, plannedEffect }) {
      const { before, after } = checkedEffect(preCas, plannedEffect);
      await assertDurablePending({ phase: "schedules_switched", preCas: before, plannedEffect: after, checkOnly: true });
      if (!same(await readCurrent(), before)) throw new Error("schedule changed since durable pre-CAS");
      const attempted = new Set();
      let cleanupWarnings = 0;
      try {
        for (const name of contract.scheduleRules) {
          const { response, row } = await readNamed(name);
          if (!same(row, rowFor(before, name))) throw new Error("schedule changed before PutTargets");
          if (await guardedPut(name, response.targets.Targets[0], rowFor(after, name).taskDefinitionArn, before, after,
            { onAttempt: () => attempted.add(name), onNotSubmitted: () => attempted.delete(name) })) cleanupWarnings++;
          await waitFor(name, rowFor(after, name), rowFor(before, name));
        }
        return { status: "switched", writes: attempted.size, cleanupWarnings };
      } catch (error) {
        if (error.outcomeUnknown) throw new Error(`schedule switch outcome is unknown; manual recovery required: ${error.message}`);
        let restored = true;
        for (const name of attempted) {
          try {
            const { response, row } = await readNamed(name);
            const oldRow = rowFor(before, name);
            const newRow = rowFor(after, name);
            if (!same(row, oldRow) && !same(row, newRow)) throw new Error("external schedule change");
            if (await guardedPut(name, response.targets.Targets[0], oldRow.taskDefinitionArn, before, after,
              { compensation: true })) cleanupWarnings++;
            await waitFor(name, oldRow, newRow);
          } catch { restored = false; }
        }
        if (restored) {
          try { restored = same(await readCurrent(), before); }
          catch { restored = false; }
        }
        throw new Error(`schedule switch failed; ${restored ? "all attempted targets restored" : "manual recovery required"}` +
          `${cleanupWarnings ? `; temporary cleanup warnings ${cleanupWarnings}` : ""}: ${error.message}`);
      }
    },
    async restore({ preCas, plannedEffect }) {
      const { before, after } = checkedEffect(preCas, plannedEffect);
      await assertDurablePending({ phase: "schedules_switched", preCas: before, plannedEffect: after, rollback: true, checkOnly: true });
      const current = await readCurrent();
      for (const row of current.rules) {
        if (!same(row, rowFor(before, row.name)) && !same(row, rowFor(after, row.name))) {
          throw new Error("schedule changed outside the approved rollback states");
        }
      }
      let writes = 0;
      let cleanupWarnings = 0;
      for (const name of contract.scheduleRules) {
        const { response, row } = await readNamed(name);
        const oldRow = rowFor(before, name);
        const newRow = rowFor(after, name);
        if (!same(row, oldRow) && !same(row, newRow)) throw new Error("schedule changed during rollback");
        if (await guardedPut(name, response.targets.Targets[0], oldRow.taskDefinitionArn, before, after,
          { rollback: true })) cleanupWarnings++;
        await waitFor(name, oldRow, newRow);
        writes++;
      }
      if (!same(await readCurrent(), before)) throw new Error("schedule changed during rollback verification");
      return { status: "restored", writes, cleanupWarnings };
    },
  });
}
