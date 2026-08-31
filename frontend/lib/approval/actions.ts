import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { parseFields, resolveFieldConcept, type ApprovalFieldDef } from "@/lib/approval/fields";
import { closeAbsenceRequestConnector } from "@/lib/approval/absence";
import { queueCertificatesConnector } from "@/lib/approval/certificates";
import { incomeLedgerAppendConnector } from "@/lib/finance/income-ledger";
import {
  recordAppointmentsConnector,
  recordLeaveAbsenceConnector,
  recordResignationConnector,
} from "@/lib/approval/hr-actions";
import { recordLeavePayConnector } from "@/lib/approval/severance";

/*
 * 승인 액션 커넥터 레지스트리(FRM-P0, 201) — 양식 승인/상신 시 실행할 연계의 실행기.
 * 배선(어느 양식 → 어느 커넥터 → 어떤 필드 매핑)은 approval_form_actions 테이블(DB)이 담고,
 * 연계 로직 자체는 여기 등록된 커넥터(코드 화이트리스트)만 실행된다 — 임의 코드 실행 없음.
 *
 * 실행 원칙:
 *  - 결재 트랜잭션 커밋 후 별도 수행 — 액션 실패가 결재 자체를 되돌리지 않는다.
 *  - 성공은 approval_action_runs 에 ok 1행(부분 유니크 인덱스로 멱등), 실패는 failed 기록 후 재실행 가능.
 *  - field_map 값은 필드 key 또는 "semantic:<concept>" — 시맨틱 태그로 바인딩하면 양식을
 *    복제·개조해 필드 key 가 바뀌어도 연계가 유지된다(resolveFieldConcept).
 * 커넥터 추가는 각 단계 모듈에서 구현 후 이 파일 하단 ACTION_CONNECTORS 에 등록한다.
 */

export type ActionTrigger = "approved" | "submitted" | "rejected";

export interface ActionSlotDef {
  key: string;
  label: string;
  required?: boolean;
  /** 빌더 편집 UI 안내문(값 형태 등) */
  hint?: string;
}

/** 커넥터에 전달되는 실행 문맥 — 문서 스냅샷 + 매핑된 슬롯 값 접근자. */
export interface ActionRunContext {
  docId: string;
  formId: string;
  docNo: string | null;
  title: string;
  drafterUserId: string | null;
  drafterEmployeeId: string | null;
  drafterName: string | null;
  fieldValues: Record<string, unknown>;
  fields: ApprovalFieldDef[];
  config: Record<string, unknown>;
  /** field_map 을 해석해 슬롯 값 반환(미매핑/빈 값은 undefined) */
  slot: (key: string) => unknown;
  /** 슬롯이 매핑된 필드 정의(라벨·타입 참조용) */
  slotField: (key: string) => ApprovalFieldDef | undefined;
}

export interface ActionRunResult {
  /** 사람이 읽는 성공 요약(실행 로그에 표시) */
  detail: string;
  /** 생성 레코드 id 등 구조화 결과 */
  result?: Record<string, unknown>;
}

export interface ActionConnector {
  kind: string;
  label: string;
  description: string;
  slots: ActionSlotDef[];
  /** 커넥터 내부에서 withDbWrite 로 자체 트랜잭션을 연다(결재 트랜잭션과 분리). */
  run: (ctx: ActionRunContext) => Promise<ActionRunResult>;
  /** 드라이런(P7) — 아무것도 쓰지 않고 "실행되면 무슨 일이 일어나는지" 한 문장으로 설명한다. */
  preview?: (ctx: ActionRunContext) => Promise<string>;
}

function id(): string {
  return `far-${crypto.randomBytes(6).toString("hex")}`;
}

/* ---------- 슬롯 해석 ---------- */

