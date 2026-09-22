import { createHash } from "node:crypto";
import { stableJson } from "./runtime-db-transition-state.mjs";

const HASH = /^[0-9a-f]{64}$/u;

function digest(value) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function stringSet(value, label) {
  if (!Array.isArray(value) || !value.length || value.some(item => typeof item !== "string" || !item)) throw new Error(`${label} must be a nonempty string set`);
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicates`);
  return [...value].sort();
}

function assertUnambiguousInput(text) {
  let index = 0;
  const space = () => { while (/[\t\n\r ]/u.test(text[index] ?? "")) index++; };
  const quoted = () => {
    const start = index;
    if (text[index++] !== '"') throw new Error("schedule Input is not JSON");
    while (index < text.length) {
      const character = text[index++];
      if (character === '"') return JSON.parse(text.slice(start, index));
      if (character === "\\") {
        const escaped = text[index++];
        if (escaped === "u") {
          if (!/^[0-9A-Fa-f]{4}$/u.test(text.slice(index, index + 4))) throw new Error("schedule Input is not JSON");
          index += 4;
        } else if (!'"\\/bfnrt'.includes(escaped)) throw new Error("schedule Input is not JSON");
      } else if (character.charCodeAt(0) < 0x20) throw new Error("schedule Input is not JSON");
    }
    throw new Error("schedule Input is not JSON");
  };
  const value = () => {
    space();
    if (text[index] === "{") return object();
    if (text[index] === "[") return array();
    if (text[index] === '"') { quoted(); return; }
    const literal = text.slice(index).match(/^(?:true|false|null)/u)?.[0];
    if (!literal) throw new Error("schedule Input contains a number or invalid JSON");
    index += literal.length;
  };
  const object = () => {
    index++; space();
    const keys = new Set();
    if (text[index] === "}") { index++; return; }
    while (index < text.length) {
      space();
      const key = quoted();
      if (keys.has(key)) throw new Error("schedule Input contains duplicate JSON keys");
      keys.add(key);
      space();
      if (text[index++] !== ":") throw new Error("schedule Input is not JSON");
      value(); space();
      if (text[index] === "}") { index++; return; }
      if (text[index++] !== ",") throw new Error("schedule Input is not JSON");
    }
    throw new Error("schedule Input is not JSON");
  };
  const array = () => {
    index++; space();
    if (text[index] === "]") { index++; return; }
    while (index < text.length) {
      value(); space();
      if (text[index] === "]") { index++; return; }
      if (text[index++] !== ",") throw new Error("schedule Input is not JSON");
    }
    throw new Error("schedule Input is not JSON");
  };
  value(); space();
  if (index !== text.length) throw new Error("schedule Input is not JSON");
}

export const SCHEDULE_FIELDS = [
  "name", "eventBusName", "state", "targetId", "taskDefinitionArn", "roleArn",
  "scheduleExpression", "taskCount", "launchType", "networkConfigurationSha256", "inputSha256",
  "platformVersion", "enableExecuteCommand", "propagateTags", "ruleRoleArn", "retryPolicySha256", "deadLetterConfigSha256",
];

export function projectScheduleObservation(contract, rule, targets) {
  const name = rule?.Name;
  if (!contract.scheduleRules.includes(name)) throw new Error("unexpected schedule rule");
  if (!["ENABLED", "DISABLED"].includes(rule.State)) throw new Error("schedule state is invalid");
  if (typeof rule.ScheduleExpression !== "string" || !rule.ScheduleExpression.trim()) throw new Error("schedule expression is missing");
  if (rule.ScheduleExpression !== contract.scheduleApprovedDefaults.expressions[name]) throw new Error("schedule expression differs from the approved rule");
  if (rule.RoleArn != null) throw new Error("rule-level execution role is unsupported");
  if (targets?.NextToken || !Array.isArray(targets?.Targets) || targets.Targets.length !== 1) throw new Error("schedule must have one complete target listing");
  const target = targets.Targets[0];
  const ecs = target?.EcsParameters;
  if (!ecs || target.Arn !== `arn:${contract.partition}:ecs:${contract.region}:${contract.accountId}:cluster/${contract.cluster}`) throw new Error("schedule target is not an approved ECS target");
  if (typeof target.Id !== "string" || !/^[A-Za-z0-9._-]{1,64}$/u.test(target.Id)) throw new Error("schedule target ID is invalid");
  const targetKeys = new Set(["Id", "Arn", "RoleArn", "Input", "InputPath", "InputTransformer", "EcsParameters", "RetryPolicy", "DeadLetterConfig"]);
  if (Object.keys(target).some(key => !targetKeys.has(key))) throw new Error("schedule target has unsupported properties");
  if (target.RetryPolicy != null || target.DeadLetterConfig != null) throw new Error("schedule retry or dead-letter settings are unsupported");
  const ecsKeys = new Set(["TaskDefinitionArn", "TaskCount", "LaunchType", "NetworkConfiguration", "PlatformVersion", "EnableExecuteCommand", "EnableECSManagedTags", "PropagateTags", "PlacementConstraints", "PlacementStrategy", "CapacityProviderStrategy"]);
  if (Object.keys(ecs).some(key => !ecsKeys.has(key))) throw new Error("schedule ECS target has unsupported properties");
  if (ecs.EnableECSManagedTags !== undefined && ecs.EnableECSManagedTags !== false) throw new Error("schedule ECS managed tags must remain disabled");
  for (const key of ["PlacementConstraints", "PlacementStrategy", "CapacityProviderStrategy"]) {
    if (ecs[key] !== undefined && (!Array.isArray(ecs[key]) || ecs[key].length !== 0)) throw new Error(`schedule ${key} must remain empty`);
  }
  const roleArn = `arn:${contract.partition}:iam::${contract.accountId}:role/${name}-events`;
  if (target.RoleArn !== roleArn) throw new Error("schedule execution role is not approved");
  if (!Number.isInteger(ecs.TaskCount) || ecs.TaskCount < 1 || ecs.TaskCount > 100) throw new Error("schedule task count is invalid");
  if (ecs.TaskCount !== contract.scheduleApprovedDefaults.taskCount) throw new Error("schedule task count differs from the approved target");
  if (ecs.LaunchType !== contract.scheduleApprovedDefaults.launchType) throw new Error("schedule launch type is invalid");
  if (ecs.PlatformVersion != null && (typeof ecs.PlatformVersion !== "string" || !ecs.PlatformVersion)) throw new Error("schedule platform version is invalid");
  if (ecs.EnableExecuteCommand != null && typeof ecs.EnableExecuteCommand !== "boolean") throw new Error("schedule execute-command flag is invalid");
  if (ecs.PropagateTags != null && !["TASK_DEFINITION", "SERVICE", "NONE"].includes(ecs.PropagateTags)) throw new Error("schedule tag propagation is invalid");
  const network = ecs.NetworkConfiguration;
  const awsvpc = network?.awsvpcConfiguration;
  if (!awsvpc || Object.keys(network).length !== 1 || Object.keys(awsvpc).sort().join(",") !== "AssignPublicIp,SecurityGroups,Subnets") throw new Error("schedule network configuration is invalid");
  if (!["ENABLED", "DISABLED"].includes(awsvpc.AssignPublicIp)) throw new Error("schedule public IP setting is invalid");
  if (awsvpc.AssignPublicIp !== contract.scheduleApprovedDefaults.assignPublicIp) throw new Error("schedule public IP setting differs from the approved target");
  const normalizedNetwork = {
    awsvpcConfiguration: {
      AssignPublicIp: awsvpc.AssignPublicIp,
      SecurityGroups: stringSet(awsvpc.SecurityGroups, "schedule security groups"),
      Subnets: stringSet(awsvpc.Subnets, "schedule subnets"),
    },
  };
  if (typeof target.Input !== "string" || target.InputPath !== undefined || target.InputTransformer !== undefined) throw new Error("schedule requires one direct JSON Input");
  assertUnambiguousInput(target.Input);
  let input;
  try { input = JSON.parse(target.Input); }
  catch { throw new Error("schedule Input must be JSON"); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("schedule Input must be a JSON object");
  const inputSha256 = digest(input);
  if (inputSha256 !== contract.scheduleApprovedInputSha256[name]) throw new Error("schedule Input differs from the approved Terraform declaration");
  return {
    name,
    eventBusName: rule.EventBusName || contract.eventBridge.defaultEventBusName,
    state: rule.State,
    targetId: target.Id,
    taskDefinitionArn: ecs.TaskDefinitionArn,
    roleArn,
    scheduleExpression: rule.ScheduleExpression,
    taskCount: ecs.TaskCount,
    launchType: ecs.LaunchType,
    networkConfigurationSha256: digest(normalizedNetwork),
    inputSha256,
    platformVersion: ecs.PlatformVersion ?? null,
    enableExecuteCommand: ecs.EnableExecuteCommand ?? null,
    propagateTags: ecs.PropagateTags ?? null,
    ruleRoleArn: null,
    retryPolicySha256: null,
    deadLetterConfigSha256: null,
  };
}

export function validateScheduleFields(row) {
  if (!row || Object.keys(row).sort().join(",") !== [...SCHEDULE_FIELDS].sort().join(",")) throw new Error("schedule projection property set mismatch");
  if (!HASH.test(row.networkConfigurationSha256) || !HASH.test(row.inputSha256)) throw new Error("schedule digest is invalid");
  if (!Number.isInteger(row.taskCount) || row.taskCount < 1 || row.taskCount > 100 || row.launchType !== "FARGATE") throw new Error("schedule ECS parameters are invalid");
  if (typeof row.roleArn !== "string" || typeof row.scheduleExpression !== "string" || !row.scheduleExpression) throw new Error("schedule stable fields are invalid");
  if (row.platformVersion !== null && (typeof row.platformVersion !== "string" || !row.platformVersion)) throw new Error("schedule platform version is invalid");
  if (row.enableExecuteCommand !== null && typeof row.enableExecuteCommand !== "boolean") throw new Error("schedule execute-command flag is invalid");
  if (row.propagateTags !== null && !["TASK_DEFINITION", "SERVICE", "NONE"].includes(row.propagateTags)) throw new Error("schedule tag propagation is invalid");
  if (row.ruleRoleArn !== null || row.retryPolicySha256 !== null || row.deadLetterConfigSha256 !== null) throw new Error("unsupported schedule settings must be null");
}
