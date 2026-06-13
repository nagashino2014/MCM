import type { FacilityGroupInfo } from "./facility-group";
import type { FacilityOperatingEntityInfo } from "./facility-operating-entity";
import type {
  FacilityAlias,
  FacilityCompanySize,
  FacilityManualProduct,
  FacilityServiceCategory,
} from "./facility-service";

/**
 * 사업장 마스터 화면용 타입.
 * 서버 lib/ieps/queries.ts 의 FacilityListItem 등과 동일 모양 (직접 import 하면 server-only 모듈을 client로 끌어들이므로 별도 정의).
 */

export interface FacilityListItem {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  representativeName: string | null;
  siteAddress: string | null;
  regionSido: string | null;
  regionSigungu: string | null;
  industryCode: string | null;
  industryName: string | null;
  source: string;
  memo: string | null;
  logoPath: string | null;
  aliases: FacilityAlias[];
  serviceCategories: FacilityServiceCategory[];
  companySize: FacilityCompanySize | null;
  createdAt: string;
  updatedAt: string;
  decisionNo: string | null;
  permitDate: string | null;
  isClosed: boolean;
  airClass: number | null;
  waterClass: number | null;
  airAmount: number | null;
  waterAmount: number | null;
  permitsCount: number;
}

export interface FacilityFilterOptions {
  sidos: { value: string; count: number }[];
  sigungus: { value: string; sido: string | null; count: number }[];
  industries: { code: string; name: string | null; count: number }[];
  sources: { value: string; count: number }[];
}

export interface FacilityListFilter {
  q?: string;
  sido?: string;
  /** 복수 지역 검색. 비어 있지 않으면 sido/sigungu 단일 필터보다 우선한다. */
  sidos?: string[];
  sigungu?: string;
  industryCode?: string;
  /** 통합허가 20개 업종 카테고리 id. 지정 시 industryCode 보다 우선한다. */
  industryCategory?: string;
  airClass?: number;
  waterClass?: number;
  source?: string;
  limit?: number;
  offset?: number;
  sort?: "recent" | "name";
}

export interface ProductOutput {
  productName: string | null;
  productionAmount: number | null;
  productionUnit: string | null;
  sourcePage: number | null;
  sourceText: string | null;
}

export interface IndustryDisplay {
  code: string | null;
  name: string | null;
  source?: string | null;
}

export interface PermitDetail {
  permitId: string;
  decisionNo: string | null;
  permitType: string | null;
  permitDate: string | null;
  isFirstPermit: number;
  sourceDocId: string | null;
  sourceAttachmentId: string | null;
  attachmentFileName: string | null;
  airClass: number | null;
  airAmount: number | null;
  waterClass: number | null;
  waterAmount: number | null;
  scaleSourcePage: number | null;
  scaleSourceText: string | null;
  products: ProductOutput[];
}

export interface FacilityDetail {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  representativeName: string | null;
  siteAddress: string | null;
  additionalSiteAddresses: string[];
  phoneNumber: string | null;
  industryCode: string | null;
  industryName: string | null;
  businessCertificateBusinessType: string | null;
  businessCertificateBusinessItem: string | null;
  businessCertificateCorporateRegistrationNo: string | null;
  industries?: IndustryDisplay[];
  regionSido: string | null;
  regionSigungu: string | null;
  source: string;
  memo: string | null;
  logoPath: string | null;
  aliases: FacilityAlias[];
  serviceCategories: FacilityServiceCategory[];
  companySize: FacilityCompanySize | null;
  manualProducts: FacilityManualProduct[];
  groupInfo: FacilityGroupInfo | null;
  operatingEntityInfo: FacilityOperatingEntityInfo | null;
  createdAt: string;
  updatedAt: string;
  isClosed: boolean;
  permits: PermitDetail[];
  businessCertificates: FacilityBusinessCertificate[];
  /** 연간(점검)보고서 최신 1건 스냅샷. 검토결과서가 미공개인 사업장의 보강 데이터. */
  annualReport: AnnualReportSnapshot | null;
}

export interface FacilityBusinessCertificate {
  certificateId: string;
  versionNo: number;
  isCurrent: boolean;
  displayName: string;
  originalFilename: string | null;
  publicPath: string | null;
  businessType: string | null;
  businessItem: string | null;
  corporateRegistrationNo: string | null;
  memo: string | null;
  createdByName: string | null;
  createdByEmail: string | null;
  createdAt: string;
}

export interface AnnualReportSnapshot {
  reportYear: number | null;
  airClass: number | null;
  airAmountTonPerYear: number | null;
  waterClass: number | null;
  wastewaterM3PerDay: number | null;
  products: { productName: string | null; amount: number | null; unit: string | null }[];
  sourceAttachmentId: string | null;
  sourcePdfPath: string | null;
  parsedAt: string | null;
}
