/**
 * 대행 실적 보고 이력 — contract_agency_reports (마이그 252).
 *
 * 대기열(regulatory_filings)이 "무엇을 신고해야 하는가"라면 이 표는 "무엇을 신고했는가"다.
 * IEPS 에서 체결·변경·완료 신고를 마치고 실적보고 출력(PDF)을 받아 계약 상세의 대행 실적 보고 카드에 쌓는다.
 * 대기열에서 제출 완료로 처리하면 이력이 자동으로 1건 생기고(filing_id 연결), 신고서 PDF 는 계약 상세에서 붙인다.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import type {
  AgencyReportKind,
  AgencyReportRow,
  ReportDeliveryMode,
  ReportDeliveryRecipient,
  ReportDeliveryStatus,
} from "./types";
import { AGENCY_REPORT_KINDS, REPORT_DELIVERY_MODES } from "./types";

const str = (v: unknown): string => (v == null ? "" : String(v));
const nullable = (v: unknown): string | null => {
  const s = str(v).trim();
  return s ? s : null;
};

const nowIso = (): string => new Date().toISOString();
const newReportId = (): string => "agr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

/** 카드 표시 순서 — 체결 → 변경(신고일 오름차순) → 완료 */
const KIND_ORDER: Record<AgencyReportKind, number> = { conclude: 0, amend: 1, complete: 2 };

export function isAgencyReportKind(v: unknown): v is AgencyReportKind {
  return AGENCY_REPORT_KINDS.includes(v as AgencyReportKind);
}

export function isReportDeliveryMode(v: unknown): v is ReportDeliveryMode {
  return REPORT_DELIVERY_MODES.includes(v as ReportDeliveryMode);
}

const SELECT_REPORT = `
  SELECT r.report_id, r.contract_id, r.report_kind, r.reported_on, r.receipt_no, r.note,
         r.filing_id, r.document_id, r.created_by, r.created_at, r.updated_at,
         r.delivery_mode, r.delivery_status, r.delivered_at, r.delivery_detail,
         d.display_name AS document_name, d.storage_key AS document_key,
         u.name AS created_by_name
    FROM contract_agency_reports r
    LEFT JOIN contract_documents d ON d.document_id = r.document_id
    LEFT JOIN users u ON u.user_id = r.created_by`;

function rowToReport(r: Record<string, unknown>): AgencyReportRow {
  const key = str(r.document_key);
  const detail = (r.delivery_detail && typeof r.delivery_detail === "object" ? r.delivery_detail : {}) as {
    recipients?: ReportDeliveryRecipient[];
    error?: string | null;
  };
  const mode = str(r.delivery_mode);
  return {
    reportId: String(r.report_id),
    contractId: String(r.contract_id),
    reportKind: String(r.report_kind) as AgencyReportKind,
    reportedOn: str(r.reported_on),
    receiptNo: nullable(r.receipt_no),
    note: nullable(r.note),
    deliveryMode: isReportDeliveryMode(mode) ? mode : null,
    deliveryStatus: (nullable(r.delivery_status) as ReportDeliveryStatus | null) ?? null,
    deliveredAt: nullable(r.delivered_at),
    deliveryRecipients: Array.isArray(detail.recipients) ? detail.recipients : [],
    deliveryError: detail.error ?? null,
    filingId: nullable(r.filing_id),
    documentId: nullable(r.document_id),
    documentName: nullable(r.document_name),
    documentPath: key ? `/api/contracts/documents?key=${encodeURIComponent(key)}` : null,
    createdBy: nullable(r.created_by),
    createdByName: nullable(r.created_by_name),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

/** 계약 1건의 신고 이력 — 체결 → 변경 → 완료 순, 같은 구분은 신고일 오름차순. */
export async function listAgencyReports(contractId: string): Promise<AgencyReportRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`${SELECT_REPORT} WHERE r.contract_id = $1`, [contractId]));
  return rows
    .map(rowToReport)
    .sort(
      (a, b) =>
        KIND_ORDER[a.reportKind] - KIND_ORDER[b.reportKind] ||
        a.reportedOn.localeCompare(b.reportedOn) ||
        a.createdAt.localeCompare(b.createdAt)
    );
}