function resolveSlotField(mapValue: string, fields: ApprovalFieldDef[]): ApprovalFieldDef | undefined {
  if (mapValue.startsWith("semantic:")) {
    const concept = mapValue.slice("semantic:".length).trim();
    return fields.find((f) => resolveFieldConcept(f) === concept);
  }
  return fields.find((f) => f.key === mapValue);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  try {
    const v = typeof value === "string" ? JSON.parse(value) : value;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/* ---------- 실행기 ---------- */

interface ActionRow {
  action_id: string;
  action_kind: string;
  field_map: unknown;
  config: unknown;
}

/**
 * 문서의 등록 액션 실행 — actOnDoc/submitDoc 커밋 후 호출. 절대 throw 하지 않는다.
 * 성공 멱등은 uq_action_runs_ok(부분 유니크)로 보장 — 이미 ok 인 액션은 건너뛴다.
 */
export async function runFormActionsForDoc(docId: string, trigger: ActionTrigger): Promise<void> {
  try {
    const db = await getDb();
    const docs = rowsToObjects(
      await db.exec(
        `SELECT d.doc_id, d.form_id, d.doc_no, d.title, d.drafter_user_id, d.drafter_employee_id, d.drafter_name,
                d.field_values, f.fields
           FROM approval_docs d JOIN approval_forms f ON f.form_id = d.form_id
          WHERE d.doc_id = $1`,
        [docId]
      )
    );
    if (!docs.length) return;
    const doc = docs[0];
    const actions = rowsToObjects(
      await db.exec(
        `SELECT a.action_id, a.action_kind, a.field_map, a.config
           FROM approval_form_actions a
          WHERE a.form_id = $1 AND a.trigger_on = $2 AND a.active = 1
       ORDER BY a.sort_order, a.created_at`,
        [String(doc.form_id), trigger]
      )
    ) as unknown as ActionRow[];
    if (!actions.length) return;

    const doneIds = new Set(
      rowsToObjects(await db.exec(`SELECT action_id FROM approval_action_runs WHERE doc_id = $1 AND status = 'ok'`, [docId])).map((r) =>
        String(r.action_id)
      )
    );
    const fields = parseFields(doc.fields);
    const fieldValues = parseJsonObject(doc.field_values);

    for (const action of actions) {
      if (doneIds.has(String(action.action_id))) continue;
      await runSingleAction(docId, doc, fields, fieldValues, action);
    }
  } catch {
    // 실행기 자체 실패(조회 등)는 결재 흐름에 영향 주지 않는다 — 재실행 API 로 복구.
  }
}

async function runSingleAction(
  docId: string,
  doc: Record<string, unknown>,
  fields: ApprovalFieldDef[],
  fieldValues: Record<string, unknown>,
  action: ActionRow
): Promise<void> {
  const now = new Date().toISOString();
  const fieldMap = parseJsonObject(action.field_map);
  const config = parseJsonObject(action.config);
  const slotField = (key: string): ApprovalFieldDef | undefined => {
    const mapped = fieldMap[key];
    return typeof mapped === "string" && mapped ? resolveSlotField(mapped, fields) : undefined;
  };
  const ctx: ActionRunContext = {
    docId,
    formId: String(doc.form_id),
    docNo: doc.doc_no != null ? String(doc.doc_no) : null,
    title: String(doc.title ?? ""),
    drafterUserId: doc.drafter_user_id != null ? String(doc.drafter_user_id) : null,
    drafterEmployeeId: doc.drafter_employee_id != null ? String(doc.drafter_employee_id) : null,
    drafterName: doc.drafter_name != null ? String(doc.drafter_name) : null,
    fieldValues,
    fields,
    config,
    slot: (key) => {
      const f = slotField(key);
      if (!f) return undefined;
      const v = fieldValues[f.key];
      return v === "" || v == null ? undefined : v;
    },
    slotField,
  };

  const connector = ACTION_CONNECTORS.find((c) => c.kind === String(action.action_kind));
  let status: "ok" | "failed" = "ok";
  let detail = "";
  let result: Record<string, unknown> | undefined;
  if (!connector) {
    status = "failed";
    detail = `등록되지 않은 커넥터: ${action.action_kind}`;
  } else {
    try {
      const missing = connector.slots.filter((s) => s.required && ctx.slot(s.key) === undefined).map((s) => s.label);
      if (missing.length) throw new Error(`필수 슬롯 값 없음: ${missing.join(", ")}`);
      const r = await connector.run(ctx);
      detail = r.detail;
      result = r.result;
    } catch (err) {
      status = "failed";
      detail = err instanceof Error ? err.message : String(err);
    }
  }

  try {
    await withDbWrite(async (txn) => {
      await txn.run(
        `INSERT INTO approval_action_runs (run_id, action_id, doc_id, status, detail, result, ran_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [id(), String(action.action_id), docId, status, detail || null, result ? JSON.stringify(result) : null, now]
      );
    });
  } catch {
    // 로그 기록 실패는 무시(액션 자체는 이미 수행됨 — 성공 멱등은 대상 테이블 중복 체크가 2차 방어)
  }
}

/**
 * 실패 액션 재실행 — 관리자용. ok 가 없는 액션만 다시 돈다(성공분은 멱등 skip).
 * 문서가 실제로 도달한 트리거만 실행한다 — 미승인 문서에 approved 액션(소득원장·
 * 인사이벤트·계정 비활성화 등)이 돌면 안 된다. 반려 문서도 상신은 거쳤으므로
 * submitted 와 rejected 트리거는 재실행 대상이다(draft 만 no-op).
 */
export async function rerunFormActions(docId: string): Promise<{ reran: boolean }> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT status FROM approval_docs WHERE doc_id = $1`, [docId]));
  const status = rows.length ? String(rows[0].status) : "";
  const triggers: ActionTrigger[] =
    status === "approved" ? ["approved", "submitted"]
    : status === "rejected" ? ["rejected", "submitted"]
    : status === "in_progress" ? ["submitted"]
    : [];
  for (const t of triggers) await runFormActionsForDoc(docId, t);
  return { reran: triggers.length > 0 };
}

export interface ActionRunLog {
  runId: string;
  actionId: string;
  actionKind: string;
  actionLabel: string;
  status: string;
  detail: string | null;
  ranAt: string;
}

/** 문서별 액션 실행 로그(최신순) — 문서 상세·관리 화면 표시용. */
export async function listActionRuns(docId: string): Promise<ActionRunLog[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT r.run_id, r.action_id, r.status, r.detail, r.ran_at, a.action_kind
         FROM approval_action_runs r JOIN approval_form_actions a ON a.action_id = r.action_id
        WHERE r.doc_id = $1 ORDER BY r.ran_at DESC`,
      [docId]
    )
  );
  return rows.map((r) => {
    const kind = String(r.action_kind);
    return {
      runId: String(r.run_id),
      actionId: String(r.action_id),
      actionKind: kind,
      actionLabel: ACTION_CONNECTORS.find((c) => c.kind === kind)?.label ?? kind,
      status: String(r.status),
      detail: r.detail != null ? String(r.detail) : null,
      ranAt: String(r.ran_at),
    };
  });
}

/* ---------- 연계 설정 CRUD + 드라이런(P7 — 빌더 "연계" 탭) ---------- */

export interface FormActionConfig {
  actionId: string | null; // 신규는 null
  actionKind: string;
  triggerOn: ActionTrigger;
  fieldMap: Record<string, string>;
  active: boolean;
  sortOrder: number;
}

/** 커넥터 카탈로그(빌더 편집 UI 용) — 코드 화이트리스트를 직렬화. */
export function listConnectorCatalog(): Array<{ kind: string; label: string; description: string; slots: ActionSlotDef[]; hasPreview: boolean }> {
  return ACTION_CONNECTORS.map((c) => ({
    kind: c.kind,
    label: c.label,
    description: c.description,
    slots: c.slots,
    hasPreview: !!c.preview,
  }));
}

export async function listFormActions(formId: string): Promise<FormActionConfig[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT action_id, action_kind, trigger_on, field_map, active, sort_order
         FROM approval_form_actions WHERE form_id = $1 ORDER BY sort_order, created_at`,
      [formId]
    )
  );
  return rows.map((r) => ({
    actionId: String(r.action_id),
    actionKind: String(r.action_kind),
    triggerOn: (["approved", "submitted", "rejected"].includes(String(r.trigger_on)) ? String(r.trigger_on) : "approved") as ActionTrigger,
    fieldMap: Object.fromEntries(
      Object.entries(parseJsonObject(r.field_map)).map(([k, v]) => [k, String(v ?? "")])
    ),
    active: Number(r.active ?? 0) === 1,
    sortOrder: Number(r.sort_order ?? 0),
  }));
}

/** 양식의 연계 설정 전체 동기화 — 목록에 없는 기존 액션은 삭제(실행 이력도 CASCADE 삭제, UI 에서 confirm). */
export async function saveFormActions(formId: string, items: FormActionConfig[]): Promise<FormActionConfig[]> {
  const validKinds = new Set(ACTION_CONNECTORS.map((c) => c.kind));
  for (const item of items) {
    if (!validKinds.has(item.actionKind)) throw new Error(`등록되지 않은 커넥터입니다: ${item.actionKind}`);
    if (!["approved", "submitted", "rejected"].includes(item.triggerOn)) throw new Error("트리거가 올바르지 않습니다.");
  }
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    const keepIds = items.map((i) => i.actionId).filter((v): v is string => !!v);
    await txn.run(
      keepIds.length
        ? `DELETE FROM approval_form_actions WHERE form_id = $1 AND NOT (action_id = ANY($2::text[]))`
        : `DELETE FROM approval_form_actions WHERE form_id = $1`,
      keepIds.length ? [formId, keepIds] : [formId]
    );
    for (const [idx, item] of items.entries()) {
      const fieldMapJson = JSON.stringify(
        Object.fromEntries(Object.entries(item.fieldMap).filter(([, v]) => String(v ?? "").trim()))
      );
      if (item.actionId) {
        await txn.run(
          `UPDATE approval_form_actions
              SET action_kind = $2, trigger_on = $3, field_map = $4::jsonb, active = $5, sort_order = $6, updated_at = $7
            WHERE action_id = $1 AND form_id = $8`,
          [item.actionId, item.actionKind, item.triggerOn, fieldMapJson, item.active ? 1 : 0, idx, now, formId]
        );
      } else {
        await txn.run(
          `INSERT INTO approval_form_actions
             (action_id, form_id, action_kind, trigger_on, field_map, config, active, sort_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, '{}'::jsonb, $6, $7, $8, $8)`,
          [id(), formId, item.actionKind, item.triggerOn, fieldMapJson, item.active ? 1 : 0, idx, now]
        );
      }
    }
  });
  return listFormActions(formId);
}

