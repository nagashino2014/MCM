import { sha256, stableJson } from "./runtime-db-transition-state.mjs";
import { buildScheduleSwitchEffect, projectNextService } from "./runtime-db-transition-adapter.mjs";
import { createScheduleSwitchOperation } from "./runtime-db-transition-schedule-write.mjs";

function same(left, right) { return stableJson(left) === stableJson(right); }
function sleep(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }

// Local composition only. The caller must supply an authenticated transport;
// this module does not obtain credentials or authorize a real AWS transition.
export function createScheduleTransitionStage({ store, contract, plan, transitionId, readAws, putTarget,
  now = () => new Date(), pause = sleep, stableReadCount = 3, stableReadIntervalMs = 5000 }) {
  if (!store || typeof store.load !== "function" || typeof store.executePhase !== "function" ||
      !contract || !plan || typeof transitionId !== "string" || !transitionId ||
      typeof readAws !== "function" || typeof putTarget !== "function" ||
      typeof now !== "function" || typeof pause !== "function" ||
      !Number.isInteger(stableReadCount) || stableReadCount < 3 ||
      !Number.isInteger(stableReadIntervalMs) || stableReadIntervalMs < 1000) {
    throw new Error("schedule stage requires a durable store, bound plan, transport, and stable-read policy");
  }
  const planDigest = sha256(Buffer.from(stableJson(plan), "utf8"));
  const phase = "schedules_switched";

  async function assertPredecessors(state) {
    if (state?.transitionId !== transitionId || state.planSha256 !== planDigest || state.rollback != null ||
        !["active", "complete"].includes(state.status)) {
      throw new Error("schedule stage is not bound to an active approved transition");
    }
    for (const name of contract.durableExecution.phaseOrder.slice(0, 5)) {
      if (state.phases[name]?.status !== "complete") throw new Error(`schedule stage predecessor '${name}' is not complete`);
    }
    const registered = state.phases.next_registered_disabled.plannedEffect?.taskDefinitionArn;
    const service = state.phases.next_service_stable.plannedEffect;
    if (typeof registered !== "string" || !service || registered !== service.taskDefinitionArn ||
        registered !== service.primaryTaskDefinitionArn || service.primaryStatus !== "PRIMARY" ||
        service.primaryRolloutState !== "COMPLETED" || service.pendingCount !== 0 ||
        service.desiredCount !== service.runningCount) {
      throw new Error("schedule target revision is not the registered stable Next service revision");
    }
    if (!Array.isArray(plan.current?.schedules) ||
        plan.current.schedules.some(row => row.taskDefinitionArn === registered)) {
      throw new Error("schedule target revision does not advance the approved schedule baseline");
    }
    return { registered, service };
  }

  async function assertServiceCurrent(expected) {
    const raw = await readAws("ecs", "describe-services", ["--cluster", contract.cluster, "--services", contract.nextService]);
    if (!Array.isArray(raw?.services) || raw.services.length !== 1 ||
        !Array.isArray(raw.services[0]?.deployments) || raw.services[0].deployments.length !== 1) {
      throw new Error("Next service does not have one settled deployment");
    }
    const observed = projectNextService(contract, raw);
    if (!same(observed, expected)) throw new Error("Next service changed before the schedule transition");
  }

  async function assertServiceIdentity(expected) {
    const raw = await readAws("ecs", "describe-services", ["--cluster", contract.cluster, "--services", contract.nextService]);
    if (!Array.isArray(raw?.services) || raw.services.length !== 1 ||
        !Array.isArray(raw.services[0]?.deployments) || raw.services[0].deployments.length !== 1) {
      throw new Error("Next service does not have one settled deployment");
    }
    const observed = projectNextService(contract, raw);
    if (observed.taskDefinitionArn !== expected.taskDefinitionArn ||
        observed.primaryTaskDefinitionArn !== expected.primaryTaskDefinitionArn ||
        observed.primaryStatus !== expected.primaryStatus ||
        observed.primaryRolloutState !== expected.primaryRolloutState) {
      throw new Error("Next service revision changed during the schedule transition");
    }
  }

  function operation(assertDurablePending) {
    return createScheduleSwitchOperation({ contract, plan, readAws, putTarget, assertDurablePending, pause });
  }
  const reader = operation(async () => { throw new Error("read-only schedule projection cannot authorize writes"); });

  async function stableRead() {
    let prior;
    for (let index = 0; index < stableReadCount; index++) {
      if (index) await pause(stableReadIntervalMs);
      const observed = await reader.readCurrent();
      if (prior && !same(prior, observed)) throw new Error("schedule projection changed during stable reads");
      prior = observed;
    }
    return prior;
  }

  return Object.freeze({
    async execute() {
      const state = await store.load();
      const { registered, service } = await assertPredecessors(state);
      await assertServiceCurrent(service);
      if (state.phases[phase]?.status === "complete") {
        if (!same(await stableRead(), state.phases[phase].plannedEffect)) {
          throw new Error("completed schedule transition no longer matches AWS");
        }
        return { replay: true, invoked: false, state };
      }
      if (state.status !== "active") throw new Error("schedule stage cannot start after the transition completed");
      // After a lost response even repeated pre-CAS reads can be stale. Never
      // automatically re-invoke a pending schedule write in this composition.
      if (state.phases[phase]) throw new Error("existing schedule phase needs operator review before any retry");
      const preCas = await stableRead();
      const normalizedPlan = structuredClone(plan);
      normalizedPlan.current.schedules = normalizedPlan.current.schedules.map(row => ({
        ...row, enableExecuteCommand: row.enableExecuteCommand ?? false,
      }));
      const plannedEffect = buildScheduleSwitchEffect(contract, normalizedPlan, preCas, registered);
      return store.executePhase({ transitionId, plan, phase, preCas, plannedEffect,
        readCurrent: async () => { await assertServiceIdentity(service); return stableRead(); },
        invoke: async context => {
          if (context.transitionId !== transitionId || context.phase !== phase) {
            throw new Error("schedule invocation identity changed");
          }
          const writer = operation(async proof => {
            const active = await store.load();
            const record = active?.phases?.[phase];
            if (active?.transitionId !== transitionId || active.planSha256 !== planDigest || active.rollback != null ||
                active.status !== "active" || record?.status !== "pending" || proof.rollback === true ||
                !same(record.preCas, proof.preCas) || !same(record.plannedEffect, proof.plannedEffect) ||
                record.deadlineAt !== context.deadlineAt) {
              throw new Error("schedule durable pending identity changed");
            }
            if (proof.checkOnly === true) {
              if (proof.compensation === true || proof.targetName !== undefined || proof.taskDefinitionArn !== undefined) {
                throw new Error("schedule preflight proof cannot authorize a target write");
              }
            } else if (proof.checkOnly === false) {
              const approvedRows = (proof.compensation === true ? record.preCas : record.plannedEffect).rules;
              const approved = approvedRows.filter(row => row.name === proof.targetName);
              if (approved.length !== 1 || !contract.scheduleRules.includes(proof.targetName) ||
                  proof.taskDefinitionArn !== approved[0].taskDefinitionArn) {
                throw new Error("schedule write target revision is not approved by the durable phase");
              }
            } else {
              throw new Error("schedule proof must identify preflight or target write");
            }
            // Compensation returns only an attempted target to its approved pre-CAS.
            // A changed service or elapsed forward deadline must not strand mixed revisions.
            if (proof.compensation !== true) {
              if (!(Date.parse(record.deadlineAt) > now().getTime())) throw new Error("schedule forward deadline expired");
              await assertServiceIdentity(service);
            }
            return { deadlineAt: record.deadlineAt };
          });
          return writer.invoke(context);
        },
      });
    },
    readCurrent: stableRead,
  });
}
