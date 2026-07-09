/**
 * /data/status, /data/review용 PostgreSQL 조회 헬퍼.
 * - 모두 Aurora PostgreSQL 을 읽기 전용으로 접근하며, write는 withDbWrite 트랜잭션을 별도로 사용한다.
 */

import { getDb, invalidateDb, rowsToObjects } from "../db";

type DbHandle = Awaited<ReturnType<typeof getDb>>;
import {
  cleanProductName,
  formatAddress,
  formatBusinessRegistrationNo,
  formatCompanyName,
  parseIndustriesFromValue,
  type IndustryDisplay,
} from "./formatters";
import { findIntegratedPermitIndustry } from "./integrated-permit-industries";
import type { FacilityGroupCompanyRole, FacilityGroupInfo, FacilityGroupMembershipRelationType } from "./facility-group";
import type { FacilityOperatingEntityInfo, FacilityOperatingRelationType } from "./facility-operating-entity";
import {
  FACILITY_COMPANY_SIZE_LABELS,
  FACILITY_COMPANY_SIZE_ORDER,
  FACILITY_SERVICE_LABELS,
  FACILITY_SERVICE_ORDER,
  normalizeFacilityCompanySize,
  normalizeFacilityServiceCategory,
  type FacilityAlias,
  type FacilityCompanySize,
  type FacilityManualProduct,
  type FacilityServiceCategory,
} from "./facility-service";

export interface KpiSummary {
  totalFacilities: number;
  recentFacilities24h: number;
  downloadedPdfs: number;
  parsedDocs: number;
  needsReview: number;
  /** 라운드 2C — Playwright 폴백으로 다운로드된 PDF 개수 */
  playwrightFallbacks: number;
  /** 라운드 2C — 다운로드 실패 (status='failed') 개수 */
  failedDownloads: number;
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function rowsForIds(
  db: DbHandle,
  tableSql: string,
  ids: string[]
): Promise<Array<Record<string, unknown>>> {
  if (!ids.length) return [];
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const r = await db.exec(tableSql.replace("__IDS__", placeholders), ids);
  return rowsToObjects(r);
}

async function loadAliasesByFacility(db: DbHandle, ids: string[]) {
  const map = new Map<string, FacilityAlias[]>();
  try {
    const rows = await rowsForIds(
      db,
      `SELECT facility_id, id, alias, alias_type, note, is_primary
         FROM facility_aliases
        WHERE facility_id IN (__IDS__)
        ORDER BY is_primary DESC, id ASC`,
      ids
    );
    for (const row of rows) {
      const facilityId = String(row.facility_id ?? "");
      if (!map.has(facilityId)) map.set(facilityId, []);
      map.get(facilityId)!.push({
        id: row.id != null ? Number(row.id) : undefined,
        alias: String(row.alias ?? ""),
        aliasType: row.alias_type != null ? String(row.alias_type) : null,
        note: row.note != null ? String(row.note) : null,
        isPrimary: Number(row.is_primary ?? 0) === 1,
      });
    }
  } catch {
    // optional extension table
  }
  return map;
}

async function loadServiceCategoriesByFacility(db: DbHandle, ids: string[]) {
  const map = new Map<string, FacilityServiceCategory[]>();
  try {
    const rows = await rowsForIds(
      db,
      `SELECT facility_id, category
         FROM facility_service_categories
        WHERE facility_id IN (__IDS__)`,
      ids
    );
    for (const row of rows) {
      const facilityId = String(row.facility_id ?? "");
      const category = normalizeFacilityServiceCategory(row.category);
      if (!category) continue;
      if (!map.has(facilityId)) map.set(facilityId, []);
      map.get(facilityId)!.push(category);
    }
  } catch {
    // optional extension table
  }
  for (const [facilityId, categories] of map) {
    map.set(
      facilityId,
      FACILITY_SERVICE_ORDER.filter((category) => categories.includes(category))
    );
  }
  return map;
}

async function loadManualProducts(db: DbHandle, facilityId: string): Promise<FacilityManualProduct[]> {
  try {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT id, product_name, amount, unit, note
           FROM facility_manual_products
          WHERE facility_id = $1
          ORDER BY id ASC`,
        [facilityId]
      )
    );
    return rows.map((row) => ({
      id: row.id != null ? Number(row.id) : undefined,
      productName: String(row.product_name ?? ""),
      amount: finiteNumber(row.amount),
      unit: row.unit != null ? String(row.unit) : null,
      note: row.note != null ? String(row.note) : null,
    }));
  } catch {
    return [];
  }
}

function normalizeCompanyRole(row: Record<string, unknown>): FacilityGroupCompanyRole {
  const role = String(row.group_role ?? "").trim();
  if (role === "group_representative" || role === "affiliate" || role === "other") return role;
  return Number(row.is_headquarters ?? 0) === 1 ? "group_representative" : "affiliate";
}

function normalizeMembershipRelationType(value: unknown): FacilityGroupMembershipRelationType {
  const relationType = String(value ?? "site");
  if (relationType === "site" || relationType === "operating_company" || relationType === "owner_company" || relationType === "other") {
    return relationType;
  }
  return "site";
}

function normalizeOperatingRelationType(value: unknown): FacilityOperatingRelationType {
  const relationType = String(value ?? "operating_entity");
  if (relationType === "operating_entity" || relationType === "owner_entity" || relationType === "manager_entity" || relationType === "other") {
    return relationType;
  }
  return "operating_entity";
}

async function loadOperatingEntityInfo(db: DbHandle, facilityId: string): Promise<FacilityOperatingEntityInfo | null> {
  try {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT
           r.id, r.facility_id, r.related_facility_id, r.relation_type, r.started_at, r.ended_at,
           r.is_primary, r.memo AS relation_memo, r.created_at AS relation_created_at, r.updated_at AS relation_updated_at,
           rf.company_name AS counterparty_name, rf.business_registration_no, rf.site_address,
           rf.phone_number, rf.memo AS counterparty_memo,
           rf.created_at AS counterparty_created_at, rf.updated_at AS counterparty_updated_at
         FROM facility_operating_entities r
         JOIN facilities rf ON rf.facility_id = r.related_facility_id
         WHERE r.facility_id = $1
           AND r.ended_at IS NULL
           AND r.is_primary = 1
         ORDER BY r.updated_at DESC
         LIMIT 1`,
        [facilityId]
      )
    );
    const row = rows[0];
    if (!row) return null;
    return {
      counterparty: {
        facilityId: String(row.related_facility_id ?? ""),
        companyName: formatCompanyName(String(row.counterparty_name ?? "")) ?? "",
        businessRegistrationNo:
          row.business_registration_no != null ? formatBusinessRegistrationNo(String(row.business_registration_no)) : null,
        siteAddress: row.site_address != null ? formatAddress(String(row.site_address)) : null,
        phoneNumber: row.phone_number != null ? String(row.phone_number) : null,
        memo: row.counterparty_memo != null ? String(row.counterparty_memo) : null,
        createdAt: String(row.counterparty_created_at ?? ""),
        updatedAt: String(row.counterparty_updated_at ?? ""),
      },
      relation: {
        id: Number(row.id ?? 0),
        facilityId: String(row.facility_id ?? ""),
        relatedFacilityId: String(row.related_facility_id ?? ""),
        relationType: normalizeOperatingRelationType(row.relation_type),
        startedAt: row.started_at != null ? String(row.started_at) : null,
        endedAt: row.ended_at != null ? String(row.ended_at) : null,
        isPrimary: Number(row.is_primary ?? 0) === 1,
        memo: row.relation_memo != null ? String(row.relation_memo) : null,
        createdAt: String(row.relation_created_at ?? ""),
        updatedAt: String(row.relation_updated_at ?? ""),
      },
    };
  } catch {
    return null;
  }
}

