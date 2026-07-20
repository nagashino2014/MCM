import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import {
  deleteContractDocument,
  putContractDocument,
  sanitizeFilename,
  sanitizePathSegment,
} from "@/lib/storage/contract-document-storage";

/*
 * 입찰 증빙서류 패키지(078) — 발주처 양식 라이브러리 + 공고별 패키지 작업 상태.
 * 양식 파일은 계약 문서와 같은 저장소에 bids/package-forms/{발주처}/ 프리픽스로 보관한다.
 */

export interface BidPackageForm {
  formId: string;
  orgName: string;
  displayName: string;
  originalFilename: string | null;
  contentType: string | null;
  byteSize: number | null;
  storageKey: string;
  hasProfile: boolean; // LLM 분석 결과(form_profile) 존재 여부 — 분석은 P2
  updatedAt: string;
}

/** 파트 배정 1건 — (사업장기준, 업무기준) 조합. 겸직은 복수 배정으로 표현(예: 영동·계획서작성 + 삼척·계획서작성). */
export interface PartAssignment {
  sitePart: string;
  workPart: string;
}

/** 수행인력 설정 — 참여직위/담당파트/개별 이력 수행실적 필터. */
export interface StaffConfig {
  /** employeeId → 참여직위(PM/팀장/팀원)·파트 배정 목록(겸직 = 복수 배정) */
  roles: Record<string, { role: string; assignments: PartAssignment[] }>;
  /** 담당파트 후보 — 업무기준(계획서작성팀·품질보증팀 등 업무 기반 파트) */
  workParts: string[];
  /** 담당파트 후보 — 사업장기준(용역 범위에 포함된 발주처 산하 개별 사업장·본부) */
  siteParts: string[];
  /**
   * 조직도 배치 옵션 — PM(최상위) → 사업장기준(2순위) → 업무기준(3순위).
   * nested: 업무파트를 각 사업장 산하에 모두 배치 / separate: separatePart(예: 품질보증팀)만
   * 사업장기준 파트들과 같은 레벨에 배치.
   */
  orgLayout: { mode: "nested" | "separate"; separatePart: string };
  /** 후보 리스트에서 삭제한 인력(계약 참여자라도 후보에서 숨김) */
  removedCandidates: string[];
  perfFilter: {
    subtypes: string[]; // 선택된 용역 세분류(빈 배열 = 제한 없음과 구분 위해 applyAll 참조)
    industries: string[];
    years: string[];
    amountMinMan: number | null; // 만원
    amountMaxMan: number | null;
    applyAllSubtypes: boolean;
    applyAllIndustries: boolean;
  };
  /** 실적 미리보기에서 인력별로 제외한 계약(employeeId → contractId[]) — 개별 이력에서 빠진다 */
  excluded: Record<string, string[]>;
  /**
   * 업종 필터를 해제한 인력(employeeId 목록) — 해당 인력의 개별 이력은 선택업종 필터를 무시하고
   * 용역분류·연도·금액 필터만 적용한다(해당 업종 실적이 없는 참여인력 대응).
   */
  industryBypass: string[];
  /** 수기 항목 — 참여임무(개별 이력)·참여기간 개월(집계표)·용역개요 오버라이드(총괄표, 빈 값=자동 생성) */
  manual: {
    assignedRole: Record<string, string>; // employeeId → 본 사업 참여임무
    participateMonths: Record<string, string>; // employeeId → 참여기간(개월)
    overviews: Record<string, string>; // contractId → 용역개요(자동 생성값 대체)
  };
}

export const EMPTY_STAFF_CONFIG: StaffConfig = {
  roles: {},
  workParts: [],
  siteParts: [],
  orgLayout: { mode: "nested", separatePart: "" },
  removedCandidates: [],
  perfFilter: {
    subtypes: [],
    industries: [],
    years: [],
    amountMinMan: null,
    amountMaxMan: null,
    applyAllSubtypes: true,
    applyAllIndustries: true,
  },
  excluded: {},
  industryBypass: [],
  manual: { assignedRole: {}, participateMonths: {}, overviews: {} },
};

export interface BidPackage {
  packageId: string;
  bidType: string;
  bidId: string;
  orgName: string | null;
  formId: string | null;
  contractIds: string[];
  employeeIds: string[];
  staffConfig: StaffConfig;
  status: string;
  updatedAt: string;
}

export interface PackageParticipant {
  employeeId: string;
  name: string;
  positionName: string | null;
  engGrade: string | null;
  specialtyField: string | null;
  contractCount: number; // 선택 계약 중 참여 건수
  hiredAt: string | null; // 입사일 — 화면 정렬(참여직위 동순위 시 근속 긴 순)용
}

