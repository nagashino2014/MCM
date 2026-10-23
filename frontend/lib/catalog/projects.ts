import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { categoryCaseSql } from "@/lib/ieps/contracts";
import {
  MANUAL_ID_PREFIX,
  sanitizeAppendixRules,
  type AppendixRules,
  type CatalogProjectRow,
  type ContractCatalogMeta,
  type DisplayOverride,
} from "./appendix";
import { SOFTWARE_CATEGORY, isSoftwareServiceType } from "./areas";
import { isColorConcept, isCoverDesign, sanitizeDocumentTheme, type DocumentTheme } from "./document-theme";
import { listManualProjects, manualToProjectRow } from "./manual-projects";
import { regionGroupId } from "./regions";

/*
 * 회사소개서 부록 실적 원천(서버) — 계약 + 사업장 + 완료일 + 대외 표기 메타(310 contract_catalog_meta).
 * 표기명·표시 범위 계산은 lib/catalog/appendix.ts(순수 함수)가 한다.
 * 분류는 계약 관리 대시보드와 같은 categoryCaseSql, 완료 판정은 completions-status 와 같은 규칙(허가일 또는 최종 계산서).
 */

/** 계약 기준일 폴백 — contracts.ts 의 집계 규칙과 동일 */
const CONTRACT_DATE_SQL = "COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at)";

const s = (v: unknown): string => (v == null ? "" : String(v).trim());

function mapMeta(r: Record<string, unknown>): ContractCatalogMeta | null {
  if (!r.has_meta) return null;
  const override = s(r.display_override);
  return {
    displayTitle: s(r.display_title),
    displayIndustry: s(r.display_industry),
    isPublic: Number(r.is_public ?? 1) === 1,
    isFeatured: Number(r.is_featured ?? 0) === 1,
    displayOverride: (override === "always" || override === "never" ? override : "auto") as DisplayOverride,
    groupKey: s(r.group_key),
    note: s(r.note),
    siteCount: r.site_count != null && Number(r.site_count) >= 0 ? Number(r.site_count) : null,
    reviewedAt: r.reviewed_at != null ? String(r.reviewed_at) : null,
  };
}