export async function getAgencyReport(reportId: string): Promise<AgencyReportRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`${SELECT_REPORT} WHERE r.report_id = $1 LIMIT 1`, [reportId]));
  return rows[0] ? rowToReport(rows[0]) : null;
}

export interface AgencyReportInput {
  reportKind: AgencyReportKind;
  reportedOn: string;
  receiptNo?: string | null;
  note?: string | null;
  documentId?: string | null;
  filingId?: string | null;
}

/** 이력 추가 — 신고서 PDF 는 나중에 붙일 수 있으므로 documentId 는 선택. */
export async function createAgencyReport(
  contractId: string,
  input: AgencyReportInput,
  actorUserId: string | null,
  db?: PgDatabase
): Promise<string> {
  const reportId = newReportId();
  const now = nowIso();
  const run = async (conn: PgDatabase) => {
    await conn.run(
      `INSERT INTO contract_agency_reports
         (report_id, contract_id, report_kind, reported_on, receipt_no, note,
          document_id, filing_id, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [
        reportId,
        contractId,
        input.reportKind,
        input.reportedOn,
        nullable(input.receiptNo),
        nullable(input.note),
        nullable(input.documentId),
        nullable(input.filingId),
        actorUserId,
        now,
      ]
    );
  };
  if (db) await run(db);
  else await withDbWrite(run);
  return reportId;
}

export interface AgencyReportPatch {
  reportKind?: AgencyReportKind;
  reportedOn?: string;
  receiptNo?: string | null;
  note?: string | null;
  /** null 이면 첨부 해제(문서 자체는 지우지 않는다) */
  documentId?: string | null;
}

export async function updateAgencyReport(reportId: string, patch: AgencyReportPatch): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (col: string, value: unknown) => {
    values.push(value);
    sets.push(`${col} = $${values.length}`);
  };
  if (patch.reportKind !== undefined) push("report_kind", patch.reportKind);
  if (patch.reportedOn !== undefined) push("reported_on", patch.reportedOn);
  if (patch.receiptNo !== undefined) push("receipt_no", nullable(patch.receiptNo));
  if (patch.note !== undefined) push("note", nullable(patch.note));
  if (patch.documentId !== undefined) push("document_id", patch.documentId ?? null);
  if (sets.length === 0) return;
  push("updated_at", nowIso());
  values.push(reportId);
  await withDbWrite(async (db) => {
    await db.run(`UPDATE contract_agency_reports SET ${sets.join(", ")} WHERE report_id = $${values.length}`, values);
  });
}

export async function deleteAgencyReport(reportId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM contract_agency_reports WHERE report_id = $1`, [reportId]);
  });
}

/**
 * 대기열 제출 완료 → 이력 자동 기록. 같은 filing_id 로 두 번 들어오지 않는다(부분 UNIQUE 인덱스).
 * 대행 실적 보고(ieps_agency)만 대상이고, 신고서 PDF 는 계약 상세에서 붙인다.
 */
export async function recordAgencyReportFromFiling(
  db: PgDatabase,
  filing: {
    filingId: string;
    contractId: string | null;
    triggerKind: string;
    reportedOn: string;
    receiptNo: string | null;
    deliveryMode?: ReportDeliveryMode | null;
  },
  actorUserId: string | null
): Promise<boolean> {
  if (!filing.contractId || !isAgencyReportKind(filing.triggerKind)) return false;
  const now = nowIso();
  await db.run(
    `INSERT INTO contract_agency_reports
       (report_id, contract_id, report_kind, reported_on, receipt_no, note,
        document_id, filing_id, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7, $8, $8)
     ON CONFLICT (filing_id) WHERE filing_id IS NOT NULL
     DO UPDATE SET reported_on = EXCLUDED.reported_on,
                   receipt_no = COALESCE(EXCLUDED.receipt_no, contract_agency_reports.receipt_no),
                   updated_at = EXCLUDED.updated_at`,
    [newReportId(), filing.contractId, filing.triggerKind, filing.reportedOn, nullable(filing.receiptNo), filing.filingId, actorUserId, now]
  );
  if (filing.deliveryMode && isReportDeliveryMode(filing.deliveryMode)) {
    await db.run(`UPDATE contract_agency_reports SET delivery_mode = $2 WHERE filing_id = $1`, [
      filing.filingId,
      filing.deliveryMode,
    ]);
  }
  return true;
}
