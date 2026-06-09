export type FacilityMergeReason = "company_change" | "acquisition" | "deduplication" | "other";

export type FacilityHistoryEventType =
  | "company_name_change"
  | "business_registration_no_change"
  | "group_change"
  | "site_address_change"
  | "acquisition"
  | "merger"
  | "closure"
  | "permit_succession"
  | "manual_note";

export const FACILITY_MERGE_REASON_LABELS: Record<FacilityMergeReason, string> = {
  company_change: "상호 변경",
  acquisition: "합병",
  deduplication: "중복 제거",
  other: "기타",
};

export const FACILITY_HISTORY_EVENT_LABELS: Record<FacilityHistoryEventType, string> = {
  company_name_change: "상호 변경",
  business_registration_no_change: "사업자번호 변경",
  group_change: "계열/그룹 변경",
  site_address_change: "소재지 변경",
  acquisition: "인수",
  merger: "합병",
  closure: "폐업",
  permit_succession: "허가 승계",
  manual_note: "기타 이력",
};

export class FacilityLegacyIdentity {
  targetFacilityId: string;
  sourceFacilityId: string;
  previousCompanyName: string | null;
  previousBusinessRegistrationNo: string | null;
  mergeReason: FacilityMergeReason;
  createdAt: string;
  createdBy: string | null;

  constructor(args: {
    targetFacilityId: string;
    sourceFacilityId: string;
    previousCompanyName: string | null;
    previousBusinessRegistrationNo: string | null;
    mergeReason: FacilityMergeReason;
    createdAt: string;
    createdBy: string | null;
  }) {
    this.targetFacilityId = args.targetFacilityId;
    this.sourceFacilityId = args.sourceFacilityId;
    this.previousCompanyName = args.previousCompanyName;
    this.previousBusinessRegistrationNo = args.previousBusinessRegistrationNo;
    this.mergeReason = args.mergeReason;
    this.createdAt = args.createdAt;
    this.createdBy = args.createdBy;
  }

  toDbParams(): unknown[] {
    return [
      this.targetFacilityId,
      this.sourceFacilityId,
      this.previousCompanyName,
      this.previousBusinessRegistrationNo,
      this.mergeReason,
      this.createdAt,
      this.createdBy,
    ];
  }
}

export class FacilityPermitSuccession {
  targetFacilityId: string;
  sourceFacilityId: string;
  permitId: string;
  decisionNo: string | null;
  permitType: string | null;
  permitDate: string | null;
  previousCompanyName: string | null;
  previousBusinessRegistrationNo: string | null;
  mergeReason: FacilityMergeReason;
  createdAt: string;
  createdBy: string | null;

  constructor(args: {
    targetFacilityId: string;
    sourceFacilityId: string;
    permitId: string;
    decisionNo: string | null;
    permitType: string | null;
    permitDate: string | null;
    previousCompanyName: string | null;
    previousBusinessRegistrationNo: string | null;
    mergeReason: FacilityMergeReason;
    createdAt: string;
    createdBy: string | null;
  }) {
    this.targetFacilityId = args.targetFacilityId;
    this.sourceFacilityId = args.sourceFacilityId;
    this.permitId = args.permitId;
    this.decisionNo = args.decisionNo;
    this.permitType = args.permitType;
    this.permitDate = args.permitDate;
    this.previousCompanyName = args.previousCompanyName;
    this.previousBusinessRegistrationNo = args.previousBusinessRegistrationNo;
    this.mergeReason = args.mergeReason;
    this.createdAt = args.createdAt;
    this.createdBy = args.createdBy;
  }

  toDbParams(): unknown[] {
    return [
      this.targetFacilityId,
      this.sourceFacilityId,
      this.permitId,
      this.decisionNo,
      this.permitType,
      this.permitDate,
      this.previousCompanyName,
      this.previousBusinessRegistrationNo,
      this.mergeReason,
      this.createdAt,
      this.createdBy,
    ];
  }
}