function mapForm(r: Record<string, unknown>): BidPackageForm {
  return {
    formId: String(r.form_id ?? ""),
    orgName: String(r.org_name ?? ""),
    displayName: String(r.display_name ?? ""),
    originalFilename: r.original_filename != null ? String(r.original_filename) : null,
    contentType: r.content_type != null ? String(r.content_type) : null,
    byteSize: r.byte_size != null ? Number(r.byte_size) : null,
    storageKey: String(r.storage_key ?? ""),
    hasProfile: r.form_profile != null,
    updatedAt: String(r.updated_at ?? ""),
  };
}

function parseIds(value: unknown): string[] {
  try {
    const v = typeof value === "string" ? JSON.parse(value) : value;
    if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  } catch {
    // 무시 — 빈 배열
  }
  return [];
}

function parseStaffConfig(value: unknown): StaffConfig {
  try {
    const v = typeof value === "string" ? JSON.parse(value) : value;
    if (v && typeof v === "object") {
      const o = v as Partial<StaffConfig> & { parts?: unknown };
      // 참여직위·파트 배정 — 구버전 { part } / { workPart, sitePart } 저장분은 배정 1건으로 승계
      const roles: StaffConfig["roles"] = {};
      if (o.roles && typeof o.roles === "object") {
        for (const [id, rc] of Object.entries(o.roles as Record<string, Record<string, unknown>>)) {
          if (!rc || typeof rc !== "object") continue;
          let assignments: PartAssignment[] = [];
          if (Array.isArray(rc.assignments)) {
            assignments = (rc.assignments as Record<string, unknown>[])
              .filter((a) => a && typeof a === "object")
              .map((a) => ({ sitePart: String(a.sitePart ?? ""), workPart: String(a.workPart ?? "") }))
              .filter((a) => a.sitePart || a.workPart);
          } else {
            const workPart = String(rc.workPart ?? rc.part ?? "");
            const sitePart = String(rc.sitePart ?? "");
            if (workPart || sitePart) assignments = [{ sitePart, workPart }];
          }
          roles[String(id)] = { role: String(rc.role ?? ""), assignments };
        }
      }
      const layout = (o.orgLayout && typeof o.orgLayout === "object" ? o.orgLayout : {}) as Record<string, unknown>;
      return {
        roles,
        // 구버전 parts[] 는 업무기준 파트로 승계
        workParts: Array.isArray(o.workParts)
          ? o.workParts.map(String)
          : Array.isArray(o.parts)
            ? (o.parts as unknown[]).map(String)
            : [],
        siteParts: Array.isArray(o.siteParts) ? o.siteParts.map(String) : [],
        orgLayout: {
          mode: layout.mode === "separate" ? "separate" : "nested",
          separatePart: String(layout.separatePart ?? ""),
        },
        removedCandidates: Array.isArray(o.removedCandidates) ? o.removedCandidates.map(String) : [],
        perfFilter: {
          subtypes: Array.isArray(o.perfFilter?.subtypes) ? o.perfFilter.subtypes.map(String) : [],
          industries: Array.isArray(o.perfFilter?.industries) ? o.perfFilter.industries.map(String) : [],
          years: Array.isArray(o.perfFilter?.years) ? o.perfFilter.years.map(String) : [],
          amountMinMan: o.perfFilter?.amountMinMan != null ? Number(o.perfFilter.amountMinMan) : null,
          amountMaxMan: o.perfFilter?.amountMaxMan != null ? Number(o.perfFilter.amountMaxMan) : null,
          applyAllSubtypes: o.perfFilter?.applyAllSubtypes !== false,
          applyAllIndustries: o.perfFilter?.applyAllIndustries !== false,
        },
        excluded: Object.fromEntries(
          Object.entries(o.excluded && typeof o.excluded === "object" ? o.excluded : {}).map(([k, v]) => [
            String(k),
            Array.isArray(v) ? v.map(String) : [],
          ])
        ),
        industryBypass: Array.isArray(o.industryBypass) ? o.industryBypass.map(String) : [],
        manual: (() => {
          const m = (o.manual && typeof o.manual === "object" ? o.manual : {}) as Record<string, unknown>;
          const dict = (v: unknown): Record<string, string> =>
            v && typeof v === "object"
              ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [String(k), String(x ?? "")]))
              : {};
          return {
            assignedRole: dict(m.assignedRole),
            participateMonths: dict(m.participateMonths),
            overviews: dict(m.overviews),
          };
        })(),
      };
    }
  } catch {
    // 무시 — 기본값
  }
  return JSON.parse(JSON.stringify(EMPTY_STAFF_CONFIG)) as StaffConfig;
}

