import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { stableJson } from "./runtime-db-transition-state.mjs";
import { SCHEDULE_FIELDS, projectScheduleObservation, validateScheduleFields } from "./runtime-db-transition-schedule.mjs";

const HASH = /^[0-9a-f]{64}$/u;
const UNSAFE_OPERATOR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  if (stableJson(actual) !== stableJson([...keys].sort())) throw new Error(`${label} property set mismatch`);
}

function jsonValue(value, label) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) jsonValue(item, label);
    return;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) {
      if (/password|secretstring|secretbinary|credential|privatekey/iu.test(key)) throw new Error(`${label} includes secret material`);
      jsonValue(item, label);
    }
    return;
  }
  throw new Error(`${label} contains a non-JSON value`);
}

function sortIdentityRows(rows, keys, identity, label) {
  if (!Array.isArray(rows)) throw new Error(`${label} must be an array`);
  const seen = new Set();
  const result = rows.map(row => {
    exactKeys(row, keys, label);
    for (const key of identity) if (typeof row[key] !== "string" || !row[key]) throw new Error(`${label}.${key} is missing`);
    const id = stableJson(identity.map(key => row[key]));
    if (seen.has(id)) throw new Error(`${label} contains a duplicate identity`);
    seen.add(id);
    return structuredClone(row);
  });
  return result.sort((left, right) => {
    const a = stableJson(left);
    const b = stableJson(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export function validatePhaseProjection(contract, phase, value) {
  const leaves = contract?.durableExecution?.phaseStableProjection?.[phase];
  if (!Array.isArray(leaves) || !leaves.length) throw new Error(`unsupported phase '${phase}'`);
  const top = [...new Set(leaves.map(name => name.split(".")[0]))];
  exactKeys(value, top, `${phase} projection`);
  jsonValue(value, `${phase} projection`);
  const result = structuredClone(value);
  if (phase === "schedules_switched") {
    result.rules = sortIdentityRows(result.rules, SCHEDULE_FIELDS, ["eventBusName", "name", "targetId"], "rules");
    if (result.rules.length !== contract.scheduleRules.length || new Set(result.rules.map(row => row.name)).size !== result.rules.length) throw new Error("schedule rule cardinality mismatch");
    for (const row of result.rules) {
      if (!contract.scheduleRules.includes(row.name) || !["ENABLED", "DISABLED"].includes(row.state) || typeof row.eventBusName !== "string" || !row.eventBusName || typeof row.targetId !== "string" || !row.targetId) throw new Error("schedule rule identity or state mismatch");
      taskArn(contract, row.taskDefinitionArn, contract.components.next.family);
      validateScheduleFields(row);
      if (row.roleArn !== `arn:${contract.partition}:iam::${contract.accountId}:role/${row.name}-events`) throw new Error("schedule execution role is not approved");
      if (row.scheduleExpression !== contract.scheduleApprovedDefaults.expressions[row.name] || row.taskCount !== contract.scheduleApprovedDefaults.taskCount || row.launchType !== contract.scheduleApprovedDefaults.launchType) throw new Error("schedule row differs from approved defaults");
      if (row.inputSha256 !== contract.scheduleApprovedInputSha256[row.name]) throw new Error("schedule Input digest differs from approved Terraform declaration");
    }
  }
  if (phase === "legacy_passrole_removed") {
    result.policies = sortIdentityRows(result.policies, ["roleName", "policyName", "canonicalSha256", "legacyPassRoleAllowed", "candidatePassRoleAllowed"], ["roleName", "policyName"], "policies");
    const approved = new Set(contract.iamTransitionPolicies.map(item => stableJson([item.roleName, item.policyName])));
    if (result.policies.length !== approved.size || result.policies.some(item => !approved.has(stableJson([item.roleName, item.policyName])))) throw new Error("policy set mismatch");
    for (const row of result.policies) {
      if (!HASH.test(row.canonicalSha256) || typeof row.legacyPassRoleAllowed !== "boolean" || typeof row.candidatePassRoleAllowed !== "boolean") throw new Error("policy projection has invalid proof fields");
    }
  }
  return result;
}

function taskArn(contract, arn, family) {
  const prefix = `arn:${contract.partition}:ecs:${contract.region}:${contract.accountId}:task-definition/${family}:`;
  if (typeof arn !== "string" || !arn.startsWith(prefix) || !/^[1-9][0-9]*$/u.test(arn.slice(prefix.length))) throw new Error("ECS task definition ARN is not an approved numeric revision");
  return arn;
}

export function projectScheduleTargets(contract, plan, responses) {
  if (!Array.isArray(responses) || responses.length !== contract.scheduleRules.length) throw new Error("schedule response count mismatch");
  const approved = new Map((plan?.current?.schedules ?? []).map(item => [item.name, item]));
  if (approved.size !== contract.scheduleRules.length) throw new Error("approved schedule target set mismatch");
  const observed = new Set();
  const rules = responses.map(({ rule, targets }) => {
    const name = rule?.Name;
    if (!contract.scheduleRules.includes(name) || observed.has(name)) throw new Error("unexpected or duplicate schedule rule");
    observed.add(name);
    const expected = approved.get(name);
    if (!expected) throw new Error("schedule is absent from the approved plan");
    const eventBusName = rule.EventBusName || contract.eventBridge.defaultEventBusName;
    if (eventBusName !== expected.eventBusName) throw new Error("schedule event bus mismatch");
    const row = projectScheduleObservation(contract, rule, targets);
    if (row.targetId !== expected.targetId) throw new Error("schedule target is not the approved ECS target");
    taskArn(contract, row.taskDefinitionArn, contract.components.next.family);
    return row;
  });
  if (observed.size !== contract.scheduleRules.length) throw new Error("schedule response set mismatch");
  return validatePhaseProjection(contract, "schedules_switched", { rules });
}

export function assertScheduleSwitchEffect(contract, preCas, plannedEffect, nextTaskDefinitionArn) {
  const before = validatePhaseProjection(contract, "schedules_switched", preCas);
  const after = validatePhaseProjection(contract, "schedules_switched", plannedEffect);
  const revision = taskArn(contract, nextTaskDefinitionArn, contract.components.next.family);
  const expected = structuredClone(before);
  for (const row of expected.rules) row.taskDefinitionArn = revision;
  if (stableJson(after) !== stableJson(expected)) throw new Error("schedule planned effect may change only taskDefinitionArn");
  return after;
}

export function buildScheduleSwitchEffect(contract, plan, preCas, nextTaskDefinitionArn) {
  if (plan?.version !== contract.planVersion) throw new Error("schedule plan version mismatch");
  const before = validatePhaseProjection(contract, "schedules_switched", preCas);
  const baseline = validatePhaseProjection(contract, "schedules_switched", { rules: plan.current?.schedules });
  if (stableJson(before) !== stableJson(baseline)) throw new Error("schedule pre-CAS differs from approved plan");
  const plannedEffect = structuredClone(before);
  for (const row of plannedEffect.rules) row.taskDefinitionArn = nextTaskDefinitionArn;
  return assertScheduleSwitchEffect(contract, before, plannedEffect, nextTaskDefinitionArn);
}

export function projectNextService(contract, response) {
  if (!Array.isArray(response?.failures ?? []) || (response.failures ?? []).length !== 0) throw new Error("Next service lookup reported failures");
  if (!Array.isArray(response?.services) || response.services.length !== 1) throw new Error("Next service lookup must return one service");
  const service = response.services[0];
  if (service.serviceName !== contract.nextService) throw new Error("Next service identity mismatch");
  if (service.status !== "ACTIVE") throw new Error("Next service is not ACTIVE");
  const primary = (service.deployments ?? []).filter(item => item.status === "PRIMARY");
  if (primary.length !== 1) throw new Error("Next service must have exactly one PRIMARY deployment");
  const numbers = [service.desiredCount, service.runningCount, service.pendingCount];
  if (numbers.some(value => !Number.isInteger(value) || value < 0)) throw new Error("Next service counts are invalid");
  const result = {
    serviceName: service.serviceName,
    taskDefinitionArn: taskArn(contract, service.taskDefinition, contract.components.next.family),
    desiredCount: service.desiredCount, runningCount: service.runningCount, pendingCount: service.pendingCount,
    primaryTaskDefinitionArn: taskArn(contract, primary[0].taskDefinition, contract.components.next.family),
    primaryStatus: primary[0].status, primaryRolloutState: primary[0].rolloutState,
  };
  return validatePhaseProjection(contract, "next_service_stable", result);
}

export function projectSecretVersions(contract, responses) {
  jsonValue(responses, "secret metadata response");
  const result = {};
  for (const [label, prefix] of [["next", "app"], ["worker", "worker"]]) {
    const input = responses?.[label];
    const arn = input?.metadata?.ARN;
    if (input?.metadata?.DeletedDate != null) throw new Error(`${label} secret is scheduled for deletion`);
    const name = contract.components[label].secret;
    const base = `arn:${contract.partition}:secretsmanager:${contract.region}:${contract.accountId}:secret:${name}-`;
    if (typeof arn !== "string" || !arn.startsWith(base) || !/^[A-Za-z0-9]{6}$/u.test(arn.slice(base.length))) throw new Error(`${label} secret ARN mismatch`);
    const versions = input?.versions?.Versions;
    if (input?.versions?.NextToken) throw new Error(`${label} secret version listing is incomplete`);
    if (!Array.isArray(versions)) throw new Error(`${label} secret versions missing`);
    const current = versions.filter(item => item.VersionStages?.includes("AWSCURRENT"));
    const pending = versions.filter(item => item.VersionStages?.includes("AWSPENDING"));
    if (current.length !== 1 || typeof current[0].VersionId !== "string" || !current[0].VersionId) throw new Error(`${label} must have exactly one AWSCURRENT version`);
    result[`${prefix}SecretArn`] = arn;
    result[`${prefix}CurrentVersionId`] = current[0].VersionId;
    result[`${prefix}PendingVersionCount`] = pending.length;
  }
  return validatePhaseProjection(contract, "secrets_ready", result);
}

export function validatedReadCurrent(contract, phase, readRaw, project) {
  if (typeof readRaw !== "function" || typeof project !== "function") throw new Error("read and projection functions are required");
  return async (...args) => validatePhaseProjection(contract, phase, await project(await readRaw(...args)));
}

export function createReadOnlyAwsAdapter({ contract, plan, runAws }) {
  if (typeof runAws !== "function") throw new Error("a read-only AWS transport is required");
  async function read(service, operation, arguments_) {
    const approved = new Set([
      "secretsmanager:describe-secret", "secretsmanager:list-secret-version-ids",
      "ecs:describe-services", "events:describe-rule", "events:list-targets-by-rule",
    ]);
    if (!approved.has(`${service}:${operation}`)) throw new Error("AWS operation is outside the read-only adapter allowlist");
    return runAws(service, operation, arguments_);
  }
  return Object.freeze({
    async readCurrent(phase) {
      if (phase === "secrets_ready") {
        const responses = {};
        for (const label of ["next", "worker"]) {
          const secretId = contract.components[label].secret;
          responses[label] = {
            metadata: await read("secretsmanager", "describe-secret", ["--secret-id", secretId]),
            versions: await read("secretsmanager", "list-secret-version-ids", ["--secret-id", secretId, "--include-deprecated"]),
          };
        }
        return projectSecretVersions(contract, responses);
      }
      if (phase === "next_service_stable") {
        const response = await read("ecs", "describe-services", ["--cluster", contract.cluster, "--services", contract.nextService]);
        return projectNextService(contract, response);
      }
      if (phase === "schedules_switched") {
        const responses = [];
        for (const name of contract.scheduleRules) {
          responses.push({
            rule: await read("events", "describe-rule", ["--name", name]),
            targets: await read("events", "list-targets-by-rule", ["--rule", name]),
          });
        }
        return projectScheduleTargets(contract, plan, responses);
      }
      throw new Error(`AWS phase '${phase}' is not implemented by this read-only adapter slice`);
    },
  });
}

export async function recoverWithVerifiedEvidence({ store, transitionId, phase, operatorId, evidencePath, evidenceSha256, authorizeOperator, readCurrent }) {
  if (typeof operatorId !== "string" || operatorId.trim().length < 3 || operatorId.length > 256 || UNSAFE_OPERATOR.test(operatorId)) throw new Error("operatorId contains unsafe characters");
  if (!HASH.test(evidenceSha256 ?? "") || /^0{64}$/u.test(evidenceSha256)) throw new Error("evidenceSha256 is invalid");
  if (typeof authorizeOperator !== "function" || await authorizeOperator({ operatorId, transitionId, phase }) !== true) throw new Error("operator is not authorized for transition recovery");
  if (typeof evidencePath !== "string" || !evidencePath) throw new Error("evidence file path is required");
  const handle = await open(evidencePath, "r");
  let actual;
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size <= 0 || details.size > 64 * 1024 * 1024) throw new Error("evidence must be a nonempty file of at most 64 MiB");
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of handle.createReadStream()) {
      bytes += chunk.length;
      if (bytes > 64 * 1024 * 1024) throw new Error("evidence exceeds 64 MiB");
      hash.update(chunk);
    }
    if (bytes !== details.size) throw new Error("evidence changed while being read");
    actual = hash.digest("hex");
  } finally { await handle.close(); }
  if (actual !== evidenceSha256) throw new Error("evidence file SHA-256 mismatch");
  if (typeof readCurrent !== "function") throw new Error("readCurrent is required");
  return store.recoverInterventionForRollback({ transitionId, phase, operatorId, evidenceSha256, readCurrent });
}