export class FacilityHistoryEvent {
  facilityId: string;
  eventType: FacilityHistoryEventType;
  eventTypes: FacilityHistoryEventType[];
  eventDate: string | null;
  previousCompanyName: string | null;
  newCompanyName: string | null;
  previousBusinessRegistrationNo: string | null;
  newBusinessRegistrationNo: string | null;
  previousGroupName: string | null;
  newGroupName: string | null;
  previousSiteAddress: string | null;
  newSiteAddress: string | null;
  acquirerCompanyName: string | null;
  mergerTargetCompanyNames: string[];
  relatedCompanyName: string | null;
  sourceFacilityId: string | null;
  memo: string | null;
  source: string;
  createdAt: string;
  createdBy: string | null;

  constructor(args: {
    facilityId: string;
    eventType: FacilityHistoryEventType;
    eventTypes?: FacilityHistoryEventType[];
    eventDate: string | null;
    previousCompanyName: string | null;
    newCompanyName: string | null;
    previousBusinessRegistrationNo: string | null;
    newBusinessRegistrationNo: string | null;
    previousGroupName: string | null;
    newGroupName: string | null;
    previousSiteAddress?: string | null;
    newSiteAddress?: string | null;
    acquirerCompanyName?: string | null;
    mergerTargetCompanyNames?: string[];
    relatedCompanyName: string | null;
    sourceFacilityId: string | null;
    memo: string | null;
    source: string;
    createdAt: string;
    createdBy: string | null;
  }) {
    this.facilityId = args.facilityId;
    this.eventType = args.eventType;
    this.eventTypes = args.eventTypes?.length ? args.eventTypes : [args.eventType];
    this.eventDate = args.eventDate;
    this.previousCompanyName = args.previousCompanyName;
    this.newCompanyName = args.newCompanyName;
    this.previousBusinessRegistrationNo = args.previousBusinessRegistrationNo;
    this.newBusinessRegistrationNo = args.newBusinessRegistrationNo;
    this.previousGroupName = args.previousGroupName;
    this.newGroupName = args.newGroupName;
    this.previousSiteAddress = args.previousSiteAddress ?? null;
    this.newSiteAddress = args.newSiteAddress ?? null;
    this.acquirerCompanyName = args.acquirerCompanyName ?? null;
    this.mergerTargetCompanyNames = args.mergerTargetCompanyNames ?? [];
    this.relatedCompanyName = args.relatedCompanyName;
    this.sourceFacilityId = args.sourceFacilityId;
    this.memo = args.memo;
    this.source = args.source;
    this.createdAt = args.createdAt;
    this.createdBy = args.createdBy;
  }

  toDbParams(): unknown[] {
    return [
      this.facilityId,
      this.eventType,
      this.eventDate,
      this.previousCompanyName,
      this.newCompanyName,
      this.previousBusinessRegistrationNo,
      this.newBusinessRegistrationNo,
      this.previousGroupName,
      this.newGroupName,
      this.relatedCompanyName,
      this.sourceFacilityId,
      this.memo,
      this.source,
      this.createdAt,
      this.createdBy,
      this.previousSiteAddress,
      this.newSiteAddress,
      this.acquirerCompanyName,
      this.mergerTargetCompanyNames.length ? JSON.stringify(this.mergerTargetCompanyNames) : null,
      this.eventTypes.length ? JSON.stringify(this.eventTypes) : null,
    ];
  }
}

export function normalizeFacilityHistoryEventType(value: unknown): FacilityHistoryEventType {
  if (
    value === "company_name_change" ||
    value === "business_registration_no_change" ||
    value === "group_change" ||
    value === "site_address_change" ||
    value === "acquisition" ||
    value === "merger" ||
    value === "closure" ||
    value === "permit_succession" ||
    value === "manual_note"
  ) {
    return value;
  }
  return "manual_note";
}

export function normalizeFacilityMergeReason(value: unknown): FacilityMergeReason {
  if (
    value === "company_change" ||
    value === "acquisition" ||
    value === "deduplication" ||
    value === "other"
  ) {
    return value;
  }
  return "deduplication";
}
