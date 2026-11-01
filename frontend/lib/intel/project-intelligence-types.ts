import type { SalesActivityType, SalesProjectPriority } from "@/lib/sales/types";

export const INTEL_PROJECT_STAGES = ["unknown", "mou", "announced", "approved", "permitting", "construction", "operating", "delayed", "suspended", "canceled"] as const;
export type IntelProjectStage = typeof INTEL_PROJECT_STAGES[number];
export const INTEL_SERVICE_CODES = ["integrated_permit", "chem", "haps", "esg", "etc"] as const;
export type IntelServiceCode = typeof INTEL_SERVICE_CODES[number];
export type IntelIngestionMode = "live" | "initial_backfill" | "replay";
export interface IntelProject {
  projectId: string; title: string; companyName: string | null; facilityId: string | null;
  candidateId: string | null; industry: string | null; region: string | null;
  stage: IntelProjectStage; amount: number | null; currency: string; amountScope: string;
  publicSummary: string | null; expectedStartAt: string | null; expectedEndAt: string | null;
  version: number; state: "active" | "merged" | "archived"; mergedIntoId: string | null;
  owningDeptId: string | null; createdBy: string | null; createdAt: string; updatedAt: string;
  priority?: PublicPriority | null;
}
export interface IntelProjectInput {
  requestKey?: string; title: string; companyName?: string | null; facilityId?: string | null; industry?: string | null;
  region?: string | null; stage?: IntelProjectStage; amount?: number | null; currency?: string;
  amountScope?: string; publicSummary?: string | null; expectedStartAt?: string | null;
  expectedEndAt?: string | null; signalIds?: string[];
}
export interface BriefingProjectFilter {
  q?: string;
  reviewState?: "confirmed" | "needs_review"; sortByPriority?: boolean;
  industries?: string[]; regions?: string[]; types?: string[]; companyNames?: string[];
  serviceCodes?: string[]; amountMin?: number; amountMax?: number; includeUnknownAmount?: boolean;
  from?: string; to?: string; limit?: number; offset?: number;
}
export interface IntelProjectEvent {
  eventId: string; projectId: string; eventType: string; version: number; title: string;
  occurredAt: string | null; discoveredAt: string; before: Record<string, unknown>;
  after: Record<string, unknown>; evidenceSignalIds: string[]; revisionIds: string[];
  mode: IntelIngestionMode; correctsEventId: string | null;
  confirmed: boolean;
}
export interface ServiceAssessment {
  serviceCode: IntelServiceCode; label: string; status: "possible" | "insufficient";
  facts: string[]; rationale: string; questions: string[]; evidenceSignalIds: string[];
  ruleVersion: string; basis: "public"; assessedAt?: string;
}
export interface PriorityComponent { key: string; label: string; maximum: number; points: number | null; reason: string }
export interface PublicPriority {
  ruleVersion: string; basis: "public"; score: number; possibleScore: number;
  maximum: number; needsReview: boolean; components: PriorityComponent[];
  confidence: "confirmed" | "candidate" | "unknown";
}
export interface ManualPriority {
  priority: "high" | "normal" | "low"; reason: string; actorName: string;
  updatedAt: string; ruleVersion: string; projectVersion: number;
}
export interface RecommendedAction {
  key: string; title: string; activityType: SalesActivityType; evidenceSignalIds: string[];
  defaultAssignee: { employeeId: string; name: string } | null;
  salesProjectId: string | null; suggestedDate: string; reason: string;
}
export interface FacilityCandidate {
  candidateId: string; companyName: string; siteAddress: string | null; industry: string | null;
  businessRegistrationNo: string | null; evidence: Record<string, unknown>;
  status: "new" | "in_review" | "linked_existing" | "registered" | "hold" | "rejected";
  reason: string | null; reviewAt: string | null; facilityId: string | null; version: number;
  createdAt: string; updatedAt: string;
}
export interface ActionSuggestion {
  actionId: string; projectId: string; title: string; activityType: SalesActivityType;
  assigneeEmployeeId: string | null; scheduledAt: string | null; endedAt: string | null;
  status: "proposed" | "hold" | "rejected" | "accepted"; reason: string | null;
  evidenceSignalIds: string[]; salesProjectId: string | null; salesActivityId: string | null;
  activityStatus?: string | null; version: number; createdAt: string; updatedAt: string;
}
export interface LinkProjectInput {
  requestKey: string; version: number; salesProjectId?: string; contractId?: string;
  createSales?: { title?: string; serviceCode: IntelServiceCode; serviceSubcategory?: string;
    ownerEmployeeId: string; ownerDeptId: string; priority?: SalesProjectPriority; scopeKey: string };
  actionId?: string;
}
