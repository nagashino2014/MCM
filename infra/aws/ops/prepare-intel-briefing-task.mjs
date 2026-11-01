// AWS 호출 없이 검토용 전용 task definition을 작성한다. 등록·서비스 갱신은 별도 승인 후 실행한다.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const REGISTER_KEYS = ["family", "taskRoleArn", "executionRoleArn", "networkMode", "containerDefinitions", "volumes", "placementConstraints", "requiresCompatibilities", "cpu", "memory", "tags", "pidMode", "ipcMode", "proxyConfiguration", "inferenceAccelerators", "ephemeralStorage", "runtimePlatform"];
export function prepareBriefingTask(input, { image, family, containerName = "next" }) {
  const original = input.taskDefinition ?? input;
  if (!family?.endsWith("-intel-briefing")) throw new Error("전용 -intel-briefing family를 지정하세요.");
  const imageReference = typeof image === "string" ? image.split("/").at(-1) : "";
  if (!imageReference || /:latest$/.test(imageReference) || !/^[^:@\s]+(?::[\w][\w.-]{0,127}|@sha256:[a-f0-9]{64})$/.test(imageReference)) throw new Error("검증한 고정 이미지 태그 또는 digest가 필요합니다.");
  if (original.networkMode !== "awsvpc" || !original.requiresCompatibilities?.includes("FARGATE")) throw new Error("검증한 Fargate awsvpc task definition이 필요합니다.");
  if (!original.taskRoleArn || !original.executionRoleArn) throw new Error("DB·S3·AI 비밀값을 읽는 기존 next 역할을 확인하세요.");
  const task = Object.fromEntries(REGISTER_KEYS.filter((key) => original[key] !== undefined).map((key) => [key, structuredClone(original[key])]));
  const source = task.containerDefinitions?.find((container) => container.name === containerName);
  if (!source) throw new Error("next 컨테이너를 찾을 수 없습니다.");
  const container = { ...source, image, command: ["node", ".next/intel-briefing-batch.cjs"], essential: true };
  delete container.healthCheck; delete container.portMappings; delete container.dependsOn;
  container.environment = [...(container.environment ?? []).filter((entry) => entry.name !== "INTEL_BRIEFING_ENABLED"), { name: "INTEL_BRIEFING_ENABLED", value: "true" }];
  task.family = family; task.containerDefinitions = [container];
  task.tags = [...(task.tags ?? []).filter((tag) => tag.key !== "Workload"), { key: "Workload", value: "intel-briefing" }];
  return task;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, target, family, image, containerName] = process.argv.slice(2);
  if (!source || !target || !family || !image) throw new Error("사용: node prepare-intel-briefing-task.mjs <next-task.json> <출력.json> <전용-family> <고정-image> [container-name]");
  const task = prepareBriefingTask(JSON.parse(await readFile(source, "utf8")), { family, image, containerName });
  await writeFile(target, JSON.stringify(task, null, 2) + "\n", { flag: "wx" });
  console.log(`검토용 전용 작업 정의를 작성했습니다: ${target}`);
}
