import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export const ISSUE_KINDS = [
  { value: "permit_condition", label: "허가조건 강화" },
  { value: "contact_change", label: "발주처/허가기관 담당자 변경" },
  { value: "accident", label: "사업장 사고 발생" },
  { value: "doc_missing", label: "중요 서류 누락" },
  { value: "schedule_delay", label: "일정 지연" },
  { value: "other", label: "기타" },
] as const;

export interface IssueAttachment {
  attachmentId: string;
  fileName: string;
  publicPath: string | null;
  byteSize: number | null;
  contentType: string | null;
}

export interface IssueRow {
  issueId: string;
  contractId: string | null;
  issueKind: string;
  description: string | null;
  occurredOn: string | null;
  severity: string;
  responsePlan: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
  status: string;
  createdAt: string;
  attachments: IssueAttachment[];
}

// 이슈 목록 쿼리에 첨부파일 JSON 집계를 더하는 SELECT 조각.
const ISSUE_ATTACH_SELECT = `,
       COALESCE((SELECT json_agg(json_build_object(
                  'attachmentId', a.attachment_id, 'fileName', a.file_name,
                  'publicPath', a.public_path, 'byteSize', a.byte_size, 'contentType', a.content_type)
                  ORDER BY a.created_at)
                FROM work_plan_issue_attachments a WHERE a.issue_id = work_plan_issues.issue_id), '[]'::json) AS attachments`;

function mapAttachments(value: unknown): IssueAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.map((a) => {
    const o = a as Record<string, unknown>;
    return {
      attachmentId: String(o.attachmentId ?? ""),
      fileName: String(o.fileName ?? ""),
      publicPath: o.publicPath != null ? String(o.publicPath) : null,
      byteSize: o.byteSize != null ? Number(o.byteSize) : null,
      contentType: o.contentType != null ? String(o.contentType) : null,
    };
  });
}

export interface IssueInput {
  issueKind: string;
  description?: string | null;
  occurredOn?: string | null;
  severity?: string;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export async function listContractIssues(contractId: string): Promise<IssueRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT issue_id, contract_id, issue_kind, description, occurred_on, severity,
            response_plan, responded_by, responded_at, status, created_at${ISSUE_ATTACH_SELECT}
       FROM work_plan_issues
      WHERE contract_id = $1
      ORDER BY created_at DESC`,
    [contractId]
  );
  return rowsToObjects(result).map((row) => ({
    issueId: String(row.issue_id ?? ""),
    contractId: row.contract_id != null ? String(row.contract_id) : null,
    issueKind: String(row.issue_kind ?? "other"),
    description: row.description != null ? String(row.description) : null,
    occurredOn: row.occurred_on != null ? String(row.occurred_on) : null,
    severity: String(row.severity ?? "warn"),
    responsePlan: row.response_plan != null ? String(row.response_plan) : null,
    respondedBy: row.responded_by != null ? String(row.responded_by) : null,
    respondedAt: row.responded_at != null ? String(row.responded_at) : null,
    status: String(row.status ?? "open"),
    createdAt: String(row.created_at ?? ""),
    attachments: mapAttachments(row.attachments),
  }));
}

export async function listTaskIssues(taskId: string): Promise<IssueRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT issue_id, contract_id, issue_kind, description, occurred_on, severity,
            response_plan, responded_by, responded_at, status, created_at${ISSUE_ATTACH_SELECT}
       FROM work_plan_issues
      WHERE task_id = $1
      ORDER BY created_at DESC`,
    [taskId]
  );
  return rowsToObjects(result).map((row) => ({
    issueId: String(row.issue_id ?? ""),
    contractId: row.contract_id != null ? String(row.contract_id) : null,
    issueKind: String(row.issue_kind ?? "other"),
    description: row.description != null ? String(row.description) : null,
    occurredOn: row.occurred_on != null ? String(row.occurred_on) : null,
    severity: String(row.severity ?? "warn"),
    responsePlan: row.response_plan != null ? String(row.response_plan) : null,
    respondedBy: row.responded_by != null ? String(row.responded_by) : null,
    respondedAt: row.responded_at != null ? String(row.responded_at) : null,
    status: String(row.status ?? "open"),
    createdAt: String(row.created_at ?? ""),
    attachments: mapAttachments(row.attachments),
  }));
}