function mapPackage(r: Record<string, unknown>): BidPackage {
  return {
    packageId: String(r.package_id ?? ""),
    bidType: String(r.bid_type ?? ""),
    bidId: String(r.bid_id ?? ""),
    orgName: r.org_name != null ? String(r.org_name) : null,
    formId: r.form_id != null ? String(r.form_id) : null,
    contractIds: parseIds(r.contract_ids),
    employeeIds: parseIds(r.employee_ids),
    staffConfig: parseStaffConfig(r.staff_config),
    status: String(r.status ?? "draft"),
    updatedAt: String(r.updated_at ?? ""),
  };
}

/** 공고별 패키지 작업 상태 조회(없으면 null). */
export async function getPackage(bidType: string, bidId: string): Promise<BidPackage | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT * FROM bid_packages WHERE bid_type = $1 AND bid_id = $2", [bidType, bidId])
  );
  return rows.length ? mapPackage(rows[0]) : null;
}

/** 패키지 작업 상태 저장(공고당 1건 upsert). */
export async function savePackage(params: {
  bidType: string;
  bidId: string;
  orgName: string | null;
  formId: string | null;
  contractIds: string[];
  employeeIds: string[];
  staffConfig: StaffConfig | null;
  actorUserId: string | null;
}): Promise<BidPackage> {
  const now = new Date().toISOString();
  const packageId = "bpk_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO bid_packages
         (package_id, bid_type, bid_id, org_name, form_id, contract_ids, employee_ids, staff_config, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, 'draft', $9, $10, $10)
       ON CONFLICT (bid_type, bid_id) DO UPDATE SET
         org_name = EXCLUDED.org_name,
         form_id = EXCLUDED.form_id,
         contract_ids = EXCLUDED.contract_ids,
         employee_ids = EXCLUDED.employee_ids,
         staff_config = EXCLUDED.staff_config,
         updated_at = EXCLUDED.updated_at`,
      [
        packageId,
        params.bidType,
        params.bidId,
        params.orgName,
        params.formId,
        JSON.stringify([...new Set(params.contractIds.map((s) => s.trim()).filter(Boolean))]),
        JSON.stringify([...new Set(params.employeeIds.map((s) => s.trim()).filter(Boolean))]),
        JSON.stringify(params.staffConfig ?? EMPTY_STAFF_CONFIG),
        params.actorUserId,
        now,
      ]
    );
  });
  const saved = await getPackage(params.bidType, params.bidId);
  if (!saved) throw new Error("패키지 저장에 실패했습니다.");
  return saved;
}

/** 진행 중(draft) 패키지 목록 — 공고 제목·마감 조인(메인 화면 상단 바로가기 카드). */
export async function listActivePackages(limit = 10): Promise<
  { bidType: string; bidId: string; title: string; orgName: string; deadline: string | null; updatedAt: string }[]
> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT p.bid_type, p.bid_id, p.updated_at,
              COALESCE(n.title, s.title, o.title) AS title,
              COALESCE(n.org_name, s.org_name, o.org_name) AS org_name,
              n.deadline
         FROM bid_packages p
         LEFT JOIN public_bid_notices n ON p.bid_type = 'bid_notice' AND n.bid_id = p.bid_id
         LEFT JOIN public_prior_specs s ON p.bid_type = 'prior_spec' AND s.bid_id = p.bid_id
         LEFT JOIN public_order_plans o ON p.bid_type = 'order_plan' AND o.bid_id = p.bid_id
        WHERE p.status = 'draft'
        ORDER BY p.updated_at DESC
        LIMIT $1`,
      [limit]
    )
  );
  return rows.map((r) => ({
    bidType: String(r.bid_type ?? ""),
    bidId: String(r.bid_id ?? ""),
    title: String(r.title ?? ""),
    orgName: String(r.org_name ?? ""),
    deadline: r.deadline != null ? String(r.deadline) : null,
    updatedAt: String(r.updated_at ?? ""),
  }));
}

/** 발주처 기본 양식 조회(없으면 null). */
export async function getFormByOrg(orgName: string): Promise<BidPackageForm | null> {
  const name = orgName.trim();
  if (!name) return null;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT * FROM bid_package_forms WHERE org_name = $1", [name])
  );
  return rows.length ? mapForm(rows[0]) : null;
}

export async function getFormById(formId: string): Promise<BidPackageForm | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT * FROM bid_package_forms WHERE form_id = $1", [formId])
  );
  return rows.length ? mapForm(rows[0]) : null;
}

