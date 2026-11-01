import test from "node:test";
import assert from "node:assert/strict";
import { prepareBriefingTask } from "../../infra/aws/ops/prepare-intel-briefing-task.mjs";

test("전용 작업은 고정 이미지와 기존 역할을 유지하고 HTTP healthcheck를 제거한다", () => {
  const input = { taskDefinition: { family: "mcm-staging-next", taskDefinitionArn: "original:748", revision: 748, networkMode: "awsvpc", requiresCompatibilities: ["FARGATE"], taskRoleArn: "app-role", executionRoleArn: "next-execution-role", cpu: "512", memory: "1024", containerDefinitions: [{ name: "next", image: "ecr/next:old", healthCheck: { command: ["CMD", "http-check"] }, portMappings: [{ containerPort: 3000 }], secrets: [{ name: "DATABASE_URL", valueFrom: "secret-ref" }], environment: [] }] } };
  const before = structuredClone(input);
  const task = prepareBriefingTask(input, { family: "mcm-staging-intel-briefing", image: "ecr/next:tested-20261030" });
  assert.deepEqual(input, before); assert.equal(task.family, "mcm-staging-intel-briefing"); assert.equal(task.revision, undefined);
  assert.equal(task.containerDefinitions[0].healthCheck, undefined); assert.equal(task.containerDefinitions[0].portMappings, undefined);
  assert.deepEqual(task.containerDefinitions[0].command, ["node", ".next/intel-briefing-batch.cjs"]);
  assert.equal(task.containerDefinitions[0].secrets[0].valueFrom, "secret-ref");
  assert.throws(() => prepareBriefingTask(input, { family: "mcm-staging-next", image: "ecr/next:tested" }));
  assert.throws(() => prepareBriefingTask(input, { family: "mcm-staging-intel-briefing", image: "ecr/next:latest" }));
  assert.throws(() => prepareBriefingTask(input, { family: "mcm-staging-intel-briefing", image: "registry:5000/next" }));
});