/** 삭제되지 않은 전체 계약(RBAC 범위 없음 — 회사소개서는 전사 실적) + 계약 없는 실적(뒤에 붙임). */
export async function listCatalogProjects(): Promise<CatalogProjectRow[]> {
  const db = await getDb();
  const catCase = categoryCaseSql("c.service_type");
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id, c.contract_title,
              ${catCase} AS category,
              COALESCE(c.service_type, '') AS service_type,
              COALESCE(c.service_subtype, '') AS subtype,
              SUBSTRING(${CONTRACT_DATE_SQL}, 1, 10) AS contract_date,
              COALESCE(c.started_at, '') AS started_at,
              COALESCE(c.ended_at, '') AS ended_at,
              COALESCE(c.current_amount, c.contract_amount) AS amount,
              COALESCE(c.contract_kind, 'standard') AS contract_kind,
              COALESCE(cp.company_name, '') AS counterparty_name,
              COALESCE(sf.company_name, '') AS site_name,
              COALESCE(NULLIF(sf.region_sido, ''), cp.region_sido, '') AS region_sido,
              COALESCE(c.industry_category, '') AS industry_category,
              COALESCE(NULLIF(sf.industry_name, ''), cp.industry_name, '') AS industry_name,
              COALESCE(NULLIF(sf.industry_code, ''), cp.industry_code, '') AS industry_code,
              COALESCE(SUBSTRING(NULLIF(c.permit_issued_at, ''), 1, 10), '') AS permit_issued_at,
              COALESCE(c.permit_no, '') AS permit_no,
              COALESCE(SUBSTRING(NULLIF(c.permit_issued_at, ''), 1, 10), lm.invoice_done_date, '') AS completed_at,
              (m.contract_id IS NOT NULL) AS has_meta,
              m.display_title, m.display_industry, m.is_public, m.is_featured, m.display_override,
              m.group_key, m.note, m.site_count, m.reviewed_at
         FROM contracts c
         LEFT JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
         LEFT JOIN facilities sf ON sf.facility_id = c.facility_id
         LEFT JOIN (
           SELECT DISTINCT ON (contract_id) contract_id,
                  CASE WHEN COALESCE(invoice_issued, 0) = 1 THEN SUBSTRING(invoice_issued_at, 1, 10) ELSE NULL END AS invoice_done_date
             FROM contract_payment_milestones
            ORDER BY contract_id, stage_order DESC
         ) lm ON lm.contract_id = c.contract_id
         LEFT JOIN contract_catalog_meta m ON m.contract_id = c.contract_id
        WHERE c.deleted_at IS NULL
        ORDER BY contract_date ASC NULLS LAST, c.contract_title ASC`
    )
  );
  const contractRows: CatalogProjectRow[] = rows.map((r) => {
    const contractDate = s(r.contract_date);
    const amountRaw = r.amount == null ? null : Number(r.amount);
    const regionSido = s(r.region_sido);
    return {
      contractId: s(r.contract_id),
      source: "contract" as const,
      contractTitle: s(r.contract_title),
      // 응용소프트웨어 공급 계약은 소개서에서만 6번째 분야로 센다(계약 관리 분류는 그대로 — lib/catalog/areas.ts)
      category: isSoftwareServiceType(s(r.service_type)) ? SOFTWARE_CATEGORY : s(r.category) || "기타 용역",
      subtype: s(r.subtype),
      contractDate,
      year: /^\d{4}/.test(contractDate) ? contractDate.slice(0, 4) : "",
      startedAt: s(r.started_at),
      endedAt: s(r.ended_at),
      amount: amountRaw != null && Number.isFinite(amountRaw) ? amountRaw : null,
      isUnitPrice: s(r.contract_kind) === "unit_price",
      counterpartyName: s(r.counterparty_name),
      siteName: s(r.site_name),
      regionSido,
      regionGroup: regionGroupId(regionSido),
      industryCategory: s(r.industry_category),
      industryName: s(r.industry_name),
      industryCode: s(r.industry_code),
      permitIssuedAt: s(r.permit_issued_at),
      permitNo: s(r.permit_no),
      completedAt: s(r.completed_at),
      meta: mapMeta(r),
    };
  });
  const manualRows = (await listManualProjects()).map(manualToProjectRow);
  return [...contractRows, ...manualRows];
}

export interface ProjectMetaPatch {
  displayTitle?: string;
  displayIndustry?: string;
  isPublic?: boolean;
  isFeatured?: boolean;
  displayOverride?: DisplayOverride;
  groupKey?: string;
  note?: string;
  /** 허가 사업장 수 직접 지정(0~50, 0 = 최초허가 집계 제외). null = 결정번호 수로 셈 */
  siteCount?: number | null;
  /** true = 검토 완료로 표시(미검토 배지 해제) */
  reviewed?: boolean;
}

/**
 * 대외 표기 메타 저장 — 여러 계약에 같은 값을 한 번에(일괄 검토·묶음 지정). 보낸 필드만 바꾼다.
 * 메타 행이 없던 계약은 기본값(공개·자동)으로 만든 뒤 덮는다.
 */
export async function saveProjectMeta(contractIds: string[], patch: ProjectMetaPatch, actorUserId: string | null): Promise<number> {
  // 계약 없는 실적(manual:)은 자기 행에 메타를 갖고 있어 여기서 다루지 않는다(계약 없는 실적 API).
  const ids = [...new Set(contractIds.map((id) => s(id)).filter((id) => id && !id.startsWith(MANUAL_ID_PREFIX)))].slice(0, 2000);
  if (ids.length === 0) return 0;
  const now = new Date().toISOString();
  const sets: string[] = [];
  const params: unknown[] = [ids, now, actorUserId];
  const push = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.displayTitle !== undefined) push("display_title", s(patch.displayTitle).slice(0, 500) || null);
  if (patch.displayIndustry !== undefined) push("display_industry", s(patch.displayIndustry).slice(0, 100) || null);
  if (patch.isPublic !== undefined) push("is_public", patch.isPublic ? 1 : 0);
  if (patch.isFeatured !== undefined) push("is_featured", patch.isFeatured ? 1 : 0);
  if (patch.displayOverride !== undefined) {
    push("display_override", patch.displayOverride === "always" || patch.displayOverride === "never" ? patch.displayOverride : "auto");
  }
  if (patch.groupKey !== undefined) push("group_key", s(patch.groupKey).slice(0, 200) || null);
  if (patch.note !== undefined) push("note", s(patch.note).slice(0, 1000) || null);
  if (patch.siteCount !== undefined) {
    const n = patch.siteCount == null ? NaN : Math.round(Number(patch.siteCount));
    push("site_count", Number.isFinite(n) && n >= 0 && n <= 50 ? n : null);
  }
  if (patch.reviewed !== undefined) sets.push(patch.reviewed ? "reviewed_at = $2" : "reviewed_at = NULL");
  return withDbWrite(async (txn) => {
    // 없는 행은 기본값으로 만든다(존재하는 계약만 — FK 위반 대신 조용히 건너뜀)
    await txn.run(
      `INSERT INTO contract_catalog_meta (contract_id, updated_by, updated_at)
       SELECT c.contract_id, $3, $2 FROM contracts c
        WHERE c.contract_id = ANY($1::text[]) AND c.deleted_at IS NULL
       ON CONFLICT (contract_id) DO NOTHING`,
      params.slice(0, 3)
    );
    if (sets.length > 0) {
      await txn.run(
        `UPDATE contract_catalog_meta SET ${sets.join(", ")}, updated_by = $3, updated_at = $2 WHERE contract_id = ANY($1::text[])`,
        params
      );
    }
    return ids.length;
  });
}

// ─────────────────────────────── 문서(판)·표시 범위 규칙 ───────────────────────────────

export const MASTER_DOC_ID = "master";

export interface CatalogDocumentSummary {
  docId: string;
  title: string;
  kind: "master" | "custom";
  status: string;
  appendixRules: AppendixRules;
  updatedAt: string;
}

export async function listCatalogDocuments(): Promise<CatalogDocumentSummary[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      "SELECT doc_id, title, kind, status, appendix_rules, updated_at FROM catalog_documents ORDER BY (kind = 'master') DESC, updated_at DESC"
    )
  );
  return rows.map((r) => ({
    docId: s(r.doc_id),
    title: s(r.title),
    kind: s(r.kind) === "custom" ? "custom" : "master",
    status: s(r.status) || "draft",
    appendixRules: sanitizeAppendixRules(typeof r.appendix_rules === "string" ? JSON.parse(r.appendix_rules) : r.appendix_rules),
    updatedAt: s(r.updated_at),
  }));
}

export async function getAppendixRules(docId = MASTER_DOC_ID): Promise<AppendixRules> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec("SELECT appendix_rules FROM catalog_documents WHERE doc_id = $1", [docId]));
  const raw = rows[0]?.appendix_rules;
  return sanitizeAppendixRules(typeof raw === "string" ? JSON.parse(raw) : raw);
}

export async function saveAppendixRules(docId: string, rules: unknown, actorUserId: string | null): Promise<AppendixRules> {
  const clean = sanitizeAppendixRules(rules);
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO catalog_documents (doc_id, title, kind, appendix_rules, created_at, created_by, updated_at, updated_by)
       VALUES ($1, '회사소개서(마스터본)', 'master', $2::jsonb, $3, $4, $3, $4)
       ON CONFLICT (doc_id) DO UPDATE SET appendix_rules = EXCLUDED.appendix_rules, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [docId, JSON.stringify(clean), now, actorUserId]
    );
  });
  return clean;
}

/** 문서(판) 설정 — 표지 디자인·표지 사진·서체 세트(lib/catalog/document-theme.ts). */
export async function getDocumentTheme(docId = MASTER_DOC_ID): Promise<DocumentTheme> {
  const db = await getDb();
  const raw = rowsToObjects(await db.exec("SELECT theme FROM catalog_documents WHERE doc_id = $1", [docId]))[0]?.theme;
  return sanitizeDocumentTheme(typeof raw === "string" ? JSON.parse(raw) : raw);
}

/** 문서 설정 저장 — 보낸 항목만 바꾸고 theme 의 다른 키(색 컨셉 등 이후 항목)는 유지한다. */
export async function saveDocumentTheme(docId: string, patch: Partial<DocumentTheme>, actorUserId: string | null): Promise<DocumentTheme> {
  const current = await getDocumentTheme(docId);
  // 올바르지 않은 값은 무시한다(기본값으로 덮어쓰지 않게)
  const clean: Partial<DocumentTheme> = {};
  if (isCoverDesign(patch.cover)) clean.cover = patch.cover;
  if (patch.coverPhoto === "photo" || patch.coverPhoto === "none") clean.coverPhoto = patch.coverPhoto;
  if (typeof patch.fontSet === "string" && /^[a-z0-9-]{1,40}$/.test(patch.fontSet)) clean.fontSet = patch.fontSet;
  if (isColorConcept(patch.concept)) clean.concept = patch.concept;
  const next = sanitizeDocumentTheme({ ...current, ...clean });
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `UPDATE catalog_documents SET theme = COALESCE(theme, '{}'::jsonb) || $2::jsonb, updated_at = $3, updated_by = $4 WHERE doc_id = $1`,
      [docId, JSON.stringify(next), now, actorUserId]
    );
  });
  return next;
}
