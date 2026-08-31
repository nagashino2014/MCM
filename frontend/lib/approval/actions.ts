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
 * 문서가 실제로 도달한 트리거만 실행한다 — 미승인(draft·반려·진행 중) 문서에 approved
 * 액션(소득원장·인사이벤트·계정 비활성화 등)이 돌면 안 된다.
 */
export async function rerunFormActions(docId: string): Promise<{ reran: boolean }> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT status FROM approval_docs WHERE doc_id = $1`, [docId]));
  const status = rows.length ? String(rows[0].status) : "";
  if (status === "approved") {
    await runFormActionsForDoc(docId, "approved");
    await runFormActionsForDoc(docId, "submitted");
    return { reran: true };
  }
  if (status === "in_progress") {
    await runFormActionsForDoc(docId, "submitted");
    return { reran: true };
  }
  return { reran: false };
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
