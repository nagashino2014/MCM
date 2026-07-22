import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { parseFields, validateFields, type ApprovalFieldDef } from "@/lib/approval/fields";

/*
 * 전자결재 양식(084) — 양식 = 필드 스키마(fields jsonb)가 원본이며, 문서의 field_values 는
 * 이 스키마의 key 로 구조화 저장된다(다우오피스 대비 핵심 개선 — 분류·정렬·집계 가능).
 * 설계: docs/e-approval-blueprint.md §3(필드 타입)·§4(모델)·§7-1(양식 5종 시드).
 * 필드 타입·카탈로그·검증은 클라이언트 안전 모듈 lib/approval/fields.ts 에 있다(화면과 공유).
 */

export {
  APPROVAL_FIELD_TYPES,
  FILL_SOURCES,
  parseFields,
  validateFields,
} from "@/lib/approval/fields";
export type {
  ApprovalFieldType,
  ApprovalFillRule,
  ApprovalTableColumn,
  ApprovalFieldDef,
} from "@/lib/approval/fields";

export interface ApprovalFormFolder {
  folderId: string;
  name: string;
  sortOrder: number;
}

export interface ApprovalForm {
  formId: string;
  folderId: string | null;
  name: string;
  description: string | null;
  fields: ApprovalFieldDef[];
  docNoRule: string | null;
  retentionYears: number | null;
  orgFolder: string | null;
  deptFolder: string | null;
  autoLine: unknown | null;
  mobileAllowed: boolean;
  useYn: boolean;
  version: number;
  sortOrder: number;
  updatedAt: string;
}

function mapForm(r: Record<string, unknown>): ApprovalForm {
  return {
    formId: String(r.form_id ?? ""),
    folderId: r.folder_id != null ? String(r.folder_id) : null,
    name: String(r.name ?? ""),
    description: r.description != null ? String(r.description) : null,
    fields: parseFields(r.fields),
    docNoRule: r.doc_no_rule != null ? String(r.doc_no_rule) : null,
    retentionYears: r.retention_years != null ? Number(r.retention_years) : null,
    orgFolder: r.org_folder != null ? String(r.org_folder) : null,
    deptFolder: r.dept_folder != null ? String(r.dept_folder) : null,
    autoLine: r.auto_line ?? null,
    mobileAllowed: Number(r.mobile_allowed ?? 1) === 1,
    useYn: Number(r.use_yn ?? 1) === 1,
    version: Number(r.version ?? 1),
    sortOrder: Number(r.sort_order ?? 0),
    updatedAt: String(r.updated_at ?? ""),
  };
}

export async function listFolders(): Promise<ApprovalFormFolder[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT folder_id, name, sort_order FROM approval_form_folders ORDER BY sort_order, name")
  );
  return rows.map((r) => ({
    folderId: String(r.folder_id ?? ""),
    name: String(r.name ?? ""),
    sortOrder: Number(r.sort_order ?? 0),
  }));
}

export async function saveFolder(params: { folderId: string | null; name: string; sortOrder?: number }): Promise<string> {
  const folderId = params.folderId ?? "fld-" + crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO approval_form_folders (folder_id, name, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (folder_id) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, updated_at = EXCLUDED.updated_at`,
      [folderId, params.name.trim(), params.sortOrder ?? 0, now]
    );
  });
  return folderId;
}

export async function listForms(includeDisabled = false): Promise<ApprovalForm[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT * FROM approval_forms ${includeDisabled ? "" : "WHERE use_yn = 1"} ORDER BY sort_order, name`
    )
  );
  return rows.map(mapForm);
}

export async function getForm(formId: string): Promise<ApprovalForm | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec("SELECT * FROM approval_forms WHERE form_id = $1", [formId]));
  return rows.length ? mapForm(rows[0]) : null;
}

/** 양식 저장 — 필드가 바뀌면 version 증가 + 스냅샷 기록(기존 문서는 제출 당시 버전으로 렌더). */
export async function saveForm(params: {
  formId: string | null;
  folderId: string | null;
  name: string;
  description: string | null;
  fields: ApprovalFieldDef[];
  docNoRule: string | null;
  retentionYears: number | null;
  orgFolder: string | null;
  deptFolder: string | null;
  useYn: boolean;
  actorUserId: string | null;
}): Promise<ApprovalForm> {
  const err = validateFields(params.fields);
  if (err) throw new Error(err);
  const formId = params.formId ?? "frm-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const now = new Date().toISOString();
  const prior = params.formId ? await getForm(params.formId) : null;
  const fieldsChanged = !prior || JSON.stringify(prior.fields) !== JSON.stringify(params.fields);
  const nextVersion = prior ? (fieldsChanged ? prior.version + 1 : prior.version) : 1;

  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO approval_forms
         (form_id, folder_id, name, description, fields, doc_no_rule, retention_years,
          org_folder, dept_folder, use_yn, version, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $13)
       ON CONFLICT (form_id) DO UPDATE SET
         folder_id = EXCLUDED.folder_id,
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         fields = EXCLUDED.fields,
         doc_no_rule = EXCLUDED.doc_no_rule,
         retention_years = EXCLUDED.retention_years,
         org_folder = EXCLUDED.org_folder,
         dept_folder = EXCLUDED.dept_folder,
         use_yn = EXCLUDED.use_yn,
         version = EXCLUDED.version,
         updated_at = EXCLUDED.updated_at`,
      [
        formId,
        params.folderId,
        params.name.trim(),
        params.description,
        JSON.stringify(params.fields),
        params.docNoRule,
        params.retentionYears,
        params.orgFolder,
        params.deptFolder,
        params.useYn ? 1 : 0,
        nextVersion,
        params.actorUserId,
        now,
      ]
    );
    if (fieldsChanged) {
      await txn.run(
        `INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_by = EXCLUDED.saved_by, saved_at = EXCLUDED.saved_at`,
        [formId, nextVersion, JSON.stringify(params.fields), params.actorUserId, now]
      );
    }
  });
  const saved = await getForm(formId);
  if (!saved) throw new Error("양식 저장에 실패했습니다.");
  return saved;
}