export async function createTaskIssue(
  actorUserId: string,
  taskId: string,
  input: IssueInput
): Promise<string> {
  const issueId = id("wpi_issue");
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO work_plan_issues
         (issue_id, task_id, issue_kind, description, occurred_on, severity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $8)`,
      [issueId, taskId, input.issueKind || "other", input.description || null, input.occurredOn || null, input.severity || "warn", actorUserId, now]
    );
  });
  return issueId;
}

export async function createIssue(
  actorUserId: string,
  contractId: string,
  input: IssueInput
): Promise<string> {
  const issueId = id("wpi_issue");
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO work_plan_issues
         (issue_id, contract_id, issue_kind, description, occurred_on, severity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $8)`,
      [
        issueId,
        contractId,
        input.issueKind || "other",
        input.description || null,
        input.occurredOn || null,
        input.severity || "warn",
        actorUserId,
        now,
      ]
    );
  });
  return issueId;
}

/** 부서장 대응방안 입력 + 상태 갱신. */
export async function setIssueResponse(
  actorUserId: string,
  issueId: string,
  responsePlan: string | null,
  status: string
): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE work_plan_issues
          SET response_plan = $1, responded_by = $2, responded_at = $3, status = $4, updated_at = $3
        WHERE issue_id = $5`,
      [responsePlan || null, actorUserId, now, status || "in_progress", issueId]
    );
  });
}

export async function deleteIssue(issueId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run("DELETE FROM work_plan_issues WHERE issue_id = $1", [issueId]);
  });
}

/** 첨부 S3 키 생성을 위한 이슈의 대상(용역/Task) 조회. */
export async function getIssueSubject(issueId: string): Promise<{ kind: "contract" | "task"; id: string } | null> {
  const db = await getDb();
  const r = await db.exec("SELECT contract_id, task_id FROM work_plan_issues WHERE issue_id = $1 LIMIT 1", [issueId]);
  const row = rowsToObjects(r)[0];
  if (!row) return null;
  if (row.task_id != null) return { kind: "task", id: String(row.task_id) };
  if (row.contract_id != null) return { kind: "contract", id: String(row.contract_id) };
  return null;
}

export async function listIssueAttachments(issueId: string): Promise<IssueAttachment[]> {
  const db = await getDb();
  const r = await db.exec(
    `SELECT attachment_id, file_name, public_path, byte_size, content_type
       FROM work_plan_issue_attachments WHERE issue_id = $1 ORDER BY created_at ASC`,
    [issueId]
  );
  return rowsToObjects(r).map((row) => ({
    attachmentId: String(row.attachment_id ?? ""),
    fileName: String(row.file_name ?? ""),
    publicPath: row.public_path != null ? String(row.public_path) : null,
    byteSize: row.byte_size != null ? Number(row.byte_size) : null,
    contentType: row.content_type != null ? String(row.content_type) : null,
  }));
}

export async function addIssueAttachment(
  actorUserId: string,
  issueId: string,
  input: {
    fileName: string;
    contentType: string;
    byteSize: number;
    sha256: string;
    storageProvider: string;
    storageBucket: string | null;
    storageKey: string;
    publicPath: string;
  }
): Promise<string> {
  const attachmentId = id("wpia");
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO work_plan_issue_attachments
         (attachment_id, issue_id, file_name, content_type, byte_size, sha256,
          storage_provider, storage_bucket, storage_key, public_path, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [attachmentId, issueId, input.fileName, input.contentType, input.byteSize, input.sha256,
       input.storageProvider, input.storageBucket, input.storageKey, input.publicPath, actorUserId, now]
    );
  });
  return attachmentId;
}

/** 첨부 삭제 — DB 행 제거 후 S3 정리를 위해 storage_key 반환. */
export async function deleteIssueAttachment(attachmentId: string): Promise<string | null> {
  const db = await getDb();
  const r = await db.exec("SELECT storage_key FROM work_plan_issue_attachments WHERE attachment_id = $1 LIMIT 1", [attachmentId]);
  const key = rowsToObjects(r)[0]?.storage_key;
  await withDbWrite(async (wdb) => {
    await wdb.run("DELETE FROM work_plan_issue_attachments WHERE attachment_id = $1", [attachmentId]);
  });
  return key != null ? String(key) : null;
}