async function loadGroupInfo(db: DbHandle, facilityId: string): Promise<FacilityGroupInfo | null> {
  try {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT
           m.id AS membership_id, m.facility_id, m.group_id, m.company_id, m.relation_type,
           m.started_at, m.ended_at, m.created_at AS membership_created_at, m.updated_at AS membership_updated_at,
           g.group_name, g.logo_path AS group_logo_path, g.total_revenue, g.employee_count,
           g.description AS group_description, g.created_at AS group_created_at, g.updated_at AS group_updated_at,
           c.division_id, c.company_name, c.business_registration_no, c.address, c.phone_number, c.group_role,
           c.logo_path AS company_logo_path, c.is_headquarters,
           c.created_at AS company_created_at, c.updated_at AS company_updated_at,
           d.division_name, d.sort_order, d.created_at AS division_created_at, d.updated_at AS division_updated_at
         FROM facility_group_memberships m
         JOIN facility_groups g ON g.group_id = m.group_id
         JOIN facility_group_companies c ON c.company_id = m.company_id
         LEFT JOIN facility_group_divisions d ON d.division_id = c.division_id
         WHERE m.facility_id = $1
         LIMIT 1`,
        [facilityId]
      )
    );
    const row = rows[0];
    if (!row) return null;
    return {
      group: {
        groupId: String(row.group_id ?? ""),
        groupName: String(row.group_name ?? ""),
        logoPath: row.group_logo_path != null ? String(row.group_logo_path) : null,
        totalRevenue: finiteNumber(row.total_revenue),
        employeeCount: row.employee_count != null ? Number(row.employee_count) : null,
        description: row.group_description != null ? String(row.group_description) : null,
        createdAt: String(row.group_created_at ?? ""),
        updatedAt: String(row.group_updated_at ?? ""),
      },
      division: row.division_id
        ? {
            divisionId: String(row.division_id),
            groupId: String(row.group_id ?? ""),
            divisionName: String(row.division_name ?? ""),
            sortOrder: Number(row.sort_order ?? 0),
            createdAt: String(row.division_created_at ?? ""),
            updatedAt: String(row.division_updated_at ?? ""),
          }
        : null,
      company: {
        companyId: String(row.company_id ?? ""),
        groupId: String(row.group_id ?? ""),
        divisionId: row.division_id != null ? String(row.division_id) : null,
        companyName: String(row.company_name ?? ""),
        businessRegistrationNo:
          row.business_registration_no != null ? formatBusinessRegistrationNo(String(row.business_registration_no)) : null,
        address: row.address != null ? formatAddress(String(row.address)) : null,
        phoneNumber: row.phone_number != null ? String(row.phone_number) : null,
        logoPath: row.company_logo_path != null ? String(row.company_logo_path) : null,
        groupRole: normalizeCompanyRole(row),
        isHeadquarters: Number(row.is_headquarters ?? 0) === 1,
        createdAt: String(row.company_created_at ?? ""),
        updatedAt: String(row.company_updated_at ?? ""),
      },
      membership: {
        id: Number(row.membership_id ?? 0),
        facilityId: String(row.facility_id ?? ""),
        groupId: String(row.group_id ?? ""),
        companyId: String(row.company_id ?? ""),
        relationType: normalizeMembershipRelationType(row.relation_type),
        startedAt: row.started_at != null ? String(row.started_at) : null,
        endedAt: row.ended_at != null ? String(row.ended_at) : null,
        createdAt: String(row.membership_created_at ?? ""),
        updatedAt: String(row.membership_updated_at ?? ""),
      },
    };
  } catch {
    return null;
  }
}

export async function getKpiSummary(): Promise<KpiSummary> {
  // PostgreSQL 풀은 connection 단위 캐시이므로 invalidateDb 는 no-op이지만 호환을 위해 유지.
  invalidateDb();
  const db = await getDb();

  const num = async (sql: string, params: unknown[] = []): Promise<number> => {
    try {
      const r = await db.exec(sql, params);
      return r.length ? Number(r[0].values[0][0]) : 0;
    } catch {
      return 0;
    }
  };

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return {
    totalFacilities: await num("SELECT COUNT(*) FROM facilities"),
    recentFacilities24h: await num("SELECT COUNT(*) FROM facilities WHERE created_at >= $1", [yesterday]),
    downloadedPdfs: await num(
      "SELECT COUNT(*) FROM attachments WHERE status = 'downloaded' AND LOWER(file_type) = 'pdf'"
    ),
    parsedDocs: await num("SELECT COUNT(DISTINCT attachment_id) FROM parsed_fields"),
    needsReview: await num("SELECT COUNT(*) FROM parsed_fields WHERE needs_review = 1 AND reviewed_value IS NULL"),
    playwrightFallbacks: await num(
      "SELECT COUNT(*) FROM attachments WHERE download_method = 'playwright' AND status = 'downloaded'"
    ),
    failedDownloads: await num("SELECT COUNT(*) FROM attachments WHERE status = 'failed'"),
  };
}

export interface RecentFacility {
  facilityId: string;
  companyName: string;
  siteAddress: string | null;
  industryCode: string | null;
  industryName: string | null;
  decisionNo: string | null;
  permitDate: string | null;
  airClass: number | null;
  waterClass: number | null;
  createdAt: string;
}

export async function getRecentFacilities(limit = 10): Promise<RecentFacility[]> {
  invalidateDb();
  const db = await getDb();

  // facilities ⨝ permits(latest, optional) ⨝ permit_scales(latest, optional)
  // 종 규모(air_class/water_class) 는 permit_scales 우선, 없으면 facility_annual_reports
  // (연간보고서 스냅샷) 로 폴백한다 — 검토결과서가 없는 사업장도 종 규모를 노출하기 위해.
  let result;
  try {
    result = await db.exec(
      `
      SELECT
        f.facility_id        AS facility_id,
        f.company_name       AS company_name,
        f.site_address       AS site_address,
        f.industry_code      AS industry_code,
        f.industry_name      AS industry_name,
        f.created_at         AS created_at,
        p.decision_no        AS decision_no,
        p.permit_date        AS permit_date,
        COALESCE(ps.air_class, far.air_class)     AS air_class,
        COALESCE(ps.water_class, far.water_class) AS water_class
      FROM facilities f
      LEFT JOIN permits p
        ON p.permit_id = (
          SELECT permit_id FROM permits
          WHERE facility_id = f.facility_id
          ORDER BY COALESCE(permit_date, updated_at) DESC
          LIMIT 1
        )
      LEFT JOIN permit_scales ps
        ON ps.permit_id = p.permit_id
      LEFT JOIN facility_annual_reports far
        ON far.facility_id = f.facility_id
      ORDER BY f.created_at DESC
      LIMIT $1
      `,
      [limit]
    );
  } catch {
    return [];
  }

  const rows = rowsToObjects(result);
  return rows.map((row) => ({
    facilityId: String(row.facility_id ?? ""),
    companyName: formatCompanyName(String(row.company_name ?? "")) ?? "",
    siteAddress: row.site_address ? String(row.site_address) : null,
    industryCode: row.industry_code ? String(row.industry_code) : null,
    industryName: row.industry_name ? String(row.industry_name) : null,
    decisionNo: row.decision_no ? String(row.decision_no) : null,
    permitDate: row.permit_date ? String(row.permit_date) : null,
    airClass: row.air_class != null ? Number(row.air_class) : null,
    waterClass: row.water_class != null ? Number(row.water_class) : null,
    createdAt: String(row.created_at ?? ""),
  }));
}

export interface ReviewQueueRow {
  id: number;
  attachmentId: string;
  docId: string | null;
  ruleId: string;
  fieldLabel: string;
  rawValue: string | null;
  normalizedValue: string | null;
  sourcePage: number | null;
  sourceText: string | null;
  confidence: number;
  needsReview: number;
  reviewedValue: string | null;
  /** 백엔드 ParsedField.error — "값을 찾지 못함" 등 실패 사유 메시지. */
  error: string | null;
  createdAt: string;
  facilityName: string | null;
  attachmentFileName: string | null;
}

export async function getReviewQueue(options: {
  limit?: number;
  offset?: number;
  includeReviewed?: boolean;
}): Promise<{ items: ReviewQueueRow[]; total: number }> {
  const { limit = 100, offset = 0, includeReviewed = false } = options;
  invalidateDb();
  const db = await getDb();

  const where = includeReviewed ? "" : "WHERE pf.needs_review = 1 AND pf.reviewed_value IS NULL";

  let countResult;
  try {
    countResult = await db.exec(`SELECT COUNT(*) FROM parsed_fields pf ${where}`);
  } catch {
    return { items: [], total: 0 };
  }
  const total = countResult.length ? Number(countResult[0].values[0][0]) : 0;

  let listResult;
  try {
    // parsed_fields.file_name 우선, 없으면 attachments JOIN 폴백 (식별자 불일치 우회).
    listResult = await db.exec(
      `
      SELECT
        pf.id              AS id,
        pf.attachment_id   AS attachment_id,
        pf.doc_id          AS doc_id,
        pf.rule_id         AS rule_id,
        pf.field_label     AS field_label,
        pf.raw_value       AS raw_value,
        pf.normalized_value AS normalized_value,
        pf.source_page     AS source_page,
        pf.source_text     AS source_text,
        pf.confidence      AS confidence,
        pf.needs_review    AS needs_review,
        pf.reviewed_value  AS reviewed_value,
        pf.error           AS error,
        pf.created_at      AS created_at,
        COALESCE(pf.file_name, a.file_name) AS attachment_file_name,
        (
          SELECT f.company_name FROM permits p
          JOIN facilities f ON f.facility_id = p.facility_id
          WHERE p.source_attachment_id = pf.attachment_id
          LIMIT 1
        ) AS facility_name
      FROM parsed_fields pf
      LEFT JOIN attachments a ON a.file_id = pf.attachment_id
      ${where}
      ORDER BY pf.created_at DESC, pf.id DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );
  } catch {
    return { items: [], total: 0 };
  }

  const items = rowsToObjects(listResult).map((row) => ({
    id: Number(row.id),
    attachmentId: String(row.attachment_id ?? ""),
    docId: row.doc_id ? String(row.doc_id) : null,
    ruleId: String(row.rule_id ?? ""),
    fieldLabel: String(row.field_label ?? ""),
    rawValue: row.raw_value != null ? String(row.raw_value) : null,
    normalizedValue: row.normalized_value != null ? String(row.normalized_value) : null,
    sourcePage: row.source_page != null ? Number(row.source_page) : null,
    sourceText: row.source_text != null ? String(row.source_text) : null,
    confidence: row.confidence != null ? Number(row.confidence) : 0,
    needsReview: row.needs_review != null ? Number(row.needs_review) : 0,
    reviewedValue: row.reviewed_value != null ? String(row.reviewed_value) : null,
    error: row.error != null ? String(row.error) : null,
    createdAt: String(row.created_at ?? ""),
    facilityName: row.facility_name != null ? String(row.facility_name) : null,
    attachmentFileName: row.attachment_file_name != null ? String(row.attachment_file_name) : null,
  }));

  return { items, total };
}

// ---------------------------------------------------------------------------
// 검수 대기열 진단 익스포트 — "왜 파싱 실패했나"를 빠르게 분석하기 위한
// 파일 단위 JSON 묶음. 동일 PDF 의 모든 미검수 필드 + extracted JSON 경로 + PDF 경로를
// 한 번에 노출하여, 사용자가 다운로드 받아 패턴(어떤 필드가 어떤 페이지에서 왜 실패하는지)을
// 한 번에 훑어볼 수 있도록 한다.
// ---------------------------------------------------------------------------

export interface DiagnosticAttachmentGroup {
  attachmentId: string;
  docId: string | null;
  fileName: string | null;
  /** raw PDF 의 cli-collect 측 절대 경로(attachments.local_path). */
  pdfPath: string | null;
  /** parse 결과 JSON(data/ieps/extracted/<year>/<postId>/<file>.json) 경로. */
  extractedJsonPath: string | null;
  facilityName: string | null;
  fields: ReviewQueueRow[];
  failedRuleIds: string[];
  needsReviewCount: number;
}

export interface DiagnosticReport {
  generatedAt: string;
  scope: {
    includeReviewed: boolean;
    limitAttachments: number;
  };
  totals: {
    attachments: number;
    parsedFields: number;
    needsReview: number;
  };
  /** rule_id 별 실패 빈도 (가장 자주 실패하는 항목부터). */
  failureByRule: { ruleId: string; fieldLabel: string; count: number }[];
  /** 첨부 파일 단위로 묶인 진단 데이터. */
  attachments: DiagnosticAttachmentGroup[];
}

