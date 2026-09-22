import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { collectSchedulePinPlan, publicSchedulePinPlan, applySchedulePinPlan, rollbackSchedulePin } from "./runtime-db-schedule-pin.mjs";
import { stableJson } from "./runtime-db-transition-state.mjs";

const argv = process.argv.slice(2);
const mode = argv.shift();
if (!["plan", "apply", "rollback"].includes(mode)) throw new Error("usage: node staging-pin-next-schedules.mjs plan|apply|rollback [--profile name] [--approved-plan-id sha --recovery-file absolute-path]");
const options = new Map();
while (argv.length) {
  const key = argv.shift();
  const value = argv.shift();
  if (!["--profile", "--approved-plan-id", "--recovery-file"].includes(key) || !value || options.has(key)) throw new Error("invalid schedule pin arguments");
  options.set(key, value);
}
if (mode === "plan" && (options.has("--approved-plan-id") || options.has("--recovery-file"))) throw new Error("plan mode is read only");
if (mode !== "plan" && (!options.has("--approved-plan-id") || !options.has("--recovery-file"))) throw new Error("apply or rollback requires an approved plan ID and recovery file");

// The 2026-09-21 recovery record is bound to this exact contract. R0B's live
// operator allowlist may change independently, but the pin rollback must not.
const contract = JSON.parse(await readFile(path.join(import.meta.dirname, "runtime-db-schedule-pin-contract-20260921.json"), "utf8"));
const profile = options.get("--profile") ?? "mcm-kesi-staging";
if (!/^[A-Za-z0-9_.-]{1,128}$/u.test(profile)) throw new Error("AWS profile name is invalid");
let awsExecutable = "aws";
let awsPrefix = [];
if (process.env.MCM_SCHEDULE_PIN_AWS_COMMAND_JSON !== undefined) {
  if (process.env.MCM_RUNTIME_TRANSITION_TEST_ADAPTERS !== "1" ||
      String(process.env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    throw new Error("schedule pin test AWS adapter is forbidden");
  }
  const command = JSON.parse(process.env.MCM_SCHEDULE_PIN_AWS_COMMAND_JSON);
  if (!Array.isArray(command) || !command.length || command.some(item => typeof item !== "string" || !item) || !path.isAbsolute(command[0])) {
    throw new Error("schedule pin test AWS command is invalid");
  }
  [awsExecutable, ...awsPrefix] = command;
}

function runAws(service, operation, args) {
  const result = spawnSync(awsExecutable, [...awsPrefix, service, operation, ...args, "--profile", profile, "--region", contract.region, "--no-cli-pager", "--no-paginate", "--output", "json", "--cli-connect-timeout", "3", "--cli-read-timeout", "10"], {
    encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || !result.stdout) throw new Error(`AWS ${service}:${operation} did not complete`);
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`AWS ${service}:${operation} did not return JSON`); }
}

const readOnly = new Set([
  "sts:get-caller-identity", "ecs:describe-services", "ecs:list-task-definitions",
  "events:describe-rule", "events:list-targets-by-rule",
]);
function readAws(service, operation, args) {
  if (!readOnly.has(`${service}:${operation}`)) throw new Error("AWS read is outside the schedule pin allowlist");
  return runAws(service, operation, args);
}

if (mode === "plan") {
  const plan = await collectSchedulePinPlan(contract, readAws);
  process.stdout.write(`${JSON.stringify(publicSchedulePinPlan(plan))}\n`);
} else {
  const recoveryFile = path.resolve(options.get("--recovery-file"));
  if (!path.isAbsolute(options.get("--recovery-file"))) throw new Error("recovery file must use an absolute path");
  const repository = await realpath(path.resolve(import.meta.dirname, "../../.."));
  const parent = await realpath(path.dirname(recoveryFile));
  const relative = path.relative(repository, parent);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("recovery file must be outside the product worktree");
  let recoverySaved = false;
  async function saveRecovery(record) {
    const handle = await open(recoveryFile, "wx", 0o600);
    try { await handle.writeFile(`${stableJson(record)}\n`, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    recoverySaved = true;
  }
  async function putTarget(name, target) {
    if (!recoverySaved) throw new Error("recovery record must exist before PutTargets");
    const temporary = path.join(parent, `mcm-schedule-pin-${randomUUID()}.json`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      try { await handle.writeFile(`${stableJson([target])}\n`, "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      return runAws("events", "put-targets", ["--rule", name, "--targets", `file://${temporary}`]);
    } finally { await unlink(temporary); }
  }
  let outcome;
  if (mode === "apply") {
    outcome = await applySchedulePinPlan({ contract, approvedPlanId: options.get("--approved-plan-id"), readAws, putTarget, saveRecovery });
  } else {
    let recovery;
    try { recovery = JSON.parse(await readFile(recoveryFile, "utf8")); }
    catch { throw new Error("schedule pin recovery file could not be read as JSON"); }
    recoverySaved = true;
    outcome = await rollbackSchedulePin({ contract, approvedPlanId: options.get("--approved-plan-id"), recovery, readAws, putTarget });
  }
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}