/** 드라이런 후보 — 이 양식의 최근 문서(승인/진행/반려, 최신순). */
export async function listRecentDocsForForm(formId: string, limit = 8): Promise<
  Array<{ docId: string; docNo: string | null; title: string; status: string; drafterName: string | null }>
> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT doc_id, doc_no, title, status, drafter_name FROM approval_docs
        WHERE form_id = $1 AND status <> 'draft' ORDER BY updated_at DESC LIMIT $2`,
      [formId, limit]
    )
  );
  return rows.map((r) => ({
    docId: String(r.doc_id),
    docNo: r.doc_no != null ? String(r.doc_no) : null,
    title: String(r.title ?? ""),
    status: String(r.status),
    drafterName: r.drafter_name != null ? String(r.drafter_name) : null,
  }));
}

export interface DryRunSlotResult {
  key: string;
  label: string;
  required: boolean;
  mappedTo: string | null; // field_map 값(필드 key 또는 semantic:)
  fieldLabel: string | null; // 해석된 필드 라벨(미해석 시 null)
  value: string | null; // 문서에서 뽑힌 값(표시용 축약)
  ok: boolean; // required 인데 값이 없으면 false
}

export interface DryRunResult {
  connectorLabel: string;
  slots: DryRunSlotResult[];
  preview: string | null; // 커넥터별 실행 예고("연차 대장에 -1일 적재됩니다" 등)
  error: string | null;
}

const shortValue = (v: unknown): string => {
  if (v == null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
};

/**
 * 드라이런(P7) — 실제 실행 없이, 기존 문서 하나를 골라 이 설정이라면 슬롯이 어떻게 해석되고
 * 무슨 일이 일어나는지 미리 본다. 설정 실수를 배선 확정 전에 잡는 장치.
 */
export async function dryRunFormAction(params: {
  formId: string;
  actionKind: string;
  fieldMap: Record<string, string>;
  docId: string;
}): Promise<DryRunResult> {
  const connector = ACTION_CONNECTORS.find((c) => c.kind === params.actionKind);
  if (!connector) throw new Error(`등록되지 않은 커넥터입니다: ${params.actionKind}`);
  const db = await getDb();
  const docs = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.form_id, d.doc_no, d.title, d.drafter_user_id, d.drafter_employee_id, d.drafter_name,
              d.field_values, f.fields
         FROM approval_docs d JOIN approval_forms f ON f.form_id = d.form_id
        WHERE d.doc_id = $1 AND d.form_id = $2`,
      [params.docId, params.formId]
    )
  );
  if (!docs.length) throw new Error("드라이런 대상 문서를 찾을 수 없습니다.");
  const doc = docs[0];
  // 설정 검증이 목적이므로 문서 스냅샷 버전이 아니라 **현행 양식 스키마** 기준으로 해석한다.
  const fields = parseFields(doc.fields);
  const fieldValues = parseJsonObject(doc.field_values);
  const slotField = (key: string): ApprovalFieldDef | undefined => {
    const mapped = params.fieldMap[key];
    return typeof mapped === "string" && mapped ? resolveSlotField(mapped, fields) : undefined;
  };
  const ctx: ActionRunContext = {
    docId: params.docId,
    formId: params.formId,
    docNo: doc.doc_no != null ? String(doc.doc_no) : null,
    title: String(doc.title ?? ""),
    drafterUserId: doc.drafter_user_id != null ? String(doc.drafter_user_id) : null,
    drafterEmployeeId: doc.drafter_employee_id != null ? String(doc.drafter_employee_id) : null,
    drafterName: doc.drafter_name != null ? String(doc.drafter_name) : null,
    fieldValues,
    fields,
    config: {},
    slot: (key) => {
      const f = slotField(key);
      if (!f) return undefined;
      const v = fieldValues[f.key];
      return v === "" || v == null ? undefined : v;
    },
    slotField,
  };
  const slots: DryRunSlotResult[] = connector.slots.map((s) => {
    const mapped = params.fieldMap[s.key] ?? null;
    const field = slotField(s.key);
    const value = ctx.slot(s.key);
    return {
      key: s.key,
      label: s.label,
      required: !!s.required,
      mappedTo: mapped && mapped.trim() ? mapped : null,
      fieldLabel: field?.label ?? null,
      value: value === undefined ? null : shortValue(value),
      ok: !s.required || value !== undefined,
    };
  });
  let preview: string | null = null;
  let error: string | null = null;
  const missing = slots.filter((s) => !s.ok).map((s) => s.label);
  if (missing.length) {
    error = `필수 슬롯 값 없음: ${missing.join(", ")} — 이 문서로는 실행이 실패합니다.`;
  } else if (connector.preview) {
    try {
      preview = await connector.preview(ctx);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  return { connectorLabel: connector.label, slots, preview, error };
}

/* ---------- 커넥터 등록 ----------
 * 각 단계(FRM-P1~P6) 모듈이 커넥터를 구현하면 여기에 추가한다.
 * ⚠ 커넥터 구현 모듈은 docs.ts 를 import 하지 말 것(순환 참조) — 필요한 문서 정보는 ctx 로 받는다.
 */
export const ACTION_CONNECTORS: ActionConnector[] = [
  closeAbsenceRequestConnector,
  queueCertificatesConnector,
  incomeLedgerAppendConnector,
  recordResignationConnector,
  recordLeaveAbsenceConnector,
  recordAppointmentsConnector,
  recordLeavePayConnector,
];
