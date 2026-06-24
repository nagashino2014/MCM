import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { categoryCaseSql } from "./contracts";
import type {
  ContractReceivableRow,
  ContractReceivablesStatus,
  ReceivableAction,
  ReceivableActionDocument,
  ReceivableActionType,
} from "./receivables-types";

// 클라이언트 공용 타입·상수는 receivables-types.ts 에 정의하고 여기서 재노출한다.
export * from "./receivables-types";

// ---------------------------------------------------------------------------
// 수주/수금/발행 현황 — 미수금 현황 (발행 완료 + 수금 미완료 단계 리스트)
// 용역분류/경과기간 필터링은 클라이언트 및 export 라우트에서 공통으로 수행한다.
// ---------------------------------------------------------------------------

/** 달력 기준 경과 개월 수 (계약 관리 페이지 monthsBetween 과 동일 규칙) */
function calendarMonthsBetween(fromIso: string, to: Date): number {
  const from = new Date(fromIso + "T00:00:00");
  if (Number.isNaN(from.getTime())) return 0;
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

export async function getContractReceivablesStatus(
  contractIds?: string[] | null
): Promise<ContractReceivablesStatus> {
  const db = await getDb();
  const catCase = categoryCaseSql("c.service_type");

  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id,
              c.contract_title,
              f.company_name AS counterparty_name,
              ${catCase} AS category,
              m.milestone_id,
              m.stage_label,
              NULLIF(m.payment_terms, '') AS payment_terms,
              SUBSTRING(m.invoice_issued_at, 1, 10) AS invoice_issued_at,
              COALESCE(m.invoice_amount, m.amount, 0) AS invoice_amount,
              COALESCE(m.collected_amount, 0) AS partial_collected
       FROM contract_payment_milestones m
       JOIN contracts c ON c.contract_id = m.contract_id
       LEFT JOIN facilities f ON f.facility_id = c.counterparty_facility_id
       WHERE c.deleted_at IS NULL
         AND m.invoice_issued = 1
         AND m.payment_collected = 0
         AND COALESCE(m.invoice_amount, m.amount, 0) > 0${contractIds ? " AND c.contract_id = ANY($1)" : ""}
       ORDER BY m.invoice_issued_at ASC NULLS LAST, c.contract_title ASC`,
      contractIds ? [contractIds] : []
    )
  );

  // 대응 조치 건수/유형 — 마이그레이션(023) 미적용 환경에서도 리스트는 동작하도록 분리 조회
  const actionCounts = new Map<string, number>();
  const actionTypesByMilestone = new Map<string, ReceivableActionType[]>();
  try {
    const countRows = rowsToObjects(
      await db.exec(
        `SELECT milestone_id, action_type, COUNT(*) AS cnt FROM receivable_actions GROUP BY 1, 2`
      )
    );
    for (const r of countRows) {
      const milestoneId = String(r.milestone_id ?? "");
      actionCounts.set(milestoneId, (actionCounts.get(milestoneId) ?? 0) + toNumber(r.cnt));
      const types = actionTypesByMilestone.get(milestoneId) ?? [];
      const type = String(r.action_type ?? "") as ReceivableActionType;
      if (type && !types.includes(type)) types.push(type);
      actionTypesByMilestone.set(milestoneId, types);
    }
  } catch {
    // receivable_actions 테이블이 아직 없으면 0건으로 처리
  }

  const now = new Date();
  const nowMs = now.getTime();
  const mapped: ContractReceivableRow[] = [];
  for (const r of rows) {
    const issuedAt = r.invoice_issued_at != null ? String(r.invoice_issued_at) : null;
    const invoiceAmount = toNumber(r.invoice_amount);
    const outstanding = Math.max(0, invoiceAmount - toNumber(r.partial_collected));
    if (outstanding <= 0) continue;
    let agingDays = 0;
    let agingMonths = 0;
    if (issuedAt) {
      const t = Date.parse(issuedAt);
      if (Number.isFinite(t)) agingDays = Math.max(0, Math.floor((nowMs - t) / (1000 * 60 * 60 * 24)));
      agingMonths = calendarMonthsBetween(issuedAt, now);
    }
    const milestoneId = String(r.milestone_id ?? "");
    mapped.push({
      contractId: String(r.contract_id ?? ""),
      contractTitle: String(r.contract_title ?? ""),
      counterpartyName: String(r.counterparty_name ?? ""),
      category: String(r.category ?? "기타 용역"),
      milestoneId,
      stageLabel: String(r.stage_label ?? ""),
      paymentTerms: r.payment_terms != null ? String(r.payment_terms) : null,
      invoiceIssuedAt: issuedAt,
      invoiceAmount,
      outstandingAmount: outstanding,
      agingDays,
      agingMonths,
      actionCount: actionCounts.get(milestoneId) ?? 0,
      actionTypes: actionTypesByMilestone.get(milestoneId) ?? [],
    });
  }

  return { rows: mapped };
}

// ---------------------------------------------------------------------------
// 장기 미수금 대응 조치 (구두 독촉 / 내용 증명 발송 / 채권 추심 진행)
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function toAction(r: Record<string, unknown>, documents: ReceivableActionDocument[]): ReceivableAction {
  let stageDates: Record<string, string> | null = null;
  const raw = r.stage_dates_json;
  if (raw != null) {
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        stageDates = parsed as Record<string, string>;
      }
    } catch {
      stageDates = null;
    }
  }
  return {
    actionId: String(r.action_id ?? ""),
    contractId: String(r.contract_id ?? ""),
    milestoneId: String(r.milestone_id ?? ""),
    actionType: String(r.action_type ?? "verbal_dunning") as ReceivableActionType,
    actionDate: r.action_date != null ? String(r.action_date) : null,
    progressNote: String(r.progress_note ?? ""),
    progressStage: r.progress_stage != null ? String(r.progress_stage) : null,
    stageDates,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    documents,
  };
}

export async function listReceivableActions(milestoneId: string): Promise<ReceivableAction[]> {
  const db = await getDb();
  const actionRows = rowsToObjects(
    await db.exec(
      `SELECT * FROM receivable_actions WHERE milestone_id = $1 ORDER BY action_date ASC NULLS LAST, created_at ASC`,
      [milestoneId]
    )
  );
  if (actionRows.length === 0) return [];

  const docRows = rowsToObjects(
    await db.exec(
      `SELECT d.* FROM receivable_action_documents d
       JOIN receivable_actions a ON a.action_id = d.action_id
       WHERE a.milestone_id = $1
       ORDER BY d.created_at ASC`,
      [milestoneId]
    )
  );
  const docsByAction = new Map<string, ReceivableActionDocument[]>();
  for (const d of docRows) {
    const actionId = String(d.action_id ?? "");
    const list = docsByAction.get(actionId) ?? [];
    list.push({
      documentId: String(d.document_id ?? ""),
      fileName: String(d.file_name ?? ""),
      byteSize: d.byte_size != null ? toNumber(d.byte_size) : null,
      publicPath: d.public_path != null ? String(d.public_path) : null,
      createdAt: String(d.created_at ?? ""),
    });
    docsByAction.set(actionId, list);
  }

  return actionRows.map((r) => toAction(r, docsByAction.get(String(r.action_id ?? "")) ?? []));
}

export async function createReceivableAction(input: {
  contractId: string;
  milestoneId: string;
  actionType: ReceivableActionType;
  actionDate: string | null;
  progressNote: string;
  progressStage: string | null;
  stageDates: Record<string, string> | null;
}): Promise<string> {
  const actionId = "rca_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const ts = nowIso();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO receivable_actions
         (action_id, contract_id, milestone_id, action_type, action_date, progress_note, progress_stage, stage_dates_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        actionId,
        input.contractId,
        input.milestoneId,
        input.actionType,
        input.actionDate,
        input.progressNote,
        input.progressStage,
        input.stageDates ? JSON.stringify(input.stageDates) : null,
        ts,
        ts,
      ]
    );
  });
  return actionId;
}

export async function updateReceivableAction(
  actionId: string,
  patch: {
    actionDate?: string | null;
    progressNote?: string;
    progressStage?: string | null;
    stageDates?: Record<string, string> | null;
  }
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (patch.actionDate !== undefined) {
    sets.push(`action_date = $${i++}`);
    params.push(patch.actionDate);
  }
  if (patch.progressNote !== undefined) {
    sets.push(`progress_note = $${i++}`);
    params.push(patch.progressNote);
  }
  if (patch.progressStage !== undefined) {
    sets.push(`progress_stage = $${i++}`);
    params.push(patch.progressStage);
  }
  if (patch.stageDates !== undefined) {
    sets.push(`stage_dates_json = $${i++}`);
    params.push(patch.stageDates ? JSON.stringify(patch.stageDates) : null);
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = $${i++}`);
  params.push(nowIso());
  params.push(actionId);
  await withDbWrite(async (db) => {
    await db.run(`UPDATE receivable_actions SET ${sets.join(", ")} WHERE action_id = $${i}`, params);
  });
}

