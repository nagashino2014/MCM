export type FacilityGroupCompanyRole = "group_representative" | "affiliate" | "other";

export type FacilityGroupMembershipRelationType = "site" | "operating_company" | "owner_company" | "other";

export interface FacilityGroup {
  groupId: string;
  groupName: string;
  logoPath: string | null;
  totalRevenue: number | null;
  employeeCount: number | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FacilityGroupDivision {
  divisionId: string;
  groupId: string;
  divisionName: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface FacilityGroupCompany {
  companyId: string;
  groupId: string;
  divisionId: string | null;
  companyName: string;
  businessRegistrationNo: string | null;
  address: string | null;
  phoneNumber: string | null;
  logoPath: string | null;
  groupRole: FacilityGroupCompanyRole;
  isHeadquarters: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FacilityGroupMembership {
  id: number;
  facilityId: string;
  groupId: string;
  companyId: string;
  relationType: FacilityGroupMembershipRelationType;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FacilityGroupInfo {
  group: FacilityGroup;
  division: FacilityGroupDivision | null;
  company: FacilityGroupCompany;
  membership: FacilityGroupMembership;
}

export interface FacilityGroupTree extends FacilityGroup {
  divisions: Array<FacilityGroupDivision & { companies: FacilityGroupCompany[] }>;
  companies: FacilityGroupCompany[];
}