/**
 * 발주처 양식 업로드(발주처당 1건 교체). 재업로드 시 form_profile(분석 결과)은 초기화 —
 * 양식이 바뀌었으므로 P2 분석을 다시 밟는다. 이전 파일 키가 달라지면 저장소도 정리.
 */
export async function saveForm(params: {
  orgName: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  actorUserId: string | null;
}): Promise<BidPackageForm> {
  const orgName = params.orgName.trim();
  if (!orgName) throw new Error("발주처명이 비어 있습니다.");
  const fileName = sanitizeFilename(params.fileName) || "form.hwpx";
  const storageKey = ["bids", "package-forms", sanitizePathSegment(orgName), fileName].join("/");

  const prior = await getFormByOrg(orgName);
  const buffer = Buffer.from(params.bytes);
  const stored = await putContractDocument(storageKey, buffer, params.contentType);

  const formId = "bpf_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO bid_package_forms
         (form_id, org_name, display_name, original_filename, content_type, byte_size, storage_key,
          form_profile, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9, $9)
       ON CONFLICT (org_name) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         original_filename = EXCLUDED.original_filename,
         content_type = EXCLUDED.content_type,
         byte_size = EXCLUDED.byte_size,
         storage_key = EXCLUDED.storage_key,
         form_profile = NULL,
         updated_at = EXCLUDED.updated_at`,
      [formId, orgName, fileName, params.fileName, params.contentType, buffer.byteLength, stored.storageKey, params.actorUserId, now]
    );
  });

  if (prior?.storageKey && prior.storageKey !== stored.storageKey) {
    await deleteContractDocument(prior.storageKey);
  }
  const saved = await getFormByOrg(orgName);
  if (!saved) throw new Error("양식 저장에 실패했습니다.");
  return saved;
}

/**
 * 선택한 실적 계약들의 수행인력 합집합 — 수행인력 확정 후보 목록.
 * 같은 인력이 여러 계약에 참여하면 1행으로 합치고 참여 건수를 센다.
 * extraEmployeeIds = 조직도에서 수동 추가한 인력(실적 계약 미참여도 포함, 참여 0건 표시).
 */
export async function listParticipantsForContracts(
  contractIds: string[],
  extraEmployeeIds: string[] = []
): Promise<PackageParticipant[]> {
  const ids = [...new Set(contractIds.map((s) => s.trim()).filter(Boolean))];
  const db = await getDb();
  const out: PackageParticipant[] = [];
  if (ids.length > 0) {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT e.employee_id, e.name, e.eng_grade, e.specialty_field, e.hired_at, p.position_name,
                COUNT(DISTINCT sp.contract_id) AS contract_count,
                MAX(p.rank_order) AS rank_order
           FROM service_participants sp
           JOIN employee_profiles e ON e.employee_id = sp.employee_id
           LEFT JOIN positions p ON p.position_id = e.position_id
          WHERE sp.contract_id = ANY($1::text[])
          GROUP BY e.employee_id, e.name, e.eng_grade, e.specialty_field, e.hired_at, p.position_name
          ORDER BY MAX(p.rank_order) DESC NULLS LAST, e.name ASC`,
        [ids]
      )
    );
    for (const r of rows) {
      out.push({
        employeeId: String(r.employee_id ?? ""),
        name: String(r.name ?? ""),
        positionName: r.position_name != null ? String(r.position_name) : null,
        engGrade: r.eng_grade != null ? String(r.eng_grade) : null,
        specialtyField: r.specialty_field != null ? String(r.specialty_field) : null,
        contractCount: Number(r.contract_count ?? 0),
        hiredAt: r.hired_at != null ? String(r.hired_at) : null,
      });
    }
  }
  const known = new Set(out.map((p) => p.employeeId));
  const extras = [...new Set(extraEmployeeIds.map((s) => s.trim()).filter(Boolean))].filter((id) => !known.has(id));
  if (extras.length > 0) {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT e.employee_id, e.name, e.eng_grade, e.specialty_field, e.hired_at, p.position_name, p.rank_order
           FROM employee_profiles e
           LEFT JOIN positions p ON p.position_id = e.position_id
          WHERE e.employee_id = ANY($1::text[])
          ORDER BY p.rank_order DESC NULLS LAST, e.name ASC`,
        [extras]
      )
    );
    for (const r of rows) {
      out.push({
        employeeId: String(r.employee_id ?? ""),
        name: String(r.name ?? ""),
        positionName: r.position_name != null ? String(r.position_name) : null,
        engGrade: r.eng_grade != null ? String(r.eng_grade) : null,
        specialtyField: r.specialty_field != null ? String(r.specialty_field) : null,
        contractCount: 0,
        hiredAt: r.hired_at != null ? String(r.hired_at) : null,
      });
    }
  }
  return out;
}
