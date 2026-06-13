export type FacilityOperatingRelationType = "operating_entity" | "owner_entity" | "manager_entity" | "other";

export interface FacilityOperatingCounterparty {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  siteAddress: string | null;
  phoneNumber: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FacilityOperatingEntityRelation {
  id: number;
  facilityId: string;
  relatedFacilityId: string;
  relationType: FacilityOperatingRelationType;
  startedAt: string | null;
  endedAt: string | null;
  isPrimary: boolean;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FacilityOperatingEntityInfo {
  counterparty: FacilityOperatingCounterparty;
  relation: FacilityOperatingEntityRelation;
}
