import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";

export const STATE_VERSION = "r0b-runtime-transition-state-v5";
const EVENT_VERSION = "r0b-runtime-transition-event-v2";
const SUPPORTED_STATE_VERSIONS = new Set([
  "r0b-runtime-transition-state-v2",
  "r0b-runtime-transition-state-v3",
  "r0b-runtime-transition-state-v4",
  STATE_VERSION,
]);

function assertSupportedStateVersion(state) {
  if (state && !SUPPORTED_STATE_VERSIONS.has(state.version)) {
    throw new Error(`unsupported transition state version '${state.version}'`);
  }
}

export function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function deriveRequestToken(transitionId, component) {
  return sha256(Buffer.from(`r0b:${transitionId}:${component}`, "utf8"));
}

function same(left, right) {
  return stableJson(left) === stableJson(right);
}

export function recoveryDecision(preCas, plannedEffect, observed, convergencePending = false) {
  if (same(observed, plannedEffect)) return "planned_effect_current";
  if (same(observed, preCas)) return "pre_cas_still_current";
  if (convergencePending) return "convergence_pending";
  return "external_interference";
}

export function phaseTimeoutSeconds(contract, phase) {
  const configured = contract.durableExecution?.phaseTimeoutSeconds?.[phase];
  const fallback = contract.durableExecution?.defaultPhaseTimeoutSeconds;
  const value = Number(configured ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`invalid timeout for phase '${phase}'`);
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  if (!same(actual, wanted)) throw new Error(`${label} property set mismatch`);
}

function validateTransitionId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/u.test(value)) {
    throw new Error("transitionId must be 8-64 safe ASCII characters");
  }
}

