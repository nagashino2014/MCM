import { getDb, rowsToObjects } from "@/lib/db";

/** 발급기관(자사) 고정 정보. 추후 설정 테이블이 생기면 이 상수를 교체한다. */
export const ISSUER = {
  companyName: "㈜한국환경안전연구원",
  address: "서울 금천구 가산동",
  phone: "02-6672-0035",
  businessRegistrationNo: "557-86-00306",
  representative: "이유엄",
  defaultPurpose: "입찰 참여용",
} as const;

/** 증명서 발급 대상 용역분류. 현재는 통합허가만. */
export const CERTIFIABLE_SERVICE_TYPE = "통합허가";

/** 세분류별 용역범위·개요 문구. (허가류='…의 … 취득 대행', 신고/관리류='… … 대행') */
export function certScopeText(site: string, subtype: string | null): string {
  const s = (subtype ?? "").trim();
  if (s === "최초허가" || s === "변경허가") return `${site}의 ${s} 취득 대행 용역 수행`;
  // 변경신고 / 재검토 / 사후관리 / 통합교육 등
  return `${site} ${s} 대행 용역 수행`;
}

/** 세분류별 이행실적 문구. */
export function certPerfText(subtype: string | null): string {
  const s = (subtype ?? "").trim();
  if (s === "최초허가" || s === "변경허가") return `${s} 취득`;
  return `${s} 진행`;
}

export interface CertificateData {
  contractId: string;
  serviceName: string; // 용역명
  siteName: string; // 통합허가 대상 사업장명
  scopeText: string; // 용역범위 = 용역개요
  perfText: string; // 이행실적
  contractDate: string; // 계약일자
  contractPeriod: string; // 계약기간(이행기간)
  amountText: string; // 계약금액
  // 발급기관 = 발주처(통합허가 대상 사업장) 정보
  facilityPhone: string; // 발급기관 전화
  facilityAddress: string; // 발급기관 주소
  issueDept: string;
  issuePerson: string;
  issueFax: string;
  // 발급 일자
  year: string;
  month: string;
  day: string;
  // 발급건별 입력값
  submittedTo: string; // 제출처
  purpose: string; // 증명서용도
}

function fmtDate(value: unknown): string {
  const s = value != null ? String(value).trim() : "";
  if (!s) return "";
  const m = s.match(/(\d{4})\D?(\d{1,2})\D?(\d{1,2})/);
  if (!m) return s; // '용역 완료시 까지' 같은 자유 텍스트는 그대로
  return `${m[1]}.${m[2].padStart(2, "0")}.${m[3].padStart(2, "0")}`;
}

function fmtAmount(value: unknown): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

export interface ContactOption {
  personId: string;
  name: string;
  title: string;
  deptName: string;
  fax: string;
  active: boolean;
}

/** 계약의 통합허가 대상 사업장 + 식별자. */
async function loadContractSite(
  contractId: string
): Promise<{ contract: Record<string, unknown>; siteFacilityId: string; siteName: string } | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id, c.contract_title, c.service_type, c.service_subtype,
              c.contract_amount, c.contract_date, c.started_at, c.ended_at,
              COALESCE(tf.company_name, f.company_name) AS site_name,
              COALESCE(tf.facility_id, c.facility_id) AS site_facility_id
         FROM contracts c
         LEFT JOIN facilities f ON f.facility_id = c.facility_id
         LEFT JOIN LATERAL (
           SELECT f2.facility_id, f2.company_name
             FROM contract_facilities cf
             JOIN facilities f2 ON f2.facility_id = cf.facility_id
            WHERE cf.contract_id = c.contract_id
              AND cf.relation_type = 'integrated_permit_target'
            ORDER BY f2.company_name ASC
            LIMIT 1
         ) tf ON true
        WHERE c.contract_id = $1
          AND c.deleted_at IS NULL
        LIMIT 1`,
      [contractId]
    )
  );
  const c = rows[0];
  if (!c) return null;
  return {
    contract: c,
    siteFacilityId: c.site_facility_id != null ? String(c.site_facility_id) : "",
    siteName: c.site_name != null ? String(c.site_name) : "",
  };
}

/** 담당자 선택 UI용: 계약의 대상 사업장에 등록된 담당자 리스트. */
export async function listContractContacts(
  contractId: string
): Promise<{ facilityName: string; contacts: ContactOption[] }> {
  const site = await loadContractSite(contractId);
  if (!site || !site.siteFacilityId) return { facilityName: site?.siteName ?? "", contacts: [] };
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT p.id, p.person_name, p.title, p.status, d.department_name, d.fax_number
         FROM facility_contact_people p
         LEFT JOIN facility_contact_departments d ON d.id = p.department_id
        WHERE p.facility_id = $1
        ORDER BY (p.status = 'active') DESC, p.id ASC`,
      [site.siteFacilityId]
    )
  );
  return {
    facilityName: site.siteName,
    contacts: rows.map((r) => ({
      personId: String(r.id ?? ""),
      name: r.person_name != null ? String(r.person_name) : "",
      title: r.title != null ? String(r.title) : "",
      deptName: r.department_name != null ? String(r.department_name) : "",
      fax: r.fax_number != null ? String(r.fax_number) : "",
      active: String(r.status ?? "") === "active",
    })),
  };
}

