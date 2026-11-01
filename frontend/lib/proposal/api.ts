import { requirePermission } from "@/lib/auth/guards";
import { proposalStore } from "./store";
import { createProposalHandlers } from "./handlers";
export const proposalApi = createProposalHandlers({ store: proposalStore, authorize: requirePermission });
