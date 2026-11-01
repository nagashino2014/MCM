/** 공식 정보원 계약. API 응답에는 인증키와 원문 HTML을 포함하지 않는다. */
export type OfficialProviderId = "kosis" | "law" | "kdi" | "samsung_semiconductor" | "skhynix" | "samsung_sem" | "kiet" | "kea";
export type OfficialDocumentType = "trend" | "statistic" | "policy" | "company_event";
export type OfficialSourceState = "verification_pending" | "credentials_pending" | "configuration_pending" | "rights_pending" | "active" | "paused" | "reference_only" | "error";

export interface OfficialPermissions {
  collectionAllowed: boolean;
  storageAllowed: boolean;
  aiAllowed: boolean;
  internalReportAllowed: boolean;
  evidenceUrl: string;
  note: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface KosisSeriesConfig {
  label: string;
  orgId: string;
  tblId: string;
  itmId: string;
  objL1: string;
  objL2?: string;
  prdSe: "M" | "Q" | "Y";
}
export interface OfficialSourceConfig {
  series?: KosisSeriesConfig[];
  laws?: Array<{ id: string; target: "law" | "admrul" }>;
  channelUrl?: string;
}
export interface OfficialSourceStoredState {
  enabled: boolean;
  permissions: OfficialPermissions;
  verifiedAt: string | null;
  verifiedFingerprint: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextDueAt: string | null;
  configVersion: number;
  leaseToken: string | null;
  leaseUntil: string | null;
}
export interface OfficialProviderDefinition {
  id: OfficialProviderId;
  name: string;
  documentType: OfficialDocumentType;
  homeUrl: string;
  referenceUrls: string[];
  allowedHosts: string[];
  requiresSecret: boolean;
  referenceOnly: boolean;
  intervalHours: number;
  companyName?: string;
  industries: string[];
  note: string;
}
export interface OfficialSourceView {
  providerId: OfficialProviderId;
  sourceId: string | null;
  name: string;
  documentType: OfficialDocumentType;
  homeUrl: string;
  referenceUrls: string[];
  requiresSecret: boolean;
  hasSecret: boolean;
  referenceOnly: boolean;
  enabled: boolean;
  state: OfficialSourceState;
  stateLabel: string;
  permissions: OfficialPermissions;
  config: OfficialSourceConfig;
  configVersion: number;
  verifiedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextDueAt: string | null;
  intervalHours: number;
  note: string;
}
export interface OfficialSourceUpdate {
  providerId: OfficialProviderId;
  enabled: boolean;
  permissions: Omit<OfficialPermissions, "reviewedAt" | "reviewedBy">;
  config: OfficialSourceConfig;
  expectedVersion: number;
  /** 빈 문자열=유지, null=삭제. */
  authSecret?: string | null;
}
export interface OfficialDocumentInput {
  externalId: string;
  documentType: OfficialDocumentType;
  title: string;
  url: string;
  publishedAt: string | null;
  normalizedText: string;
  structuredData: Record<string, unknown>;
  companyName?: string;
  industries: string[];
}
export interface OfficialEvidence extends OfficialDocumentInput {
  documentId: string;
  revisionId: string;
  providerId: string;
  sourceName: string;
  fetchedAt: string;
  signalId: string | null;
}
export interface OfficialCollectResult {
  providerId: OfficialProviderId;
  status: "collected" | "no_change" | "waiting" | "failed" | "busy";
  state: OfficialSourceState;
  scanned: number;
  inserted: number;
  changed: number;
  signalIds: string[];
  revisionIds: string[];
  error?: string;
}