/**
 * 검수 대기열의 실패 항목들을 첨부 단위로 묶어 진단 JSON 형식으로 반환한다.
 *
 * - includeReviewed=false (기본): 미검수 needs_review=1 행만 대상.
 * - limitAttachments: 첨부 파일 수 상한 (기본 200, 너무 큰 export 방지).
 */
export async function getReviewDiagnosticReport(args: {
  includeReviewed?: boolean;
  limitAttachments?: number;
}): Promise<DiagnosticReport> {
  const includeReviewed = !!args.includeReviewed;
  const limitAttachments = Math.min(Math.max(args.limitAttachments ?? 200, 1), 1000);

  invalidateDb();
  const db = await getDb();

  const where = includeReviewed ? "" : "WHERE pf.needs_review = 1 AND pf.reviewed_value IS NULL";

  // 1차: 진단 대상 attachment_id 의 distinct 목록 (실패가 있는 것만).
  let attRowsRes;
  try {
    attRowsRes = await db.exec(
      `SELECT pf.attachment_id, MAX(pf.created_at) AS last_created
         FROM parsed_fields pf
         ${where}
         GROUP BY pf.attachment_id
         ORDER BY last_created DESC, pf.attachment_id ASC
         LIMIT $1`,
      [limitAttachments]
    );
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      scope: { includeReviewed, limitAttachments },
      totals: { attachments: 0, parsedFields: 0, needsReview: 0 },
      failureByRule: [],
      attachments: [],
    };
  }
  const attachmentIds = (attRowsRes[0]?.values ?? []).map((r) => String(r[0]));
  if (attachmentIds.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      scope: { includeReviewed, limitAttachments },
      totals: { attachments: 0, parsedFields: 0, needsReview: 0 },
      failureByRule: [],
      attachments: [],
    };
  }

  // 2차: 첨부 단위 메타 (file_name, doc_id, local_path) — IEPS cli-collect 가
  // attachments.local_path 에 raw PDF 의 절대 경로를 저장해 둔다.
  const placeholders = attachmentIds.map((_, i) => `$${i + 1}`).join(",");
  let metaRes: Awaited<ReturnType<typeof db.exec>>;
  try {
    metaRes = await db.exec(
      `SELECT a.file_id, a.doc_id, a.file_name, a.local_path,
              (SELECT f.company_name FROM permits p
                 JOIN facilities f ON f.facility_id = p.facility_id
                WHERE p.source_attachment_id = a.file_id LIMIT 1) AS facility_name
         FROM attachments a
        WHERE a.file_id IN (${placeholders})`,
      attachmentIds
    );
  } catch {
    metaRes = [];
  }
  const metaByAtt = new Map<
    string,
    {
      docId: string | null;
      fileName: string | null;
      filePath: string | null;
      facilityName: string | null;
    }
  >();
  for (const row of rowsToObjects(metaRes)) {
    metaByAtt.set(String(row.file_id), {
      docId: row.doc_id != null ? String(row.doc_id) : null,
      fileName: row.file_name != null ? String(row.file_name) : null,
      filePath: row.local_path != null ? String(row.local_path) : null,
      facilityName: row.facility_name != null ? String(row.facility_name) : null,
    });
  }

  // 3차: 첨부의 모든 parsed_fields (실패만이 아닌 전체 — 컨텍스트 진단 목적).
  // pf.file_name / pf.pdf_path 가 새로 들어왔으므로 함께 가져와, 식별자 불일치로
  // attachments 메타가 비어 있는 첨부도 파일명/경로를 즉시 노출한다.
  let allFieldsRes: Awaited<ReturnType<typeof db.exec>>;
  try {
    allFieldsRes = await db.exec(
      `SELECT pf.id, pf.attachment_id, pf.doc_id, pf.rule_id, pf.field_label,
              pf.raw_value, pf.normalized_value, pf.source_page, pf.source_text,
              pf.confidence, pf.needs_review, pf.reviewed_value, pf.error, pf.created_at,
              pf.file_name, pf.pdf_path
         FROM parsed_fields pf
        WHERE pf.attachment_id IN (${placeholders})
        ORDER BY pf.attachment_id ASC, pf.id ASC`,
      attachmentIds
    );
  } catch {
    allFieldsRes = [];
  }
  const fieldsByAtt = new Map<string, ReviewQueueRow[]>();
  // parsed_fields 에서 직접 들어온 파일명/경로를 첨부 단위 메타로 보강 (attachments 폴백).
  const pfMetaByAtt = new Map<string, { fileName: string | null; pdfPath: string | null }>();
  for (const row of rowsToObjects(allFieldsRes)) {
    const att = String(row.attachment_id);
    const meta = metaByAtt.get(att);
    const pfFileName = row.file_name != null ? String(row.file_name) : null;
    const pfPdfPath = row.pdf_path != null ? String(row.pdf_path) : null;
    if (pfFileName || pfPdfPath) {
      const cur = pfMetaByAtt.get(att) ?? { fileName: null, pdfPath: null };
      pfMetaByAtt.set(att, {
        fileName: cur.fileName ?? pfFileName,
        pdfPath: cur.pdfPath ?? pfPdfPath,
      });
    }
    const item: ReviewQueueRow = {
      id: Number(row.id),
      attachmentId: att,
      docId: row.doc_id != null ? String(row.doc_id) : null,
      ruleId: String(row.rule_id ?? ""),
      fieldLabel: String(row.field_label ?? ""),
      rawValue: row.raw_value != null ? String(row.raw_value) : null,
      normalizedValue: row.normalized_value != null ? String(row.normalized_value) : null,
      sourcePage: row.source_page != null ? Number(row.source_page) : null,
      sourceText: row.source_text != null ? String(row.source_text) : null,
      confidence: row.confidence != null ? Number(row.confidence) : 0,
      needsReview: row.needs_review != null ? Number(row.needs_review) : 0,
      reviewedValue: row.reviewed_value != null ? String(row.reviewed_value) : null,
      error: row.error != null ? String(row.error) : null,
      createdAt: String(row.created_at ?? ""),
      facilityName: meta?.facilityName ?? null,
      attachmentFileName: pfFileName ?? meta?.fileName ?? null,
    };
    const arr = fieldsByAtt.get(att) ?? [];
    arr.push(item);
    fieldsByAtt.set(att, arr);
  }

  // extracted JSON 경로 추정 — cli-collect/saveParsedJson 규칙과 동일하게
  // data/ieps/extracted/<yearFolder>/<postId>/<basename>.json
  // raw 경로에서 'raw' → 'extracted', '.pdf' → '.json' 으로 치환해 안전하게 도출.
  const toExtractedJson = (filePath: string | null): string | null => {
    if (!filePath) return null;
    return filePath
      .replace(/[\\\/]raw[\\\/]/i, (m) => m.replace(/raw/i, "extracted"))
      .replace(/\.pdf$/i, ".json");
  };

  const groups: DiagnosticAttachmentGroup[] = [];
  const failureCounter = new Map<string, { fieldLabel: string; count: number }>();
  let totalParsedFields = 0;
  let totalNeedsReview = 0;

  for (const att of attachmentIds) {
    const meta = metaByAtt.get(att);
    const pfMeta = pfMetaByAtt.get(att);
    const fields = fieldsByAtt.get(att) ?? [];
    totalParsedFields += fields.length;
    const failedRuleIds: string[] = [];
    for (const f of fields) {
      if (f.needsReview && !f.reviewedValue) {
        totalNeedsReview += 1;
        failedRuleIds.push(f.ruleId);
        const key = f.ruleId;
        const cur = failureCounter.get(key) ?? { fieldLabel: f.fieldLabel, count: 0 };
        cur.count += 1;
        failureCounter.set(key, cur);
      }
    }
    // parsed_fields.file_name/pdf_path 우선, 없으면 attachments 폴백.
    const effectiveFileName = pfMeta?.fileName ?? meta?.fileName ?? null;
    const effectivePdfPath = pfMeta?.pdfPath ?? meta?.filePath ?? null;
    groups.push({
      attachmentId: att,
      docId: meta?.docId ?? null,
      fileName: effectiveFileName,
      pdfPath: effectivePdfPath,
      extractedJsonPath: toExtractedJson(effectivePdfPath),
      facilityName: meta?.facilityName ?? null,
      fields,
      failedRuleIds,
      needsReviewCount: failedRuleIds.length,
    });
  }

  const failureByRule = Array.from(failureCounter.entries())
    .map(([ruleId, v]) => ({ ruleId, fieldLabel: v.fieldLabel, count: v.count }))
    .sort((a, b) => b.count - a.count);

  return {
    generatedAt: new Date().toISOString(),
    scope: { includeReviewed, limitAttachments },
    totals: {
      attachments: attachmentIds.length,
      parsedFields: totalParsedFields,
      needsReview: totalNeedsReview,
    },
    failureByRule,
    attachments: groups,
  };
}

export interface CollectionConfigRow {
  id: number;
  name: string;
  configJson: string;
  isDefault: number;
  createdAt: string;
  updatedAt: string;
}

export async function listCollectionConfigs(): Promise<CollectionConfigRow[]> {
  invalidateDb();
  const db = await getDb();
  let result;
  try {
    result = await db.exec(
      "SELECT id, name, config_json, is_default, created_at, updated_at FROM collection_configs ORDER BY is_default DESC, updated_at DESC"
    );
  } catch {
    return [];
  }
  return rowsToObjects(result).map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ""),
    // config_json 은 jsonb. node-postgres 가 객체로 자동 디시리얼라이즈하므로 직렬화해서 노출.
    configJson: row.config_json != null ? JSON.stringify(row.config_json) : "{}",
    isDefault: Number(row.is_default ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  }));
}

// ============================================================
// 사업장 마스터 — 검색 / 상세 / 필터 옵션
// ============================================================

