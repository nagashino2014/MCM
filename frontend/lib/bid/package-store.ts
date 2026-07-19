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

export interface BidPackage {
  packageId: string;
  bidType: string;
  bidId: string;
  orgName: string | null;
  formId: string | null;
  contractIds: string[];
  employeeIds: string[];
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

function mapPackage(r: Record<string, unknown>): BidPackage {
  return {
    packageId: String(r.package_id ?? ""),
    bidType: String(r.bid_type ?? ""),
    bidId: String(r.bid_id ?? ""),
    orgName: r.org_name != null ? String(r.org_name) : null,
    formId: r.form_id != null ? String(r.form_id) : null,
    contractIds: parseIds(r.contract_ids),
    employeeIds: parseIds(r.employee_ids),
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
  actorUserId: string | null;
}): Promise<BidPackage> {
  const now = new Date().toISOString();
  const packageId = "bpk_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO bid_packages
         (package_id, bid_type, bid_id, org_name, form_id, contract_ids, employee_ids, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'draft', $8, $9, $9)
       ON CONFLICT (bid_type, bid_id) DO UPDATE SET
         org_name = EXCLUDED.org_name,
         form_id = EXCLUDED.form_id,
         contract_ids = EXCLUDED.contract_ids,
         employee_ids = EXCLUDED.employee_ids,
         updated_at = EXCLUDED.updated_at`,
      [
        packageId,
        params.bidType,
        params.bidId,
        params.orgName,
        params.formId,
        JSON.stringify([...new Set(params.contractIds.map((s) => s.trim()).filter(Boolean))]),
        JSON.stringify([...new Set(params.employeeIds.map((s) => s.trim()).filter(Boolean))]),
        params.actorUserId,
        now,
      ]
    );
  });
  const saved = await getPackage(params.bidType, params.bidId);
  if (!saved) throw new Error("패키지 저장에 실패했습니다.");
  return saved;
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
 */
export async function listParticipantsForContracts(contractIds: string[]): Promise<PackageParticipant[]> {
  const ids = [...new Set(contractIds.map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, e.eng_grade, e.specialty_field, p.position_name,
              COUNT(DISTINCT sp.contract_id) AS contract_count,
              MAX(p.rank_order) AS rank_order
         FROM service_participants sp
         JOIN employee_profiles e ON e.employee_id = sp.employee_id
         LEFT JOIN positions p ON p.position_id = e.position_id
        WHERE sp.contract_id = ANY($1::text[])
        GROUP BY e.employee_id, e.name, e.eng_grade, e.specialty_field, p.position_name
        ORDER BY MAX(p.rank_order) DESC NULLS LAST, e.name ASC`,
      [ids]
    )
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id ?? ""),
    name: String(r.name ?? ""),
    positionName: r.position_name != null ? String(r.position_name) : null,
    engGrade: r.eng_grade != null ? String(r.eng_grade) : null,
    specialtyField: r.specialty_field != null ? String(r.specialty_field) : null,
    contractCount: Number(r.contract_count ?? 0),
  }));
}