/** 사업장 담당자(지정 personId 우선, 없으면 활성 첫번째) + 부서명/팩스 보완. */
async function resolveIssueContact(
  siteFacilityId: string,
  contactPersonId?: string
): Promise<{ issuePerson: string; issueDept: string; issueFax: string }> {
  let issuePerson = "";
  let issueDept = "";
  let issueFax = "";
  if (!siteFacilityId) return { issuePerson, issueDept, issueFax };
  const db = await getDb();
  const pid = (contactPersonId ?? "").trim();
  const contact = rowsToObjects(
    pid
      ? await db.exec(
          `SELECT p.person_name, p.title, d.department_name, d.fax_number
             FROM facility_contact_people p
             LEFT JOIN facility_contact_departments d ON d.id = p.department_id
            WHERE p.facility_id = $1 AND p.id = $2
            LIMIT 1`,
          [siteFacilityId, pid]
        )
      : await db.exec(
          `SELECT p.person_name, p.title, d.department_name, d.fax_number
             FROM facility_contact_people p
             LEFT JOIN facility_contact_departments d ON d.id = p.department_id
            WHERE p.facility_id = $1
            ORDER BY (p.status = 'active') DESC, p.id ASC
            LIMIT 1`,
          [siteFacilityId]
        )
  )[0];
  if (contact) {
    const name = contact.person_name != null ? String(contact.person_name) : "";
    const title = contact.title != null ? String(contact.title) : "";
    issuePerson = [name, title].filter(Boolean).join(" ");
    issueDept = contact.department_name != null ? String(contact.department_name) : "";
    issueFax = contact.fax_number != null ? String(contact.fax_number) : "";
  }
  // 담당자에 부서/팩스가 없으면 사업장의 첫 부서에서 보완
  if (!issueDept || !issueFax) {
    const dept = rowsToObjects(
      await db.exec(
        `SELECT department_name, fax_number FROM facility_contact_departments
          WHERE facility_id = $1 ORDER BY id ASC LIMIT 1`,
        [siteFacilityId]
      )
    )[0];
    if (dept) {
      if (!issueDept) issueDept = dept.department_name != null ? String(dept.department_name) : "";
      if (!issueFax) issueFax = dept.fax_number != null ? String(dept.fax_number) : "";
    }
  }
  return { issuePerson, issueDept, issueFax };
}

/**
 * 증명서 토큰 데이터. service_type이 통합허가가 아니거나 계약이 없으면 null(스킵).
 */
export async function getCertificateData(
  contractId: string,
  opts: { submittedTo?: string; purpose?: string; contactPersonId?: string } = {}
): Promise<CertificateData | null> {
  const site = await loadContractSite(contractId);
  if (!site) return null;
  const c = site.contract;
  if (String(c.service_type ?? "") !== CERTIFIABLE_SERVICE_TYPE) return null;

  const siteName = site.siteName;
  const { issuePerson, issueDept, issueFax } = await resolveIssueContact(
    site.siteFacilityId,
    opts.contactPersonId
  );

  // 발급기관(발주처) 전화/주소
  let facilityPhone = "";
  let facilityAddress = "";
  if (site.siteFacilityId) {
    const db = await getDb();
    const f = rowsToObjects(
      await db.exec("SELECT phone_number, site_address FROM facilities WHERE facility_id = $1", [site.siteFacilityId])
    )[0];
    if (f) {
      facilityPhone = f.phone_number != null ? String(f.phone_number) : "";
      facilityAddress = f.site_address != null ? String(f.site_address) : "";
    }
    if (!facilityPhone) {
      const fallback = rowsToObjects(
        await db.exec(
          `SELECT phone_number FROM facility_contact_main_numbers WHERE facility_id = $1
           UNION ALL
           SELECT phone_number FROM facility_contact_departments WHERE facility_id = $1 AND phone_number IS NOT NULL
           LIMIT 1`,
          [site.siteFacilityId]
        )
      )[0];
      if (fallback?.phone_number) facilityPhone = String(fallback.phone_number);
    }
  }

  const now = new Date();
  const subtype = c.service_subtype != null ? String(c.service_subtype) : "";
  const started = fmtDate(c.started_at);
  const ended = fmtDate(c.ended_at);

  return {
    contractId: String(c.contract_id ?? contractId),
    serviceName: c.contract_title != null ? String(c.contract_title) : "",
    siteName,
    scopeText: certScopeText(siteName, subtype),
    perfText: certPerfText(subtype),
    contractDate: fmtDate(c.contract_date),
    contractPeriod: started ? `${started} ~ ${ended}` : ended,
    amountText: fmtAmount(c.contract_amount),
    facilityPhone,
    facilityAddress,
    issueDept,
    issuePerson,
    issueFax,
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1),
    day: String(now.getDate()),
    submittedTo: (opts.submittedTo ?? "").trim(),
    purpose: (opts.purpose ?? "").trim() || ISSUER.defaultPurpose,
  };
}