export interface FacilityListItem {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  representativeName: string | null;
  phoneNumber: string | null;
  siteAddress: string | null;
  regionSido: string | null;
  regionSigungu: string | null;
  industryCode: string | null;
  industryName: string | null;
  integratedPermitTarget: string | null;
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

export interface FacilityListFilter {
  q?: string;
  integratedPermitTarget?: boolean;
  sido?: string;
  /** 복수 지역 검색. 지정 시 sido/sigungu 단일 필터보다 우선한다. */
  sidos?: string[];
  sigungu?: string;
  industryCode?: string;
  /** 통합허가 20개 업종 카테고리 id. 지정 시 industryCode 보다 우선한다. */
  industryCategory?: string;
  airClass?: number;
  waterClass?: number;
  source?: string;
  /** 누락 항목 필터. 지정된 항목 중 하나라도 비어 있는 사업장만 포함(OR). */
  missing?: FacilityMissingField[];
  limit?: number;
  offset?: number;
  sort?: "recent" | "name";
}

export type FacilityMissingField = "brn" | "representative" | "phone" | "address" | "industry";

// 누락 판정 SQL. 사업자번호는 리스트 표시와 동일하게 site_business_registration_no 폴백까지
// 모두 비어 있을 때만 누락으로 본다. 값은 코드 내 상수에서만 오므로 리터럴 삽입이 안전하다.
const FACILITY_MISSING_CONDS: Record<FacilityMissingField, string> = {
  brn: "(NULLIF(TRIM(COALESCE(f.business_registration_no, '')), '') IS NULL AND NULLIF(TRIM(COALESCE(f.site_business_registration_no, '')), '') IS NULL)",
  representative: "NULLIF(TRIM(COALESCE(f.representative_name, '')), '') IS NULL",
  phone: "NULLIF(TRIM(COALESCE(f.phone_number, '')), '') IS NULL",
  address: "NULLIF(TRIM(COALESCE(f.site_address, '')), '') IS NULL",
  industry:
    "(NULLIF(TRIM(COALESCE(f.industry_code, '')), '') IS NULL OR NULLIF(TRIM(COALESCE(f.industry_name, '')), '') IS NULL)",
};

export type FacilityMissingStats = Record<FacilityMissingField, number>;

/** 항목별 누락 사업장 수. 누락 점검 화면의 태그 버튼 배지에 사용한다. */
export async function getFacilityMissingStats(): Promise<FacilityMissingStats> {
  invalidateDb();
  const db = await getDb();
  const fields = Object.keys(FACILITY_MISSING_CONDS) as FacilityMissingField[];
  const selects = fields
    .map((k) => `COUNT(*) FILTER (WHERE ${FACILITY_MISSING_CONDS[k]}) AS ${k}`)
    .join(", ");
  const stats: FacilityMissingStats = { brn: 0, representative: 0, phone: 0, address: 0, industry: 0 };
  try {
    const r = await db.exec(`SELECT ${selects} FROM facilities f WHERE f.deleted_at IS NULL`);
    if (r.length && r[0].values.length) {
      r[0].columns.forEach((col, i) => {
        if (col in stats) stats[col as FacilityMissingField] = Number(r[0].values[0][i] ?? 0);
      });
    }
  } catch (err) {
    console.error("[getFacilityMissingStats] " + (err as Error).message);
  }
  return stats;
}

export async function listFacilities(
  filter: FacilityListFilter
): Promise<{ items: FacilityListItem[]; total: number }> {
  invalidateDb();
  const db = await getDb();
  const where: string[] = ["f.deleted_at IS NULL"];
  const params: unknown[] = [];

  if (filter.q && filter.q.trim()) {
    const qText = filter.q.trim();
    const q = "%" + qText + "%";
    const qDigitsOnly = qText.replace(/[^0-9]/g, "");
    const qDigits = qDigitsOnly ? "%" + qDigitsOnly + "%" : "__NO_BRN_MATCH__";
    const startIdx = params.length;
    params.push(q, q, q, q, q, qDigits, qDigits, q);
    where.push(
      `(f.company_name LIKE $${startIdx + 1} OR f.normalized_company_name LIKE $${startIdx + 2} OR f.site_address LIKE $${startIdx + 3} OR f.business_registration_no LIKE $${startIdx + 4} OR f.site_business_registration_no LIKE $${startIdx + 5} OR REPLACE(COALESCE(f.business_registration_no, ''), '-', '') LIKE $${startIdx + 6} OR REPLACE(COALESCE(f.site_business_registration_no, ''), '-', '') LIKE $${startIdx + 7} OR EXISTS (SELECT 1 FROM facility_aliases fa WHERE fa.facility_id = f.facility_id AND fa.alias LIKE $${startIdx + 8}))`
    );
  }
  const sidoList = (filter.sidos ?? []).map((s) => s.trim()).filter(Boolean);
  if (sidoList.length > 0) {
    const placeholders = sidoList.map((_, i) => `$${params.length + i + 1}`).join(", ");
    where.push(`f.region_sido IN (${placeholders})`);
    params.push(...sidoList);
  } else {
    if (filter.sido) {
      where.push(`f.region_sido = $${params.length + 1}`);
      params.push(filter.sido);
    }
    if (filter.sigungu) {
      where.push(`f.region_sigungu = $${params.length + 1}`);
      params.push(filter.sigungu);
    }
  }
  const industryCategory = filter.industryCategory
    ? findIntegratedPermitIndustry(filter.industryCategory)
    : null;
  if (industryCategory) {
    // industry_code 는 복수 업종이 줄바꿈/쉼표로 연결될 수 있어 코드 단위로 분해해 비교한다.
    // 코드 값은 코드 내 상수(INTEGRATED_PERMIT_INDUSTRIES)에서만 오므로 리터럴 삽입이 안전하다.
    const conds: string[] = [];
    for (const code of industryCategory.exactCodes) {
      conds.push(`TRIM(ic) = '${code}'`);
    }
    for (const prefix of industryCategory.prefixCodes) {
      conds.push(`TRIM(ic) LIKE '${prefix}%'`);
    }
    if (conds.length > 0) {
      where.push(
        `EXISTS (SELECT 1 FROM regexp_split_to_table(COALESCE(f.industry_code, ''), '[\\n,/]+') AS ic WHERE ${conds.join(" OR ")})`
      );
    }
  } else if (filter.industryCode) {
    where.push(`f.industry_code = $${params.length + 1}`);
    params.push(filter.industryCode);
  }
  if (filter.integratedPermitTarget) {
    where.push(
      `(COALESCE(NULLIF(f.integrated_permit_target, ''), '') <> '' OR EXISTS (SELECT 1 FROM permits pit WHERE pit.facility_id = f.facility_id))`
    );
  }
  if (filter.source) {
    // 그룹 관리 경유 등록(group_company)은 출처 필터에서 '수동 등록'(manual)에 합쳐 취급한다.
    if (filter.source === "manual") {
      where.push(`f.source IN ('manual', 'group_company')`);
    } else {
      where.push(`f.source = $${params.length + 1}`);
      params.push(filter.source);
    }
  }
  // air/water 종 규모 필터: permit_scales(검토결과서) OR facility_annual_reports(연간보고서)
  // 어느 쪽이라도 일치하면 포함. 사업장당 두 출처가 모두 있으면 OR 로 둘 다 후보가 된다.
  if (filter.airClass != null) {
    const startIdx = params.length;
    params.push(filter.airClass, filter.airClass);
    where.push(
      `(EXISTS (SELECT 1 FROM permits p2 JOIN permit_scales ps2 ON ps2.permit_id = p2.permit_id WHERE p2.facility_id = f.facility_id AND ps2.air_class = $${startIdx + 1})` +
        ` OR EXISTS (SELECT 1 FROM facility_annual_reports far2 WHERE far2.facility_id = f.facility_id AND far2.air_class = $${startIdx + 2}))`
    );
  }
  if (filter.waterClass != null) {
    const startIdx = params.length;
    params.push(filter.waterClass, filter.waterClass);
    where.push(
      `(EXISTS (SELECT 1 FROM permits p2 JOIN permit_scales ps2 ON ps2.permit_id = p2.permit_id WHERE p2.facility_id = f.facility_id AND ps2.water_class = $${startIdx + 1})` +
        ` OR EXISTS (SELECT 1 FROM facility_annual_reports far2 WHERE far2.facility_id = f.facility_id AND far2.water_class = $${startIdx + 2}))`
    );
  }
  const missingConds = (filter.missing ?? [])
    .map((k) => FACILITY_MISSING_CONDS[k])
    .filter(Boolean);
  if (missingConds.length > 0) {
    where.push("(" + missingConds.join(" OR ") + ")");
  }

  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  let total = 0;
  try {
    const r = await db.exec("SELECT COUNT(*) FROM facilities f " + whereSql, params);
    if (r.length) total = Number(r[0].values[0][0]);
  } catch {
    return { items: [], total: 0 };
  }

  const orderBy =
    filter.sort === "name"
      ? "ORDER BY f.normalized_company_name ASC"
      : "ORDER BY f.created_at DESC";
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;

  // ls(permit_scales) 우선, 없으면 far(facility_annual_reports) 의 종 규모를 노출.
  // air_amount / wastewater_amount 도 동일 폴백.
  // 대표 허가는 permit_date 가 있는 행을 우선한다. 변경허가/중복 적재 과정에서
  // 날짜가 비어 있는 최신 updated_at 행이 대표로 잡히면 지역 리스트 허가일자가 비어 보인다.
  const sql = `
    SELECT
      f.facility_id, f.company_name, f.business_registration_no, f.site_business_registration_no, f.site_address,
      f.representative_name, f.phone_number,
      f.region_sido, f.region_sigungu, f.industry_code, f.industry_name, f.integrated_permit_target,
      f.source, f.memo, f.logo_path, f.company_size, f.created_at, f.updated_at,
      lp.decision_no, lp.permit_date,
      EXISTS (
        SELECT 1
          FROM facility_history_events fhe
         WHERE fhe.facility_id = f.facility_id
           AND (fhe.event_type = 'closure' OR fhe.event_types LIKE '%"closure"%')
      ) AS is_closed,
      COALESCE(ls.air_class, far.air_class)         AS air_class,
      COALESCE(ls.water_class, far.water_class)     AS water_class,
      COALESCE(ls.air_amount_ton_per_year, far.air_amount_ton_per_year)             AS air_amount_ton_per_year,
      COALESCE(ls.wastewater_amount_m3_per_day, far.wastewater_amount_m3_per_day)   AS wastewater_amount_m3_per_day,
      (SELECT COUNT(*) FROM permits pc WHERE pc.facility_id = f.facility_id) AS permits_count
    FROM facilities f
    LEFT JOIN permits lp ON lp.permit_id = (
      SELECT permit_id FROM permits WHERE facility_id = f.facility_id
      ORDER BY CASE WHEN permit_date IS NULL OR permit_date = '' THEN 1 ELSE 0 END,
               permit_date DESC,
               updated_at DESC
      LIMIT 1
    )
    LEFT JOIN permit_scales ls ON ls.permit_id = lp.permit_id
    LEFT JOIN facility_annual_reports far ON far.facility_id = f.facility_id
    ${whereSql}
    ${orderBy}
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  let result;
  try {
    result = await db.exec(sql, [...params, limit, offset]);
  } catch (err) {
    console.error("[listFacilities] " + (err as Error).message);
    return { items: [], total };
  }

  const rows = rowsToObjects(result);
  const facilityIds = rows.map((row) => String(row.facility_id ?? "")).filter(Boolean);
  const aliasesByFacility = await loadAliasesByFacility(db, facilityIds);
  const servicesByFacility = await loadServiceCategoriesByFacility(db, facilityIds);
  const items = rows.map((row) => ({
    facilityId: String(row.facility_id ?? ""),
    companyName: formatCompanyName(String(row.company_name ?? "")) ?? "",
    businessRegistrationNo:
      row.business_registration_no != null || row.site_business_registration_no != null
        ? formatBusinessRegistrationNo(String(row.business_registration_no ?? row.site_business_registration_no))
        : null,
    siteAddress: row.site_address != null ? formatAddress(String(row.site_address)) : null,
    representativeName: row.representative_name != null ? String(row.representative_name) : null,
    phoneNumber: row.phone_number != null ? String(row.phone_number) : null,
    regionSido: row.region_sido != null ? String(row.region_sido) : null,
    regionSigungu: row.region_sigungu != null ? String(row.region_sigungu) : null,
    industryCode: row.industry_code != null ? String(row.industry_code) : null,
    industryName: row.industry_name != null ? String(row.industry_name) : null,
    integratedPermitTarget: row.integrated_permit_target != null ? String(row.integrated_permit_target) : null,
    source: row.source != null ? String(row.source) : "ieps",
    memo: row.memo != null ? String(row.memo) : null,
    logoPath: row.logo_path != null ? String(row.logo_path) : null,
    aliases: aliasesByFacility.get(String(row.facility_id ?? "")) ?? [],
    serviceCategories: servicesByFacility.get(String(row.facility_id ?? "")) ?? [],
    companySize: normalizeFacilityCompanySize(row.company_size),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    decisionNo: row.decision_no != null ? String(row.decision_no) : null,
    permitDate: row.permit_date != null ? String(row.permit_date) : null,
    isClosed: row.is_closed === true || row.is_closed === "true" || Number(row.is_closed ?? 0) === 1,
    airClass: row.air_class != null ? Number(row.air_class) : null,
    waterClass: row.water_class != null ? Number(row.water_class) : null,
    airAmount:
      row.air_amount_ton_per_year != null ? Number(row.air_amount_ton_per_year) : null,
    waterAmount:
      row.wastewater_amount_m3_per_day != null
        ? Number(row.wastewater_amount_m3_per_day)
        : null,
    permitsCount: Number(row.permits_count ?? 0),
  }));
  return { items, total };
}

export interface FacilityFilterOptions {
  sidos: { value: string; count: number }[];
  sigungus: { value: string; sido: string | null; count: number }[];
  industries: { code: string; name: string | null; count: number }[];
  sources: { value: string; count: number }[];
}

export async function getFacilityFilterOptions(): Promise<FacilityFilterOptions> {
  invalidateDb();
  const db = await getDb();
  const safe = async (sql: string): Promise<{ columns: string[]; values: unknown[][] } | null> => {
    try {
      const r = await db.exec(sql);
      return r.length ? r[0] : null;
    } catch {
      return null;
    }
  };
  const sidoR = await safe(
    "SELECT region_sido, COUNT(*) FROM facilities WHERE deleted_at IS NULL AND region_sido IS NOT NULL GROUP BY region_sido ORDER BY 2 DESC"
  );
  const sigunguR = await safe(
    "SELECT region_sigungu, region_sido, COUNT(*) FROM facilities WHERE deleted_at IS NULL AND region_sigungu IS NOT NULL GROUP BY region_sigungu, region_sido ORDER BY 3 DESC"
  );
  // industry_code 단일 키로 묶고 industry_name 은 대표값 1개(MIN)만 채택.
  // 동일 코드에 표기 변형(공백·괄호 차이)이 섞여 있으면 React key 가 코드만으로 구성될 때
  // duplicate key 경고가 발생하므로 DB 레벨에서 코드 단일화로 해결한다.
  const industryR = await safe(
    "SELECT industry_code, MIN(industry_name) AS industry_name, COUNT(*) FROM facilities WHERE deleted_at IS NULL AND industry_code IS NOT NULL GROUP BY industry_code ORDER BY 3 DESC"
  );
  const sourceR = await safe(
    "SELECT source, COUNT(*) FROM facilities WHERE deleted_at IS NULL GROUP BY source ORDER BY 2 DESC"
  );

  return {
    sidos: (sidoR?.values ?? []).map((r) => ({
      value: String(r[0]),
      count: Number(r[1]),
    })),
    sigungus: (sigunguR?.values ?? []).map((r) => ({
      value: String(r[0]),
      sido: r[1] != null ? String(r[1]) : null,
      count: Number(r[2]),
    })),
    industries: (industryR?.values ?? []).map((r) => ({
      code: String(r[0]),
      name: r[1] != null ? String(r[1]) : null,
      count: Number(r[2]),
    })),
    sources: mergeSourceOptions(sourceR?.values ?? []),
  };
}

/** group_company 출처는 '수동 등록'(manual)으로 합산해 노출한다. */
function mergeSourceOptions(rows: unknown[][]): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    let value = String(r[0] ?? "ieps");
    if (value === "group_company") value = "manual";
    counts.set(value, (counts.get(value) ?? 0) + Number(r[1]));
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

export interface FacilityDetail {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  siteAddress: string | null;
  additionalSiteAddresses: string[];
  phoneNumber: string | null;
  industryCode: string | null;
  industryName: string | null;
  businessCertificateBusinessType: string | null;
  businessCertificateBusinessItem: string | null;
  businessCertificateCorporateRegistrationNo: string | null;
  industries: IndustryDisplay[];
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
  /**
   * 연간(점검)보고서 스냅샷. 사업장당 가장 최근 1건. 검토결과서가 미공개인 사업장의
   * 차선책 데이터 출처. 검토결과서가 공개된 사업장도 보강 데이터로 함께 노출.
   */
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

export interface ProductOutput {
  productName: string | null;
  productionAmount: number | null;
  productionUnit: string | null;
  sourcePage: number | null;
  sourceText: string | null;
}

function isTruthyFlag(value: unknown): boolean {
  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    value === "t" ||
    value === "true"
  );
}

function parseAdditionalSiteAddresses(raw: unknown): string[] {
  if (raw == null) return [];
  const text = String(raw).trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 과거 데이터가 단일 문자열로 저장된 경우를 대비한 안전망.
    // 추가 소재지는 사용자 입력값이므로 시군구동 구분 로직을 적용하지 않는다.
    const single = text.replace(/\s+/g, " ").trim();
    return single ? [single] : [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => (item != null ? String(item).replace(/\s+/g, " ").trim() : ""))
    .filter((addr) => !!addr);
}

export async function getFacilityDetail(facilityId: string): Promise<FacilityDetail | null> {
  invalidateDb();
  const db = await getDb();
  let facRow;
  try {
    facRow = await db.exec(
      `SELECT facility_id, company_name, business_registration_no, representative_name, site_address, site_address_verbatim, additional_site_addresses, phone_number,
              industry_code, industry_name,
              business_certificate_business_type, business_certificate_business_item,
              business_certificate_corporate_registration_no,
              region_sido, region_sigungu, source, memo, logo_path, company_size, created_at, updated_at
         FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL`,
      [facilityId]
    );
  } catch {
    return null;
  }
  const facRows = rowsToObjects(facRow);
  if (!facRows.length) return null;
  const f = facRows[0];

  const isClosed = rowsToObjects(
    await db.exec(
      `SELECT EXISTS (
         SELECT 1
           FROM facility_history_events
          WHERE facility_id = $1
            AND (event_type = 'closure' OR event_types LIKE '%"closure"%')
       ) AS is_closed`,
      [facilityId]
    ).catch(() => [])
  )[0]?.is_closed;

  let permitRows: Awaited<ReturnType<typeof db.exec>>;
  try {
    permitRows = await db.exec(
      `SELECT
         p.permit_id, p.decision_no, p.permit_type, p.permit_date, p.is_first_permit,
         p.source_doc_id, p.source_attachment_id,
         a.file_name AS attachment_file_name,
         ps.air_class, ps.air_amount_ton_per_year,
         ps.water_class, ps.wastewater_amount_m3_per_day,
         ps.source_page AS scale_source_page, ps.source_text AS scale_source_text
       FROM permits p
       LEFT JOIN attachments a ON a.file_id = p.source_attachment_id
       LEFT JOIN permit_scales ps ON ps.permit_id = p.permit_id
       WHERE p.facility_id = $1
       ORDER BY COALESCE(p.permit_date, p.updated_at) DESC`,
      [facilityId]
    );
  } catch {
    permitRows = [];
  }
  const permits: PermitDetail[] = [];
  for (const row of rowsToObjects(permitRows)) {
    const permitId = String(row.permit_id ?? "");
    let prodRows: Awaited<ReturnType<typeof db.exec>>;
    try {
      prodRows = await db.exec(
        "SELECT product_name, production_amount, production_unit, source_page, source_text FROM product_outputs WHERE permit_id = $1",
        [permitId]
      );
    } catch {
      prodRows = [];
    }
    const products = rowsToObjects(prodRows).map((p) => ({
      productName: p.product_name != null ? cleanProductName(String(p.product_name)) : null,
      productionAmount: finiteNumber(p.production_amount),
      productionUnit: p.production_unit != null ? String(p.production_unit) : null,
      sourcePage: p.source_page != null ? Number(p.source_page) : null,
      sourceText: p.source_text != null ? String(p.source_text) : null,
    }));
    permits.push({
      permitId,
      decisionNo: row.decision_no != null ? String(row.decision_no) : null,
      permitType: row.permit_type != null ? String(row.permit_type) : null,
      permitDate: row.permit_date != null ? String(row.permit_date) : null,
      isFirstPermit: row.is_first_permit != null ? Number(row.is_first_permit) : 0,
      sourceDocId: row.source_doc_id != null ? String(row.source_doc_id) : null,
      sourceAttachmentId:
        row.source_attachment_id != null ? String(row.source_attachment_id) : null,
      attachmentFileName:
        row.attachment_file_name != null ? String(row.attachment_file_name) : null,
      airClass: row.air_class != null ? Number(row.air_class) : null,
      airAmount:
        row.air_amount_ton_per_year != null ? Number(row.air_amount_ton_per_year) : null,
      waterClass: row.water_class != null ? Number(row.water_class) : null,
      waterAmount:
        row.wastewater_amount_m3_per_day != null
          ? Number(row.wastewater_amount_m3_per_day)
          : null,
      scaleSourcePage:
        row.scale_source_page != null ? Number(row.scale_source_page) : null,
      scaleSourceText:
        row.scale_source_text != null ? String(row.scale_source_text) : null,
      products,
    });
  }

  const businessCertificates = rowsToObjects(
    await db.exec(
      `SELECT c.*, u.name AS created_by_name, u.email AS created_by_email
         FROM facility_business_certificates c
         LEFT JOIN users u ON u.user_id = c.created_by
        WHERE c.facility_id = $1
        ORDER BY c.version_no DESC, c.created_at DESC`,
      [facilityId]
    ).catch(() => [])
  ).map((row) => ({
    certificateId: String(row.certificate_id ?? ""),
    versionNo: Number(row.version_no ?? 0),
    isCurrent: Number(row.is_current ?? 0) === 1,
    displayName: String(row.display_name ?? ""),
    originalFilename: row.original_filename != null ? String(row.original_filename) : null,
    publicPath: row.public_path != null ? String(row.public_path) : null,
    businessType: row.business_type != null ? String(row.business_type) : null,
    businessItem: row.business_item != null ? String(row.business_item) : null,
    corporateRegistrationNo: row.corporate_registration_no != null ? String(row.corporate_registration_no) : null,
    memo: row.memo != null ? String(row.memo) : null,
    createdByName: row.created_by_name != null ? String(row.created_by_name) : null,
    createdByEmail: row.created_by_email != null ? String(row.created_by_email) : null,
    createdAt: String(row.created_at ?? ""),
  }));

  // facility_annual_reports — 사업장당 1행 (연간보고서 최신 스냅샷). 미존재 시 null.
  let annualReport: AnnualReportSnapshot | null = null;
  try {
    const arRows = await db.exec(
      `SELECT report_year, air_class, air_amount_ton_per_year, water_class,
              wastewater_amount_m3_per_day, product_outputs_json,
              source_attachment_id, source_pdf_path, parsed_at
         FROM facility_annual_reports WHERE facility_id = $1 LIMIT 1`,
      [facilityId]
    );
    if (arRows.length && arRows[0].values.length) {
      const r = arRows[0].values[0];
      let products: AnnualReportSnapshot["products"] = [];
      // product_outputs_json 은 jsonb. node-postgres 가 객체 / 배열로 자동 디시리얼라이즈한다.
      // 손상된 jsonb 행은 빈 배열로 폴백 — 사업장 상세 자체는 계속 노출되도록.
      const arr = Array.isArray(r[5]) ? (r[5] as unknown[]) : null;
      if (arr) {
        products = arr.map((it: any) => ({
          productName: cleanProductName(it?.product_name ?? null),
          amount: finiteNumber(it?.amount),
          unit: it?.unit ?? null,
        }));
      }
      annualReport = {
        reportYear: r[0] == null ? null : Number(r[0]),
        airClass: r[1] == null ? null : Number(r[1]),
        airAmountTonPerYear: r[2] == null ? null : Number(r[2]),
        waterClass: r[3] == null ? null : Number(r[3]),
        wastewaterM3PerDay: r[4] == null ? null : Number(r[4]),
        products,
        sourceAttachmentId: r[6] == null ? null : String(r[6]),
        sourcePdfPath: r[7] == null ? null : String(r[7]),
        parsedAt: r[8] == null ? null : String(r[8]),
      };
    }
  } catch {
    annualReport = null;
  }

  // 업종은 facilities 저장값을 단일 출처로 사용한다.
  // 과거에는 parsed_fields(industry_code_name) 원문 파싱 결과를 매 조회마다 재병합했으나,
  // 편집으로 수정/삭제한 옛 업종이 계속 부활하는 문제가 있어 병합을 중단했다.
  const industries = parseIndustriesFromValue(
    f.industry_code != null ? String(f.industry_code) : null,
    f.industry_name != null ? String(f.industry_name) : null
  );

  return {
    facilityId: String(f.facility_id ?? ""),
    companyName: formatCompanyName(String(f.company_name ?? "")) ?? "",
    businessRegistrationNo:
      f.business_registration_no != null
        ? formatBusinessRegistrationNo(String(f.business_registration_no))
        : null,
    representativeName: f.representative_name != null ? String(f.representative_name) : null,
    siteAddress:
      f.site_address != null
        ? isTruthyFlag(f.site_address_verbatim)
          ? String(f.site_address)
          : formatAddress(String(f.site_address))
        : null,
    additionalSiteAddresses: parseAdditionalSiteAddresses(f.additional_site_addresses),
    phoneNumber: f.phone_number != null ? String(f.phone_number) : null,
    industryCode: f.industry_code != null ? String(f.industry_code) : null,
    industryName: f.industry_name != null ? String(f.industry_name) : null,
    businessCertificateBusinessType: f.business_certificate_business_type != null ? String(f.business_certificate_business_type) : null,
    businessCertificateBusinessItem: f.business_certificate_business_item != null ? String(f.business_certificate_business_item) : null,
    businessCertificateCorporateRegistrationNo: f.business_certificate_corporate_registration_no != null ? String(f.business_certificate_corporate_registration_no) : null,
    industries,
    regionSido: f.region_sido != null ? String(f.region_sido) : null,
    regionSigungu: f.region_sigungu != null ? String(f.region_sigungu) : null,
    source: f.source != null ? String(f.source) : "ieps",
    memo: f.memo != null ? String(f.memo) : null,
    logoPath: f.logo_path != null ? String(f.logo_path) : null,
    aliases: (await loadAliasesByFacility(db, [facilityId])).get(facilityId) ?? [],
    serviceCategories: (await loadServiceCategoriesByFacility(db, [facilityId])).get(facilityId) ?? [],
    companySize: normalizeFacilityCompanySize(f.company_size),
    manualProducts: await loadManualProducts(db, facilityId),
    groupInfo: await loadGroupInfo(db, facilityId),
    operatingEntityInfo: await loadOperatingEntityInfo(db, facilityId),
    createdAt: String(f.created_at ?? ""),
    updatedAt: String(f.updated_at ?? ""),
    isClosed: isClosed === true || isClosed === "true" || Number(isClosed ?? 0) === 1,
    permits,
    businessCertificates,
    annualReport,
  };
}

// ============================================================
// 지역(시도 / 시군구) 분포 — 라운드 2B 드릴다운 지도용
// ============================================================

export interface RegionDistribution {
  bySido: { sido: string; count: number }[];
  bySigungu: { sido: string | null; sigungu: string; count: number }[];
  total: number;
  unassigned: number;
}

/**
 * 사업장 마스터의 region_sido / region_sigungu 집계.
 * - source 무관하게 모든 사업장(IEPS + manual) 포함
 * - region_sido 가 null 인 행은 unassigned 로 분리 집계
 */
export async function getRegionDistribution(): Promise<RegionDistribution> {
  invalidateDb();
  const db = await getDb();
  const safe = async (sql: string) => {
    try {
      const r = await db.exec(sql);
      return r.length ? r[0] : null;
    } catch {
      return null;
    }
  };

  const totalR = await safe("SELECT COUNT(*) FROM facilities");
  const total = totalR?.values?.[0] ? Number(totalR.values[0][0]) : 0;
  const unassignedR = await safe("SELECT COUNT(*) FROM facilities WHERE region_sido IS NULL");
  const unassigned = unassignedR?.values?.[0] ? Number(unassignedR.values[0][0]) : 0;

  const sidoR = await safe(
    "SELECT region_sido, COUNT(*) FROM facilities WHERE region_sido IS NOT NULL GROUP BY region_sido ORDER BY 2 DESC"
  );
  const sigunguR = await safe(
    "SELECT region_sido, region_sigungu, COUNT(*) FROM facilities WHERE region_sigungu IS NOT NULL GROUP BY region_sido, region_sigungu ORDER BY 3 DESC"
  );

  return {
    bySido: (sidoR?.values ?? []).map((r) => ({
      sido: String(r[0]),
      count: Number(r[1]),
    })),
    bySigungu: (sigunguR?.values ?? []).map((r) => ({
      sido: r[0] != null ? String(r[0]) : null,
      sigungu: String(r[1]),
      count: Number(r[2]),
    })),
    total,
    unassigned,
  };
}

export interface RegionStatsFacility {
  facilityId: string;
  companyName: string;
  industryName: string | null;
  serviceCategories: FacilityServiceCategory[];
  companySize: FacilityCompanySize | null;
  airClass: number | null;
  waterClass: number | null;
  permitDate: string | null;
}

export interface RegionStats {
  scope: { sido: string | null; sigungu: string | null };
  total: number;
  airClass: { class: number; count: number }[]; // 1~5 + 0=미상
  waterClass: { class: number; count: number }[]; // 1~5 + 0=미상
  serviceCategories: { category: FacilityServiceCategory; label: string; count: number }[];
  companySizes: { size: FacilityCompanySize | "unknown"; label: string; count: number }[];
  facilities: RegionStatsFacility[];
}

/**
 * 시도(또는 시도+시군구) 범위 사업장의 대기/수질 종 규모 집계 + 사업장 30건.
 * - permit_scales 의 '최신 permit per facility' 기준으로 종 규모 산출
 * - airClass / waterClass 는 항상 1~5 + 0(미상) 6슬롯 반환
 */
export async function getRegionStats(
  sido: string | null,
  sigungu: string | null,
  options: { facilityLimit?: number | null } = {}
): Promise<RegionStats> {
  invalidateDb();
  const db = await getDb();

  const where: string[] = [];
  const params: unknown[] = [];
  if (sido) {
    where.push(`f.region_sido = $${params.length + 1}`);
    params.push(sido);
  }
  if (sigungu) {
    where.push(`f.region_sigungu = $${params.length + 1}`);
    params.push(sigungu);
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const safe = async (sql: string, p: unknown[] = []) => {
    try {
      const r = await db.exec(sql, p);
      return r.length ? r[0] : null;
    } catch {
      return null;
    }
  };

  const totalR = await safe("SELECT COUNT(*) FROM facilities f " + whereSql, params);
  const total = totalR?.values?.[0] ? Number(totalR.values[0][0]) : 0;

  // 사업장 단위 최신 permit 1건의 air_class / water_class 분포.
  // permit_scales 가 없어도 facility_annual_reports(연간보고서) 의 종 규모를 폴백으로 사용해
  // 검토결과서 미공개 사업장도 통계에 포함되도록 한다.
  const baseLatest = `
    SELECT f.facility_id,
      COALESCE(
        (SELECT ps.air_class FROM permits p JOIN permit_scales ps ON ps.permit_id = p.permit_id
           WHERE p.facility_id = f.facility_id
           ORDER BY CASE WHEN p.permit_date IS NULL OR p.permit_date = '' THEN 1 ELSE 0 END,
                    p.permit_date DESC,
                    p.updated_at DESC
           LIMIT 1),
        (SELECT far.air_class FROM facility_annual_reports far
           WHERE far.facility_id = f.facility_id LIMIT 1)
      ) AS air_class,
      COALESCE(
        (SELECT ps.water_class FROM permits p JOIN permit_scales ps ON ps.permit_id = p.permit_id
           WHERE p.facility_id = f.facility_id
           ORDER BY CASE WHEN p.permit_date IS NULL OR p.permit_date = '' THEN 1 ELSE 0 END,
                    p.permit_date DESC,
                    p.updated_at DESC
           LIMIT 1),
        (SELECT far.water_class FROM facility_annual_reports far
           WHERE far.facility_id = f.facility_id LIMIT 1)
      ) AS water_class
    FROM facilities f
    ${whereSql}
  `;

  const buckets = async (col: "air_class" | "water_class") => {
    const r = await safe(
      `SELECT COALESCE(${col}, 0) AS k, COUNT(*) FROM (${baseLatest}) sub GROUP BY k ORDER BY k`,
      params
    );
    const map = new Map<number, number>();
    for (const row of r?.values ?? []) {
      map.set(Number(row[0] ?? 0), Number(row[1] ?? 0));
    }
    const out: { class: number; count: number }[] = [];
    for (const k of [1, 2, 3, 4, 5]) out.push({ class: k, count: map.get(k) ?? 0 });
    out.push({ class: 0, count: map.get(0) ?? 0 });
    return out;
  };

  const airClass = await buckets("air_class");
  const waterClass = await buckets("water_class");

  const serviceR = await safe(
    `SELECT fsc.category, COUNT(DISTINCT f.facility_id)
       FROM facilities f
       JOIN facility_service_categories fsc ON fsc.facility_id = f.facility_id
       ${whereSql}
      GROUP BY fsc.category`,
    params
  );
  const serviceMap = new Map<FacilityServiceCategory, number>();
  for (const row of serviceR?.values ?? []) {
    const category = normalizeFacilityServiceCategory(row[0]);
    if (category) serviceMap.set(category, Number(row[1] ?? 0));
  }
  const serviceCategories = FACILITY_SERVICE_ORDER.map((category) => ({
    category,
    label: FACILITY_SERVICE_LABELS[category],
    count: serviceMap.get(category) ?? 0,
  }));

  const sizeR = await safe(
    `SELECT COALESCE(f.company_size, 'unknown'), COUNT(*)
       FROM facilities f
       ${whereSql}
      GROUP BY COALESCE(f.company_size, 'unknown')`,
    params
  );
  const sizeMap = new Map<string, number>();
  for (const row of sizeR?.values ?? []) sizeMap.set(String(row[0] ?? "unknown"), Number(row[1] ?? 0));
  const companySizes: RegionStats["companySizes"] = [
    ...FACILITY_COMPANY_SIZE_ORDER.map((size) => ({
      size,
      label: FACILITY_COMPANY_SIZE_LABELS[size],
      count: sizeMap.get(size) ?? 0,
    })),
    { size: "unknown" as const, label: "미상", count: sizeMap.get("unknown") ?? 0 },
  ];

  const facilityLimit = options.facilityLimit === undefined ? 30 : options.facilityLimit;
  const limitSql = facilityLimit == null ? "" : `LIMIT $${params.length + 1}`;
  const listParams = facilityLimit == null ? params : [...params, facilityLimit];

  // 사업장 목록 — 최신 permit join, 종 규모는 permit_scales 우선 + far 폴백.
  const listR = await safe(
    `
    SELECT
      f.facility_id, f.company_name, f.industry_name, f.company_size,
      COALESCE(
        (SELECT ps.air_class FROM permits p JOIN permit_scales ps ON ps.permit_id = p.permit_id
           WHERE p.facility_id = f.facility_id
           ORDER BY CASE WHEN p.permit_date IS NULL OR p.permit_date = '' THEN 1 ELSE 0 END,
                    p.permit_date DESC,
                    p.updated_at DESC
           LIMIT 1),
        (SELECT far.air_class FROM facility_annual_reports far WHERE far.facility_id = f.facility_id LIMIT 1)
      ) AS air_class,
      COALESCE(
        (SELECT ps.water_class FROM permits p JOIN permit_scales ps ON ps.permit_id = p.permit_id
           WHERE p.facility_id = f.facility_id
           ORDER BY CASE WHEN p.permit_date IS NULL OR p.permit_date = '' THEN 1 ELSE 0 END,
                    p.permit_date DESC,
                    p.updated_at DESC
           LIMIT 1),
        (SELECT far.water_class FROM facility_annual_reports far WHERE far.facility_id = f.facility_id LIMIT 1)
      ) AS water_class,
      (SELECT p.permit_date FROM permits p
         WHERE p.facility_id = f.facility_id
         ORDER BY CASE WHEN p.permit_date IS NULL OR p.permit_date = '' THEN 1 ELSE 0 END,
                  p.permit_date DESC,
                  p.updated_at DESC
         LIMIT 1) AS permit_date
    FROM facilities f
    ${whereSql}
    ORDER BY f.created_at DESC
    ${limitSql}
    `,
    listParams
  );
  const facilitiesRaw = listR?.values ?? [];
  const facilitiesIds = facilitiesRaw.map((row) => String(row[0] ?? "")).filter(Boolean);
  const servicesByFacility = await loadServiceCategoriesByFacility(db, facilitiesIds);
  const facilities: RegionStatsFacility[] = facilitiesRaw.map((row) => ({
    facilityId: String(row[0] ?? ""),
    companyName: formatCompanyName(String(row[1] ?? "")) ?? "",
    industryName: row[2] != null ? String(row[2]) : null,
    companySize: normalizeFacilityCompanySize(row[3]),
    serviceCategories: servicesByFacility.get(String(row[0] ?? "")) ?? [],
    airClass: row[4] != null ? Number(row[4]) : null,
    waterClass: row[5] != null ? Number(row[5]) : null,
    permitDate: row[6] != null ? String(row[6]) : null,
  }));

  return {
    scope: { sido, sigungu },
    total,
    airClass,
    waterClass,
    serviceCategories,
    companySizes,
    facilities,
  };
}

export interface RegionFacilityExportRow {
  decisionNo: string | null;
  companyName: string;
  businessRegistrationNo: string | null;
  siteAddress: string | null;
  phoneNumber: string | null;
  industry: string | null;
  permitDate: string | null;
  permitScale: string | null;
  productOutput: string | null;
}

function formatNumberForExport(value: unknown): string | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Number.isInteger(n) ? String(n) : String(n);
}

function joinNonEmpty(lines: Array<string | null | undefined>): string | null {
  const out = lines.map((v) => (v ?? "").trim()).filter(Boolean);
  return out.length ? out.join("\n") : null;
}

function formatScaleForExport(row: Record<string, unknown>): string | null {
  const airClass = row.air_class != null ? `${row.air_class}종` : null;
  const airAmount = formatNumberForExport(row.air_amount_ton_per_year);
  const waterClass = row.water_class != null ? `${row.water_class}종` : null;
  const waterAmount = formatNumberForExport(row.wastewater_amount_m3_per_day);
  return joinNonEmpty([
    airClass ? `대기 ${airClass}${airAmount ? ` (${airAmount}톤/년)` : ""}` : null,
    waterClass ? `수질 ${waterClass}${waterAmount ? ` (${waterAmount}㎥/일)` : ""}` : null,
  ]);
}

function formatProductRows(rows: { product_name: unknown; production_amount: unknown; production_unit: unknown }[]): string | null {
  return joinNonEmpty(
    rows.map((p) => {
      const name = p.product_name != null ? String(p.product_name).trim() : "";
      const amount = formatNumberForExport(p.production_amount);
      const unit = p.production_unit != null ? String(p.production_unit).trim() : "";
      if (!name && !amount && !unit) return null;
      return [name, amount, unit].filter(Boolean).join(" ");
    })
  );
}

function formatAnnualProducts(raw: unknown): string | null {
  if (!raw) return null;
  // product_outputs_json 은 jsonb 컬럼이라 node-postgres 가 객체 / 배열로 자동 디시리얼라이즈한다.
  if (!Array.isArray(raw)) return null;
  return joinNonEmpty(
    raw.map((p: any) => {
      const name = p?.name ?? p?.product_name ?? p?.productName;
      const amount = p?.amount ?? p?.production_amount ?? p?.productionAmount;
      const unit = p?.unit ?? p?.production_unit ?? p?.productionUnit;
      return [
        name != null ? String(name).trim() : "",
        formatNumberForExport(amount),
        unit != null ? String(unit).trim() : "",
      ]
        .filter(Boolean)
        .join(" ");
    })
  );
}

/**
 * 지역별 엑셀 내보내기용 9개 추출 항목.
 * - 대표 허가는 지역 리스트와 동일하게 permit_date 가 있는 행을 우선한다.
 * - 생산품은 대표 permit 의 product_outputs 우선, 없으면 연간보고서 스냅샷으로 폴백.
 */
export async function listRegionFacilityExportRows(args: {
  sido: string;
  sigungu?: string | null;
}): Promise<RegionFacilityExportRow[]> {
  invalidateDb();
  const db = await getDb();

  const where: string[] = ["f.region_sido = $1"];
  const params: string[] = [args.sido];
  if (args.sigungu) {
    where.push(`f.region_sigungu = $${params.length + 1}`);
    params.push(args.sigungu);
  }

  const result = await db.exec(
    `
    SELECT
      f.facility_id,
      f.company_name,
      f.business_registration_no,
      f.site_address,
      f.phone_number,
      f.industry_code,
      f.industry_name,
      lp.permit_id,
      lp.decision_no,
      lp.permit_date,
      COALESCE(ps.air_class, far.air_class) AS air_class,
      COALESCE(ps.air_amount_ton_per_year, far.air_amount_ton_per_year) AS air_amount_ton_per_year,
      COALESCE(ps.water_class, far.water_class) AS water_class,
      COALESCE(ps.wastewater_amount_m3_per_day, far.wastewater_amount_m3_per_day) AS wastewater_amount_m3_per_day,
      far.product_outputs_json
    FROM facilities f
    LEFT JOIN permits lp ON lp.permit_id = (
      SELECT permit_id FROM permits
      WHERE facility_id = f.facility_id
      ORDER BY CASE WHEN permit_date IS NULL OR permit_date = '' THEN 1 ELSE 0 END,
               permit_date DESC,
               updated_at DESC
      LIMIT 1
    )
    LEFT JOIN permit_scales ps ON ps.permit_id = lp.permit_id
    LEFT JOIN facility_annual_reports far ON far.facility_id = f.facility_id
    WHERE ${where.join(" AND ")}
    ORDER BY f.normalized_company_name ASC, f.company_name ASC
    `,
    params
  );

  const rows = rowsToObjects(result);
  const out: RegionFacilityExportRow[] = [];
  for (const row of rows) {
    let productOutput: string | null = null;
    if (row.permit_id != null) {
      try {
        const products = await db.exec(
          "SELECT product_name, production_amount, production_unit FROM product_outputs WHERE permit_id = $1 ORDER BY id ASC",
          [String(row.permit_id)]
        );
        productOutput = formatProductRows(rowsToObjects(products) as any[]);
      } catch {
        productOutput = null;
      }
    }
    if (!productOutput) productOutput = formatAnnualProducts(row.product_outputs_json);

    out.push({
      decisionNo: row.decision_no != null ? String(row.decision_no) : null,
      companyName: formatCompanyName(String(row.company_name ?? "")) ?? "",
      businessRegistrationNo:
        row.business_registration_no != null ? String(row.business_registration_no) : null,
      siteAddress: row.site_address != null ? String(row.site_address) : null,
      phoneNumber: row.phone_number != null ? String(row.phone_number) : null,
      industry: joinNonEmpty([
        row.industry_code || row.industry_name
          ? [row.industry_code, row.industry_name].filter(Boolean).join(" ")
          : null,
      ]),
      permitDate: row.permit_date != null ? String(row.permit_date) : null,
      permitScale: formatScaleForExport(row),
      productOutput,
    });
  }
  return out;
}

export async function getCollectionConfig(id: number): Promise<CollectionConfigRow | null> {
  invalidateDb();
  const db = await getDb();
  let result;
  try {
    result = await db.exec(
      "SELECT id, name, config_json, is_default, created_at, updated_at FROM collection_configs WHERE id = $1 LIMIT 1",
      [id]
    );
  } catch {
    return null;
  }
  const rows = rowsToObjects(result);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    name: String(row.name ?? ""),
    // config_json 은 jsonb. node-postgres 가 객체로 자동 디시리얼라이즈하므로 직렬화해서 노출.
    configJson: row.config_json != null ? JSON.stringify(row.config_json) : "{}",
    isDefault: Number(row.is_default ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

// ───────────────────────────────────────────────────────────────
// 라운드 3 — 운영 관측 (alerts / download_events) 쿼리
// ───────────────────────────────────────────────────────────────

export interface AlertRow {
  id: number;
  severity: "info" | "warn" | "error";
  source: "download" | "scrape" | "parse";
  code: string;
  title: string;
  body: string | null;
  payloadJson: string | null;
  jobId: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

export async function listAlerts(args: {
  status?: "open" | "all";
  limit?: number;
} = {}): Promise<AlertRow[]> {
  invalidateDb();
  const db = await getDb();

  const status = args.status ?? "open";
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);

  const where = status === "open" ? "WHERE acknowledged_at IS NULL" : "";
  let result;
  try {
    result = await db.exec(
      `SELECT id, severity, source, code, title, body, payload_json,
              job_id, created_at, acknowledged_at, acknowledged_by
         FROM alerts
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT $1`,
      [limit]
    );
  } catch {
    return [];
  }
  const rows = rowsToObjects(result);
  return rows.map((row) => ({
    id: Number(row.id),
    severity: (row.severity as AlertRow["severity"]) ?? "info",
    source: (row.source as AlertRow["source"]) ?? "download",
    code: String(row.code ?? ""),
    title: String(row.title ?? ""),
    body: row.body ? String(row.body) : null,
    // payload_json 은 jsonb. node-postgres 가 객체로 자동 디시리얼라이즈하므로 문자열로 직렬화해서 노출.
    payloadJson: row.payload_json != null ? JSON.stringify(row.payload_json) : null,
    jobId: row.job_id ? String(row.job_id) : null,
    createdAt: String(row.created_at ?? ""),
    acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : null,
    acknowledgedBy: row.acknowledged_by ? String(row.acknowledged_by) : null,
  }));
}

export async function getAlertUnreadCount(): Promise<number> {
  invalidateDb();
  const db = await getDb();
  try {
    const r = await db.exec("SELECT COUNT(*) FROM alerts WHERE acknowledged_at IS NULL");
    return r.length ? Number(r[0].values[0][0]) : 0;
  } catch {
    return 0;
  }
}

export interface DownloadTrendBucket {
  /** ISO 날짜 (YYYY-MM-DD, UTC) */
  date: string;
  httpOk: number;
  playwrightOk: number;
  cacheOk: number;
  failed: number;
}

export async function getDownloadTrend(days = 7): Promise<DownloadTrendBucket[]> {
  invalidateDb();
  const db = await getDb();

  const safeDays = Math.min(Math.max(Math.floor(days), 1), 90);
  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();

  // 빈 테이블 / 미마이그레이션 환경 대비
  let result;
  try {
    result = await db.exec(
      `SELECT substr(occurred_at, 1, 10) AS day,
              method,
              status,
              COUNT(*) AS cnt
         FROM download_events
         WHERE occurred_at >= $1
         GROUP BY day, method, status
         ORDER BY day ASC`,
      [since]
    );
  } catch {
    return [];
  }
  const rows = rowsToObjects(result);

  const map = new Map<string, DownloadTrendBucket>();
  for (let i = 0; i < safeDays; i++) {
    const d = new Date(Date.now() - (safeDays - 1 - i) * 24 * 60 * 60 * 1000);
    const day = d.toISOString().slice(0, 10);
    map.set(day, { date: day, httpOk: 0, playwrightOk: 0, cacheOk: 0, failed: 0 });
  }

  for (const row of rows) {
    const day = String(row.day ?? "");
    const method = String(row.method ?? "");
    const status = String(row.status ?? "");
    const cnt = Number(row.cnt ?? 0);
    const bucket = map.get(day) ?? { date: day, httpOk: 0, playwrightOk: 0, cacheOk: 0, failed: 0 };
    if (status === "failed") {
      bucket.failed += cnt;
    } else if (status === "ok") {
      if (method === "http") bucket.httpOk += cnt;
      else if (method === "playwright") bucket.playwrightOk += cnt;
      else if (method === "cache") bucket.cacheOk += cnt;
    }
    map.set(day, bucket);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export interface FailureReasonRow {
  reason: string;
  count: number;
}

export async function getFailureReasons(days = 7, limit = 10): Promise<FailureReasonRow[]> {
  invalidateDb();
  const db = await getDb();

  const safeDays = Math.min(Math.max(Math.floor(days), 1), 90);
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 30);
  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();

  let result;
  try {
    result = await db.exec(
      `SELECT COALESCE(error,'unknown') AS reason, COUNT(*) AS cnt
         FROM download_events
        WHERE status = 'failed' AND occurred_at >= $1
        GROUP BY reason
        ORDER BY cnt DESC
        LIMIT $2`,
      [since, safeLimit]
    );
  } catch {
    return [];
  }
  const rows = rowsToObjects(result);
  return rows.map((row) => ({
    reason: String(row.reason ?? "unknown"),
    count: Number(row.cnt ?? 0),
  }));
}
