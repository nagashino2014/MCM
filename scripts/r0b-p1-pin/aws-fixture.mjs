import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(process.env.MCM_PIN_FAKE_STATE, "utf8"));
const service = args[0], operation = args[1];
appendFileSync(process.env.MCM_PIN_FAKE_LOG, `${service}:${operation}\n`);
const option = name => args[args.indexOf(name) + 1];
let result;
if (service === "sts" && operation === "get-caller-identity") result = state.caller;
else if (service === "ecs" && operation === "describe-services") result = state.service;
else if (service === "ecs" && operation === "list-task-definitions") result = state.newest;
else if (service === "events" && operation === "describe-rule") result = state.rules[option("--name")];
else if (service === "events" && operation === "list-targets-by-rule") result = { Targets: [state.targets[option("--rule")] ] };
else if (service === "events" && operation === "put-targets") {
  const name = option("--rule");
  const targetPath = option("--targets").slice("file://".length);
  const target = JSON.parse(readFileSync(targetPath, "utf8"));
  if (!Array.isArray(target) || target.length !== 1) process.exit(8);
  state.targets[name] = target[0];
  writeFileSync(process.env.MCM_PIN_FAKE_STATE, `${JSON.stringify(state)}\n`);
  result = { FailedEntryCount: 0, FailedEntries: [] };
} else process.exit(9);
process.stdout.write(JSON.stringify(result));