export async function deleteReceivableAction(actionId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM receivable_actions WHERE action_id = $1`, [actionId]);
  });
}

export async function getReceivableActionById(
  actionId: string
): Promise<{ actionId: string; contractId: string; milestoneId: string; actionType: ReceivableActionType } | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT action_id, contract_id, milestone_id, action_type FROM receivable_actions WHERE action_id = $1`, [actionId])
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    actionId: String(r.action_id ?? ""),
    contractId: String(r.contract_id ?? ""),
    milestoneId: String(r.milestone_id ?? ""),
    actionType: String(r.action_type ?? "verbal_dunning") as ReceivableActionType,
  };
}

export async function addReceivableActionDocument(input: {
  actionId: string;
  fileName: string;
  contentType: string | null;
  byteSize: number;
  storageProvider: string;
  storageBucket: string | null;
  storageKey: string;
  publicPath: string;
}): Promise<ReceivableActionDocument> {
  const documentId = "rcd_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const ts = nowIso();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO receivable_action_documents
         (document_id, action_id, file_name, content_type, byte_size, storage_provider, storage_bucket, storage_key, public_path, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        documentId,
        input.actionId,
        input.fileName,
        input.contentType,
        input.byteSize,
        input.storageProvider,
        input.storageBucket,
        input.storageKey,
        input.publicPath,
        ts,
      ]
    );
  });
  return {
    documentId,
    fileName: input.fileName,
    byteSize: input.byteSize,
    publicPath: input.publicPath,
    createdAt: ts,
  };
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
