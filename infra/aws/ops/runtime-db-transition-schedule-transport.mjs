import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stableJson } from "./runtime-db-transition-state.mjs";
import { projectScheduleObservation } from "./runtime-db-transition-schedule.mjs";
import { assertScheduleSwitchEffect, validatePhaseProjection } from "./runtime-db-transition-adapter.mjs";

const PROFILE = /^[A-Za-z0-9_.-]{1,128}$/u;
const MIN_FORWARD_WINDOW_MS = 35_000;

export function scheduleAwsCliEnvironment(base = process.env) {
  const env = { ...base, AWS_CLI_FILE_ENCODING: "UTF-8", AWS_MAX_ATTEMPTS: "1", PYTHONUTF8: "1" };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith("AWS_ENDPOINT_URL")) delete env[key];
  return env;
}

function defaultCommand(arguments_, { timeoutMs = 30000 } = {}) {
  return spawnSync("aws", arguments_, {
    encoding: "utf8", windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024,
    env: scheduleAwsCliEnvironment(),
  });
}

function asciiJson(value) {
  return stableJson(value).replace(/[\u007f-\uffff]/g, character =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function same(left, right) { return stableJson(left) === stableJson(right); }
function withoutRevision(row) { return { ...row, taskDefinitionArn: "[revision]", enableExecuteCommand: row.enableExecuteCommand ?? false }; }

function approvedPrincipal(contract, identity) {
  if (identity?.Account !== contract.accountId || typeof identity.Arn !== "string") return false;
  if (contract.collector.allowedIamRoleArns.includes(identity.Arn)) return true;
  const prefix = `arn:${contract.partition}:sts::${contract.accountId}:assumed-role/`;
  if (!identity.Arn.startsWith(prefix)) return false;
  const remainder = identity.Arn.slice(prefix.length);
  const slash = remainder.indexOf("/");
  return slash > 0 && slash < remainder.length - 1 &&
    contract.collector.allowedStsRoleNames.includes(remainder.slice(0, slash)) &&
    !remainder.slice(slash + 1).includes("/");
}

// This is a transport primitive, not an operator-facing transition command.
// The caller supplies the durable phase authorization for every mutation.
export function createScheduleAwsTransport({ contract, plan, profile = "mcm-kesi-staging",
  authorizeMutation, runCommand = defaultCommand, temporaryDirectory = tmpdir(),
  removeTemporary = unlink, now = () => new Date() }) {
  if (!contract || !plan || !Array.isArray(plan.current?.schedules) ||
      !Array.isArray(contract.scheduleRules) || !Array.isArray(contract.collector?.allowedIamRoleArns) ||
      !Array.isArray(contract.collector?.allowedStsRoleNames) || !PROFILE.test(profile) ||
      typeof authorizeMutation !== "function" || typeof runCommand !== "function" ||
      typeof removeTemporary !== "function" || typeof now !== "function" ||
      !path.isAbsolute(temporaryDirectory)) {
    throw new Error("schedule AWS transport requires an approved contract, plan, profile, and mutation authorizer");
  }
  const scheduleNames = new Set(contract.scheduleRules);
  if (scheduleNames.size !== 2 || plan.current.schedules.length !== 2 ||
      plan.current.schedules.some(row => !scheduleNames.has(row.name)) ||
      new Set(plan.current.schedules.map(row => row.name)).size !== 2) {
    throw new Error("schedule AWS transport plan must contain the two approved rules");
  }
  const approved = validatePhaseProjection(contract, "schedules_switched", { rules: plan.current.schedules });
  const approvedRows = new Map(approved.rules.map(row => [row.name, row]));
  const revisionPrefix = `arn:${contract.partition}:ecs:${contract.region}:${contract.accountId}:task-definition/${contract.components.next.family}:`;

  async function command(service, operation, args, timeoutMs = 30000) {
    const arguments_ = [service, operation, ...args, "--profile", profile, "--region", contract.region,
      "--no-cli-pager", "--no-paginate", "--output", "json", "--cli-connect-timeout", "3", "--cli-read-timeout", "10"];
    let result;
    try { result = await runCommand(arguments_, { timeoutMs }); }
    catch { throw new Error(`AWS ${service}:${operation} did not complete`); }
    if (result?.error || result?.status !== 0 || typeof result.stdout !== "string" || !result.stdout.trim()) {
      throw new Error(`AWS ${service}:${operation} did not complete`);
    }
    try { return JSON.parse(result.stdout); }
    catch { throw new Error(`AWS ${service}:${operation} did not return JSON`); }
  }

  async function operatorIdentity() {
    const identity = await command("sts", "get-caller-identity", []);
    if (!approvedPrincipal(contract, identity)) throw new Error("AWS caller is not the approved transition operator");
    return identity;
  }

  function approvedRead(service, operation, args) {
    if (!Array.isArray(args) || args.some(value => typeof value !== "string")) return false;
    if (service === "ecs" && operation === "describe-services") {
      return args.length === 4 && args[0] === "--cluster" && args[1] === contract.cluster &&
        args[2] === "--services" && args[3] === contract.nextService;
    }
    if (service === "events" && operation === "describe-rule") {
      return args.length === 2 && args[0] === "--name" && scheduleNames.has(args[1]);
    }
    if (service === "events" && operation === "list-targets-by-rule") {
      return args.length === 2 && args[0] === "--rule" && scheduleNames.has(args[1]);
    }
    return false;
  }

  function assertTargetAndProof(name, target, proof) {
    if (!scheduleNames.has(name) || !target || typeof target !== "object" || Array.isArray(target) ||
        proof?.phase !== "schedules_switched" || proof.checkOnly !== false ||
        proof.targetName !== name || proof.taskDefinitionArn !== target.EcsParameters?.TaskDefinitionArn ||
        (proof.rollback !== undefined && typeof proof.rollback !== "boolean") ||
        (proof.compensation !== undefined && typeof proof.compensation !== "boolean") ||
        (proof.rollback === true && proof.compensation === true)) {
      throw new Error("schedule target or durable write proof is invalid");
    }
    const before = validatePhaseProjection(contract, "schedules_switched", proof.preCas);
    const after = validatePhaseProjection(contract, "schedules_switched", proof.plannedEffect);
    if (!same(before, approved)) throw new Error("schedule durable pre-CAS differs from the plan");
    assertScheduleSwitchEffect(contract, before, after, after.rules[0]?.taskDefinitionArn);
    const oldRevision = before.rules[0]?.taskDefinitionArn;
    const newRevision = after.rules[0]?.taskDefinitionArn;
    if (!oldRevision?.startsWith(revisionPrefix) || !newRevision?.startsWith(revisionPrefix) ||
        !/^[1-9][0-9]*$/u.test(oldRevision.slice(revisionPrefix.length)) ||
        !/^[1-9][0-9]*$/u.test(newRevision.slice(revisionPrefix.length)) ||
        BigInt(newRevision.slice(revisionPrefix.length)) <= BigInt(oldRevision.slice(revisionPrefix.length))) {
      throw new Error("schedule effect must advance the approved Next revision");
    }
    const expected = (proof.rollback === true || proof.compensation === true ? before : after)
      .rules.find(row => row.name === name)?.taskDefinitionArn;
    if (target.EcsParameters?.TaskDefinitionArn !== expected || typeof expected !== "string" ||
        !expected.startsWith(revisionPrefix) ||
        !/^[1-9][0-9]*$/u.test(expected.slice(revisionPrefix.length))) {
      throw new Error("schedule target revision differs from the durable effect");
    }
    const baseline = approvedRows.get(name);
    const rule = { Name: name, State: baseline.state, EventBusName: baseline.eventBusName,
      ScheduleExpression: baseline.scheduleExpression };
    const observed = projectScheduleObservation(contract, rule, { Targets: [target] });
    if (!same(withoutRevision(observed), withoutRevision(baseline))) {
      throw new Error("schedule target content differs from the approved plan");
    }
    const deadline = Date.parse(proof.deadlineAt);
    if (!Number.isFinite(deadline)) throw new Error("schedule durable deadline is missing");
    return deadline;
  }

  return Object.freeze({
    async readAws(service, operation, args) {
      if (!approvedRead(service, operation, args)) throw new Error("AWS read is outside the schedule transition allowlist");
      await operatorIdentity();
      return command(service, operation, args);
    },
    async putTarget(name, target, proof) {
      let submitted = false;
      try {
        const snapshot = structuredClone(target);
        const durableProof = structuredClone(proof);
        const deadline = assertTargetAndProof(name, snapshot, durableProof);
        const identity = await operatorIdentity();
        if (await authorizeMutation({ identity, name, target: structuredClone(snapshot), proof: structuredClone(durableProof) }) !== true) {
          throw new Error("schedule mutation was not authorized by the durable transition");
        }
        const temporary = path.join(temporaryDirectory, `mcm-runtime-schedule-${randomUUID()}.json`);
        const handle = await open(temporary, "wx", 0o600);
        let cleanupFailed = false;
        let result;
        try {
          try { await handle.writeFile(`${asciiJson([snapshot])}\n`, "ascii"); await handle.sync(); }
          finally { await handle.close(); }
          const remaining = deadline - now().getTime();
          if (!Number.isFinite(remaining)) throw new Error("schedule submission clock is invalid");
          if (durableProof.rollback !== true && durableProof.compensation !== true && remaining <= MIN_FORWARD_WINDOW_MS) {
            throw new Error("schedule forward deadline has insufficient CLI execution time");
          }
          submitted = true;
          result = await command("events", "put-targets", ["--rule", name, "--targets", `file://${temporary}`],
            durableProof.rollback === true || durableProof.compensation === true ? 30000 : Math.min(30000, Math.max(1, remaining)));
        } finally {
          try { await removeTemporary(temporary); }
          catch { cleanupFailed = true; }
        }
        return cleanupFailed ? { ...result, scheduleTemporaryCleanupFailed: true } : result;
      } catch (error) {
        if (!submitted) {
          const stopped = new Error("schedule mutation stopped before AWS submission");
          stopped.schedulePreWriteFailure = true;
          throw stopped;
        }
        throw error;
      }
    },
  });
}
