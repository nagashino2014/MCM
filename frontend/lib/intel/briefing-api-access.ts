import { requireAuthenticated } from "@/lib/auth/guards";
import { assertBriefingCapability, type BriefingCapability } from "./briefing-access";

export async function requireBriefingPermission(capability: BriefingCapability) {
  const actor = await requireAuthenticated();
  await assertBriefingCapability(actor.userId, capability);
  return actor;
}
