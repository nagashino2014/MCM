/** 정기 브리핑의 화면·API·배치 공통 계약. 공개 근거만 공통 보고서에 저장한다. */
export type BriefingChannel = "inbox" | "email" | "app";
export interface BriefingFilters {
  industries: string[]; regions: string[]; signalTypes: string[];
  companyNames: string[]; services: string[];
  amountMin: number | null; amountMax: number | null; includeUnknownScale: boolean;
}
export interface BriefingSchedule {
  cadence: "daily" | "every3days" | "weekly" | "monthly";
  startDate: string; time: string; weekday: number; monthDay: number;
  timezone: "Asia/Seoul";
}
export interface BriefingRecipient { userId: string; channels: BriefingChannel[] }
export interface BriefingProfileInput {
  name: string; enabled: boolean; visibility: "private" | "shared";
  filters: BriefingFilters; schedule: BriefingSchedule; recipients: BriefingRecipient[];
  reportLevel: "summary" | "detailed"; notifyNoChange: boolean;
  allowPartialSources: boolean; requiredSources: string[];
  importantAlerts: boolean; importantAmount: number | null;
}
export interface BriefingProfile extends BriefingProfileInput {
  profileId: string; ownerUserId: string; version: number;
  nextRunAt: string | null; createdAt: string; updatedAt: string; canManage: boolean;
}
export type BriefingRunStatus = "queued" | "waiting_sources" | "running" | "ready" | "published" | "no_change" | "failed" | "blocked_budget" | "canceled";
export interface BriefingRun {
  runId: string; profileId: string; profileName: string;
  trigger: "scheduled" | "manual"; scheduledFor: string;
  status: BriefingRunStatus; attempt: number; error: string | null;
  briefingId: string | null; snapshotId: string | null;
  profileVersion: number; createdAt: string; updatedAt: string;
}
export interface BriefingEvidence {
  /** 분류 요약과 분리한 공개 원문. 과거 snapshot에는 없을 수 있다. */
  originalText?: string | null;
  qualityInputKind?: "search_excerpt" | "full_text" | "title_only" | "derived";
  id: string; revision: string; kind: "project" | "signal" | "official";
  title: string; companyName: string | null; region: string | null;
  source: string; url: string | null; publishedAt: string | null;
  discoveredAt: string; text: string; changed: boolean; amount: number | null;
  temporalClass?: "current_period" | "late_arrival" | "background" | "initial_baseline";
  relatedEvidenceIds?: string[];
}
export interface BriefingSourceHealth { source: string; lastSuccessAt: string | null; status: "fresh" | "stale" | "unavailable"; message: string }
export interface BriefingPreview {
  totalProjects: number; totalSignals: number; changedCount: number;
  sourceHealth: BriefingSourceHealth[]; items: BriefingEvidence[];
  asOf: string; coverageNote: string | null;
  periodStart?: string; periodEnd?: string; capturedAt?: string; initialBaseline?: boolean;
}
export interface BriefingDelivery {
  deliveryId: string; userId: string; channel: BriefingChannel;
  status: "pending" | "sending" | "sent" | "failed" | "unknown" | "skipped";
  attempt: number; error: string | null; providerId: string | null;
}