function validatePlan(plan, contract) {
  exactKeys(plan, ["version", "ready", "sourceSnapshotSha256", "sourceCapturedAt", "collector", "captureWindow", "secretVersions", "iamPolicies", "current", "candidates", "queue", "phases", "rollback"], "transition plan");
  if (plan.version !== contract.planVersion || plan.ready !== true) throw new Error("transition plan is not ready or has the wrong version");
  if (plan.collector?.name !== contract.collector.name || plan.collector?.version !== contract.collector.version) throw new Error("transition plan collector identity mismatch");
  if (!/^[0-9a-f]{64}$/u.test(plan.sourceSnapshotSha256 ?? "")) throw new Error("transition plan snapshot hash is invalid");
  if (!same(plan.phases, contract.durableExecution.phaseOrder)) throw new Error("transition plan phase order mismatch");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeNewJson(file, value) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(`${stableJson(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAtomicJson(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeNewJson(temporary, value);
  try {
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function sleepFor(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export class DurableTransitionStore {
  constructor({ stateDirectory, contract, now = () => new Date(), host = hostname(), staleLockGraceSeconds = 30 }) {
    this.stateDirectory = path.resolve(stateDirectory);
    this.contract = contract;
    this.now = now;
    this.hostFingerprint = sha256(Buffer.from(String(host), "utf8"));
    this.staleLockGraceSeconds = staleLockGraceSeconds;
    this.lockPath = path.join(this.stateDirectory, ".runtime-db-transition.lock");
    this.recoveryLockPath = path.join(this.stateDirectory, ".runtime-db-transition.lock.recovery");
    this.activePath = path.join(this.stateDirectory, "active-transition.json");
    this.eventsDirectory = path.join(this.stateDirectory, "events");
    this.historyDirectory = path.join(this.stateDirectory, "history");
  }

  timestamp() {
    return this.now().toISOString();
  }

  async reclaimStaleLock() {
    let recoveryHandle;
    const recoveryRecord = {
      version: "r0b-runtime-transition-recovery-lock-v2",
      lockId: randomUUID(),
      hostFingerprint: this.hostFingerprint,
      pid: process.pid,
      acquiredAt: this.timestamp(),
    };
    try {
      recoveryHandle = await open(this.recoveryLockPath, "wx", 0o600);
      await recoveryHandle.writeFile(`${stableJson(recoveryRecord)}\n`, "utf8");
      await recoveryHandle.sync();
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new Error("durable state recovery lock is held or left by an interrupted recovery; inspect it before manual release");
      }
      throw error;
    }
    try {
      let lockRecord;
      try {
        lockRecord = await readJson(this.lockPath);
      } catch (error) {
        if (error.code === "ENOENT") return true;
        const metadata = await stat(this.lockPath).catch(() => null);
        const ageMilliseconds = metadata ? Date.now() - metadata.mtimeMs : 0;
        if (!metadata || ageMilliseconds < this.staleLockGraceSeconds * 1000) {
          throw new Error("durable state lock is unreadable; retry after the stale-lock grace period or recover it manually");
        }
        lockRecord = { hostFingerprint: this.hostFingerprint, pid: -1 };
      }
      const sameHost = lockRecord.hostFingerprint === this.hostFingerprint
        || (typeof lockRecord.hostname === "string" && sha256(Buffer.from(lockRecord.hostname, "utf8")) === this.hostFingerprint);
      if (!sameHost || processIsAlive(Number(lockRecord.pid))) return false;
      const quarantine = `${this.lockPath}.stale.${Date.now()}.${randomUUID()}`;
      try {
        await rename(this.lockPath, quarantine);
      } catch (error) {
        if (error.code === "ENOENT") return true;
        throw error;
      }
      await rm(quarantine, { force: true });
      return true;
    } finally {
      await recoveryHandle.close().catch(() => {});
      let current;
      try { current = await readJson(this.recoveryLockPath); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (current?.lockId === recoveryRecord.lockId) await rm(this.recoveryLockPath, { force: true });
    }
  }

  async acquireLock(transitionId) {
    await mkdir(this.stateDirectory, { recursive: true });
    for (let attempt = 0; attempt < 4; attempt++) {
      let handle;
      try {
        handle = await open(this.lockPath, "wx", 0o600);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (!await this.reclaimStaleLock()) throw new Error("another transition executor holds the durable state lock");
        continue;
      }
      const record = {
        version: "r0b-runtime-transition-lock-v3",
        lockId: randomUUID(),
        transitionId,
        hostFingerprint: this.hostFingerprint,
        pid: process.pid,
        acquiredAt: this.timestamp(),
      };
      await handle.writeFile(`${stableJson(record)}\n`, "utf8");
      await handle.sync();
      return { handle, record };
    }
    throw new Error("durable state lock could not be acquired after stale-lock recovery");
  }

  async releaseLock(lease) {
    await lease.handle.close().catch(() => {});
    let current;
    try { current = await readJson(this.lockPath); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (current.lockId === lease.record.lockId) await rm(this.lockPath, { force: true });
  }

  async withExclusiveLock(transitionId, callback) {
    validateTransitionId(transitionId);
    const lease = await this.acquireLock(transitionId);
    try {
      return await callback();
    } finally {
      await this.releaseLock(lease);
    }
  }

  async eventFiles() {
    let names;
    try { names = await readdir(this.eventsDirectory); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
    const events = [];
    for (const name of names.filter(item => /^\d{8}-.+\.json$/u.test(item)).sort()) {
      events.push(await readJson(path.join(this.eventsDirectory, name)));
    }
    return events;
  }

  async reconcile(active) {
    const events = await this.eventFiles();
    let transitionId = active?.transitionId ?? null;
    if (!transitionId) {
      const archived = new Set();
      try {
        for (const name of await readdir(this.historyDirectory)) if (name.endsWith(".json")) archived.add(name.slice(0, -5));
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      const candidates = [...new Set(events.map(event => event.transitionId).filter(id => !archived.has(id)))];
      if (candidates.length > 1) throw new Error("multiple unarchived transition journals require manual intervention");
      transitionId = candidates[0] ?? null;
    }
    if (!transitionId) return active;
    const journal = events.filter(event => event.transitionId === transitionId).sort((left, right) => left.sequence - right.sequence);
    for (let index = 0; index < journal.length; index++) {
      if (journal[index].sequence !== index + 1) throw new Error(`transition '${transitionId}' event journal is not contiguous`);
    }
    if (!journal.length) {
      if (active?.eventSequence > 0) throw new Error(`transition '${transitionId}' active state is ahead of its event journal`);
      return active;
    }
    const last = journal[journal.length - 1];
    const activeSequence = active?.eventSequence ?? 0;
    if (activeSequence > last.sequence) throw new Error(`transition '${transitionId}' active state is ahead of its event journal`);
    if (activeSequence === last.sequence) return active;
    if (last.version !== EVENT_VERSION || !last.stateAfter || last.stateAfterSha256 !== sha256(Buffer.from(stableJson(last.stateAfter), "utf8"))) {
      throw new Error(`transition '${transitionId}' event journal cannot repair active state`);
    }
    assertSupportedStateVersion(last.stateAfter);
    await writeAtomicJson(this.activePath, last.stateAfter);
    return clone(last.stateAfter);
  }

  async load() {
    let active;
    try { active = await readJson(this.activePath); }
    catch (error) { if (error.code === "ENOENT") active = null; else throw error; }
    const state = await this.reconcile(active);
    assertSupportedStateVersion(state);
    return state;
  }

  async persist(state, type, detail = {}) {
    const next = clone(state);
    next.version = STATE_VERSION;
    next.eventSequence += 1;
    next.updatedAt = this.timestamp();
    const event = {
      version: EVENT_VERSION,
      sequence: next.eventSequence,
      transitionId: next.transitionId,
      occurredAt: next.updatedAt,
      type,
      detail: clone(detail),
      stateAfter: clone(next),
      stateAfterSha256: sha256(Buffer.from(stableJson(next), "utf8")),
    };
    await mkdir(this.eventsDirectory, { recursive: true });
    const name = `${String(event.sequence).padStart(8, "0")}-${next.transitionId}.json`;
    await writeNewJson(path.join(this.eventsDirectory, name), event);
    await writeAtomicJson(this.activePath, next);
    return clone(next);
  }

  async initializeUnlocked({ transitionId, plan }) {
    validateTransitionId(transitionId);
    validatePlan(plan, this.contract);
    const planSha256 = sha256(Buffer.from(stableJson(plan), "utf8"));
    const existing = await this.load();
    if (existing) {
      if (existing.transitionId === transitionId) {
        if (existing.planSha256 !== planSha256) throw new Error("transitionId is already bound to another plan");
        return clone(existing);
      }
      if (!["complete", "rollback_complete"].includes(existing.status)) throw new Error(`active transition '${existing.transitionId}' blocks a new transition`);
      if (await this.transitionIdWasUsed(transitionId)) throw new Error(`transitionId '${transitionId}' has already been used and cannot be reused`);
      await mkdir(this.historyDirectory, { recursive: true });
      await rename(this.activePath, path.join(this.historyDirectory, `${existing.transitionId}.json`));
    } else if (await this.transitionIdWasUsed(transitionId)) {
      throw new Error(`transitionId '${transitionId}' has already been used and cannot be reused`);
    }
    const planAgeSeconds = (this.now().getTime() - Date.parse(plan.sourceCapturedAt)) / 1000;
    if (!Number.isFinite(planAgeSeconds) || planAgeSeconds < -this.contract.snapshot.maximumFutureSkewSeconds || planAgeSeconds > this.contract.snapshot.maximumAgeSeconds) {
      throw new Error("transition plan is outside the allowed execution age");
    }
    const createdAt = this.timestamp();
    const state = {
      version: STATE_VERSION,
      transitionId,
      planSha256,
      sourceSnapshotSha256: plan.sourceSnapshotSha256,
      status: "active",
      currentPhase: null,
      createdAt,
      updatedAt: createdAt,
      eventSequence: 0,
      requestTokens: {
        appSecret: deriveRequestToken(transitionId, "app"),
        workerSecret: deriveRequestToken(transitionId, "worker"),
      },
      phases: {},
      rollback: null,
    };
    return this.persist(state, "transition_initialized", { planSha256 });
  }

  async initialize(input) {
    return this.withExclusiveLock(input.transitionId, () => this.initializeUnlocked(input));
  }

  async transitionIdWasUsed(transitionId) {
    try {
      await stat(path.join(this.historyDirectory, `${transitionId}.json`));
      return true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const folded = transitionId.toLowerCase();
    let historicalNames = [];
    try { historicalNames = await readdir(this.historyDirectory); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (historicalNames.some(name => name.endsWith(".json") && name.slice(0, -5).toLowerCase() === folded)) return true;
    return (await this.eventFiles()).some(event => event.transitionId.toLowerCase() === folded);
  }

  assertPhaseOrder(state, phase) {
    const order = this.contract.durableExecution.phaseOrder;
    const index = order.indexOf(phase);
    if (index < 0) throw new Error(`unknown transition phase '${phase}'`);
    for (let before = 0; before < index; before++) {
      if (state.phases[order[before]]?.status !== "complete") throw new Error(`phase '${phase}' cannot start before '${order[before]}' completes`);
    }
  }

  async beginPhaseUnlocked(state, phase, preCas, plannedEffect) {
    this.assertPhaseOrder(state, phase);
    const previous = state.phases[phase];
    if (previous?.status === "complete") return clone(state);
    if (previous?.status === "intervention_required") throw new Error(`phase '${phase}' requires intervention`);
    const startedAt = this.timestamp();
    const timeoutSeconds = phaseTimeoutSeconds(this.contract, phase);
    state.currentPhase = phase;
    state.phases[phase] = {
      status: "pending",
      attempt: (previous?.attempt ?? 0) + 1,
      startedAt,
      deadlineAt: new Date(Date.parse(startedAt) + timeoutSeconds * 1000).toISOString(),
      timeoutSeconds,
      preCas: clone(preCas),
      plannedEffect: clone(plannedEffect),
      invocationResult: null,
      lastObserved: null,
      lastObservedAt: null,
      result: null,
      completedAt: null,
      rollback: null,
    };
    return this.persist(state, "phase_pending", { phase, preCas, plannedEffect, timeoutSeconds });
  }

  async completePhaseUnlocked(state, phase, result) {
    const record = state.phases[phase];
    if (!record || record.status !== "pending") throw new Error(`phase '${phase}' is not pending`);
    record.status = "complete";
    record.result = clone(result);
    record.completedAt = this.timestamp();
    state.currentPhase = null;
    const order = this.contract.durableExecution.phaseOrder;
    if (order.every(name => state.phases[name]?.status === "complete")) state.status = "complete";
    return this.persist(state, "phase_complete", { phase, result });
  }

  async interventionUnlocked(state, phase, observed, reason = "external_interference") {
    const record = state.phases[phase];
    if (!record) throw new Error(`phase '${phase}' has no durable pending record`);
    record.status = "intervention_required";
    record.result = { reason, observed: clone(observed) };
    record.completedAt = this.timestamp();
    state.status = "intervention_required";
    state.currentPhase = phase;
    return this.persist(state, "phase_intervention_required", { phase, reason, observed });
  }

  deadlineExpired(record) {
    return this.now().getTime() >= Date.parse(record.deadlineAt);
  }

  async decide(record, observed, isConverging, phase) {
    let converging = false;
    if (!same(observed, record.preCas) && !same(observed, record.plannedEffect) && isConverging) {
      converging = await isConverging(clone(observed), {
        phase,
        preCas: clone(record.preCas),
        plannedEffect: clone(record.plannedEffect),
      }) === true;
    }
    return recoveryDecision(record.preCas, record.plannedEffect, observed, converging);
  }

  async observeUntilSettled({ state, phase, readCurrent, isConverging, pollIntervalMs, wait }) {
    let convergencePersisted = false;
    while (true) {
      const record = state.phases[phase];
      if (this.deadlineExpired(record)) {
        state = await this.interventionUnlocked(state, phase, record.lastObserved, "phase_deadline_exceeded");
        return { decision: "phase_deadline_exceeded", state };
      }
      const observed = await readCurrent();
      const decision = await this.decide(record, observed, isConverging, phase);
      if (decision !== "convergence_pending") return { decision, observed, state };
      if (!convergencePersisted || !same(record.lastObserved, observed)) {
        record.lastObserved = clone(observed);
        record.lastObservedAt = this.timestamp();
        state = await this.persist(state, "phase_convergence_pending", { phase, observed });
        convergencePersisted = true;
      }
      if (this.deadlineExpired(state.phases[phase])) {
        state = await this.interventionUnlocked(state, phase, observed, "phase_deadline_exceeded");
        return { decision: "phase_deadline_exceeded", observed, state };
      }
      await wait(pollIntervalMs);
    }
  }

  async executePhase({ transitionId, plan, phase, preCas, plannedEffect, readCurrent, invoke, isConverging = null, pollIntervalMs = 1000, wait = sleepFor }) {
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0) throw new Error("pollIntervalMs must be a non-negative integer");
    return this.withExclusiveLock(transitionId, async () => {
      let state = await this.initializeUnlocked({ transitionId, plan });
      if (state.rollback != null) {
        throw new Error(`transition is '${state.status}' and cannot execute a forward phase`);
      }
      const existing = state.phases[phase];
      if (existing?.status === "complete") return { replay: true, invoked: false, state, result: clone(existing.result) };
      if (existing?.status === "intervention_required") throw new Error(`phase '${phase}' requires intervention`);
      if (state.status !== "active") throw new Error(`transition is '${state.status}' and cannot execute a forward phase`);
      if (existing?.status === "pending") {
        if (!same(existing.preCas, preCas) || !same(existing.plannedEffect, plannedEffect)) throw new Error(`phase '${phase}' is already bound to different CAS values`);
        const recovery = await this.observeUntilSettled({ state, phase, readCurrent, isConverging, pollIntervalMs, wait });
        state = recovery.state;
        if (recovery.decision === "planned_effect_current") {
          state = await this.completePhaseUnlocked(state, phase, { recovered: true, invocation: clone(existing.invocationResult), observed: recovery.observed });
          return { replay: false, invoked: false, recovered: true, state, result: clone(state.phases[phase].result) };
        }
        if (["external_interference", "phase_deadline_exceeded"].includes(recovery.decision)) {
          if (recovery.decision === "external_interference") state = await this.interventionUnlocked(state, phase, recovery.observed);
          return { replay: false, invoked: false, interventionRequired: true, state, result: clone(state.phases[phase].result) };
        }
      } else {
        state = await this.beginPhaseUnlocked(state, phase, preCas, plannedEffect);
      }
      const pending = state.phases[phase];
      if (this.deadlineExpired(pending)) {
        state = await this.interventionUnlocked(state, phase, pending.lastObserved, "phase_deadline_exceeded");
        return { replay: false, invoked: false, interventionRequired: true, state, result: clone(state.phases[phase].result) };
      }
      const result = await invoke({
        transitionId,
        phase,
        deadlineAt: pending.deadlineAt,
        requestTokens: clone(state.requestTokens),
        preCas: clone(pending.preCas),
        plannedEffect: clone(pending.plannedEffect),
      });
      pending.invocationResult = clone(result);
      state = await this.persist(state, "phase_invoked", { phase, result });
      const outcome = await this.observeUntilSettled({ state, phase, readCurrent, isConverging, pollIntervalMs, wait });
      state = outcome.state;
      if (outcome.decision === "planned_effect_current") {
        state = await this.completePhaseUnlocked(state, phase, { invocation: clone(result), observed: outcome.observed });
        return { replay: false, invoked: true, state, result: clone(state.phases[phase].result) };
      }
      if (["external_interference", "phase_deadline_exceeded"].includes(outcome.decision)) {
        if (outcome.decision === "external_interference") state = await this.interventionUnlocked(state, phase, outcome.observed);
        return { replay: false, invoked: true, interventionRequired: true, state, result: clone(state.phases[phase].result) };
      }
      throw new Error(`phase '${phase}' external call did not reach the planned effect; durable pending state retained`);
    });
  }

  async resolvePendingRollbackTargets({ state, readCurrent, isConverging, pollIntervalMs, wait }) {
    for (const phase of state.rollback.phases) {
      let record = state.phases[phase];
      if (record?.status !== "pending" || record.rollback?.status !== "rollback_pending") continue;
      if (typeof readCurrent !== "function") throw new Error(`rollback phase '${phase}' needs readCurrent to resolve its pending forward effect`);
      while (true) {
        record = state.phases[phase];
        const observed = await readCurrent({
          phase,
          preCas: clone(record.preCas),
          plannedEffect: clone(record.plannedEffect),
          deadlineAt: record.deadlineAt,
        });
        const decision = await this.decide(
          record,
          observed,
          typeof isConverging === "function"
            ? (value, context) => isConverging(value, { ...context, rollback: true })
            : null,
          phase,
        );
        if (this.deadlineExpired(record) && decision === "convergence_pending") {
          record.rollback = { status: "intervention_required", error: "phase_deadline_exceeded", observed: clone(observed), completedAt: this.timestamp() };
          state.status = "intervention_required";
          state.currentPhase = phase;
          state.rollback.status = "intervention_required";
          state = await this.persist(state, "rollback_pending_phase_intervention_required", { phase, reason: "phase_deadline_exceeded", observed });
          return state;
        }
        if (decision === "planned_effect_current") {
          record.status = "complete";
          record.result = { recoveredForRollback: true, invocation: clone(record.invocationResult), observed: clone(observed) };
          record.completedAt = this.timestamp();
          state = await this.persist(state, "rollback_pending_phase_effect_recovered", { phase, observed });
          break;
        }
        if (decision === "pre_cas_still_current") {
          record.rollback = {
            status: "rollback_complete",
            result: { notApplied: true, observed: clone(observed) },
            completedAt: this.timestamp(),
          };
          state = await this.persist(state, "rollback_pending_phase_not_applied", { phase, observed });
          break;
        }
        if (decision === "external_interference") {
          record.rollback = { status: "intervention_required", error: "external_interference", observed: clone(observed), completedAt: this.timestamp() };
          state.status = "intervention_required";
          state.currentPhase = phase;
          state.rollback.status = "intervention_required";
          state = await this.persist(state, "rollback_pending_phase_intervention_required", { phase, reason: "external_interference", observed });
          return state;
        }
        if (!same(record.lastObserved, observed)) {
          record.lastObserved = clone(observed);
          record.lastObservedAt = this.timestamp();
          state = await this.persist(state, "rollback_pending_phase_convergence", { phase, observed });
        }
        await wait(pollIntervalMs);
      }
    }
    state.currentPhase = state.rollback.phases.find(name => state.phases[name]?.rollback?.status !== "rollback_complete") ?? null;
    return state;
  }

  async beginRollback({ transitionId, reason, readCurrent = null, isConverging = null, pollIntervalMs = 1000, wait = sleepFor }) {
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0) throw new Error("pollIntervalMs must be a non-negative integer");
    return this.withExclusiveLock(transitionId, async () => {
      let state = await this.load();
      if (!state || state.transitionId !== transitionId) throw new Error("transition state not found");
      if (state.status === "rollback_complete") return clone(state);
      if (state.rollback?.status === "intervention_required") throw new Error("rollback requires intervention and cannot be restarted or overwritten");
      if (state.status === "intervention_required" && !state.rollback) {
        throw new Error("forward phase requires intervention before rollback targets can be determined");
      }
      if (state.rollback?.status !== "rollback_pending") {
        const phases = this.contract.durableExecution.phaseOrder
          .filter(phase => ["complete", "pending"].includes(state.phases[phase]?.status))
          .reverse();
        if (phases.some(phase => state.phases[phase]?.status === "pending") && typeof readCurrent !== "function") {
          throw new Error("readCurrent is required before rollback can include a pending forward phase");
        }
        state.status = "rollback_pending";
        state.currentPhase = phases[0] ?? null;
        state.rollback = { status: "rollback_pending", reason: String(reason), startedAt: this.timestamp(), completedAt: null, phases };
        for (const phase of phases) state.phases[phase].rollback = { status: "rollback_pending", result: null, completedAt: null };
        state = await this.persist(state, "rollback_started", { reason: String(reason), phases });
      }
      state = await this.resolvePendingRollbackTargets({ state, readCurrent, isConverging, pollIntervalMs, wait });
      return clone(state);
    });
  }

  async completeRollbackPhase({ transitionId, phase, result }) {
    return this.withExclusiveLock(transitionId, async () => {
      let state = await this.load();
      if (!state || state.transitionId !== transitionId) throw new Error("transition state not found");
      if (state.rollback?.status !== "rollback_pending") throw new Error("transition rollback is not pending");
      const expected = state.rollback.phases.find(name => state.phases[name]?.rollback?.status !== "rollback_complete");
      if (expected !== phase) throw new Error(`rollback phase '${phase}' cannot complete before '${expected}'`);
      if (state.phases[phase].status === "pending") throw new Error(`rollback phase '${phase}' has an unresolved forward effect`);
      const priorRollback = state.phases[phase].rollback;
      state.phases[phase].rollback = {
        status: "rollback_complete", result: clone(result), completedAt: this.timestamp(),
        ...(priorRollback?.failureHistory?.length ? { failureHistory: clone(priorRollback.failureHistory) } : {}),
      };
      state.currentPhase = state.rollback.phases.find(name => state.phases[name]?.rollback?.status !== "rollback_complete") ?? null;
      return this.persist(state, "rollback_phase_complete", { phase, result });
    });
  }

  async completeRollback({ transitionId, result = null }) {
    return this.withExclusiveLock(transitionId, async () => {
      let state = await this.load();
      if (!state || state.transitionId !== transitionId) throw new Error("transition state not found");
      if (state.status === "rollback_complete") return clone(state);
      if (state.rollback?.status !== "rollback_pending") throw new Error("transition rollback is not pending");
      const incomplete = state.rollback.phases.filter(phase => state.phases[phase]?.rollback?.status !== "rollback_complete");
      if (incomplete.length) throw new Error(`rollback phases remain incomplete: ${incomplete.join(", ")}`);
      state.rollback.status = "rollback_complete";
      state.rollback.result = clone(result);
      state.rollback.completedAt = this.timestamp();
      state.status = "rollback_complete";
      state.currentPhase = null;
      return this.persist(state, "rollback_complete", { result });
    });
  }

  async recordRollbackFailure({ transitionId, phase, error }) {
    return this.withExclusiveLock(transitionId, async () => {
      let state = await this.load();
      if (!state || state.transitionId !== transitionId) throw new Error("transition state not found");
      if (state.rollback?.status !== "rollback_pending" || !state.rollback.phases.includes(phase)) {
        throw new Error(`rollback phase '${phase}' is not pending`);
      }
      const expected = state.rollback.phases.find(name => state.phases[name]?.rollback?.status !== "rollback_complete");
      if (expected !== phase) throw new Error(`rollback phase '${phase}' cannot fail before '${expected}'`);
      const record = state.phases[phase];
      if (!record) throw new Error(`phase '${phase}' has no durable record`);
      const failedAt = this.timestamp();
      const failureHistory = [...(record.rollback?.failureHistory ?? []), { error: String(error), failedAt }];
      record.rollback = { status: "intervention_required", error: String(error), completedAt: failedAt, failureHistory };
      state.status = "intervention_required";
      state.currentPhase = phase;
      if (state.rollback) state.rollback.status = "intervention_required";
      return this.persist(state, "rollback_failed", { phase, error: String(error) });
    });
  }

  async recoverInterventionForRollback({ transitionId, phase, operatorId, evidenceSha256, readCurrent }) {
    if (typeof operatorId !== "string" || operatorId.trim().length < 3 || operatorId.length > 256 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(operatorId)) throw new Error("operatorId is required for manual intervention recovery and cannot contain control, separator, or surrogate characters");
    if (typeof evidenceSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(evidenceSha256) || /^0{64}$/u.test(evidenceSha256)) throw new Error("a nonzero SHA-256 evidence digest is required for manual intervention recovery");
    if (typeof readCurrent !== "function") throw new Error("readCurrent is required for manual intervention recovery");
    return this.withExclusiveLock(transitionId, async () => {
      let state = await this.load();
      if (!state || state.transitionId !== transitionId) throw new Error("transition state not found");
      if (state.status !== "intervention_required" || state.currentPhase !== phase) throw new Error(`phase '${phase}' is not the current intervention`);
      const record = state.phases[phase];
      if (!record || !record.preCas || !record.plannedEffect) throw new Error(`phase '${phase}' lacks durable CAS evidence`);
      if (state.rollback && (state.rollback.status !== "intervention_required" || !state.rollback.phases.includes(phase))) {
        throw new Error(`phase '${phase}' is not a frozen rollback target`);
      }
      const observed = await readCurrent({ phase, preCas: clone(record.preCas), plannedEffect: clone(record.plannedEffect) });
      const decision = recoveryDecision(record.preCas, record.plannedEffect, observed);
      if (!["planned_effect_current", "pre_cas_still_current"].includes(decision)) {
        throw new Error(`phase '${phase}' still requires external remediation before rollback can resume`);
      }
      const priorForwardStatus = record.status;
      const priorForwardResult = clone(record.result);
      const priorRollback = clone(record.rollback);
      const recovery = {
        operatorId: operatorId.trim(), evidenceSha256, observedSha256: sha256(Buffer.from(stableJson(observed), "utf8")),
        decision, recoveredAt: this.timestamp(), priorForwardStatus, priorForwardResult, priorRollback,
      };
      record.manualRecovery = recovery;
      if (decision === "planned_effect_current") {
        record.status = "complete";
        if (priorForwardStatus !== "complete") record.result = { recoveredForRollback: true, priorIntervention: priorForwardResult, observed: clone(observed) };
      } else if (priorForwardStatus === "intervention_required") {
        record.status = "pending";
      }
      if (!state.rollback) {
        const phases = this.contract.durableExecution.phaseOrder.filter(name => ["complete", "pending"].includes(state.phases[name]?.status)).reverse();
        state.rollback = { status: "rollback_pending", reason: "manual intervention recovery", startedAt: this.timestamp(), completedAt: null, phases };
        for (const name of phases) state.phases[name].rollback = { status: "rollback_pending", result: null, completedAt: null };
      } else {
        state.rollback.status = "rollback_pending";
      }
      record.rollback = decision === "pre_cas_still_current"
        ? { status: "rollback_complete", result: { preCasCurrent: true, externallyRestored: priorForwardStatus === "complete", manuallyVerified: true, observed: clone(observed) }, completedAt: this.timestamp(), priorFailure: priorRollback, failureHistory: clone(priorRollback?.failureHistory ?? []) }
        : { status: "rollback_pending", result: null, completedAt: null, priorFailure: priorRollback, failureHistory: clone(priorRollback?.failureHistory ?? []) };
      state.status = "rollback_pending";
      state.currentPhase = state.rollback.phases.find(name => state.phases[name]?.rollback?.status !== "rollback_complete") ?? null;
      return this.persist(state, "manual_intervention_recovered_for_rollback", { phase, operatorId: recovery.operatorId, evidenceSha256, observedSha256: recovery.observedSha256, decision });
    });
  }
}
