// 기존 03시 intel 수집 배치와 독립된 실행기. 기존 EventBridge target을 변경하지 않는다.
import { collectDueOfficialSources } from "@/lib/intel/official-sources";
import { runBriefingBatch } from "@/lib/intel/briefing-runner";
import { dispatchBriefingDeliveries } from "@/lib/intel/briefing-delivery";
import { refreshBriefingWakeup } from "@/lib/intel/briefing-scheduler";
import { synchronizeBriefingProjects, queueImportantBriefingEvents } from "@/lib/intel/briefing-important";

async function main() {
  if (process.env.INTEL_BRIEFING_ENABLED !== "true") { console.log("[intel-briefing] disabled"); return; }
  const sources = await collectDueOfficialSources({ limit: 1 });
  const projects = await synchronizeBriefingProjects();
  const important = await queueImportantBriefingEvents();
  const runs = await runBriefingBatch(2);
  const delivery = await dispatchBriefingDeliveries();
  await refreshBriefingWakeup();
  console.log("[intel-briefing]", JSON.stringify({ sources, projects, important, runs, delivery }));
}
main().then(() => process.exit(0)).catch(error => { console.error("[intel-briefing]", error); process.exit(1); });
