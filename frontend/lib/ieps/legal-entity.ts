export type FacilityOperatingRelationType = "operating_entity" | "owner_entity" | "manager_entity" | "other";

export interface LegalEntity {
  entityId: string;
  entityName: string;
  businessRegistrationNo: string | null;
  address: string | null;
  phoneNumber: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FacilityOperatingEntityRelation {
  id: number;
  facilityId: string;
  entityId: string;
  relationType: FacilityOperatingRelationType;
  startedAt: string | null;
  endedAt: string | null;
  isPrimary: boolean;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FacilityOperatingEntityInfo {
  entity: LegalEntity;
  relation: FacilityOperatingEntityRelation;
}
