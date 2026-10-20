import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { missingTableRequirements, parseFields, type ApprovalFieldDef } from "@/lib/approval/fields";
import { getForm } from "@/lib/approval/forms";
import { recordLeaveUsageOnApproval } from "@/lib/approval/leave";
import { assessOverLimitOnSubmit } from "@/lib/approval/overtime";
import { assessMealChecksOnSubmit } from "@/lib/approval/overtime-meal";
import { assessRefLinkOnSubmit } from "@/lib/approval/ref-check";
import { resolveOpenCancelRequests } from "@/lib/approval/cancel";
import { notifyPendingSteps, notifyDrafterResult, notifyFinalApproved, notifyProxyDone } from "@/lib/approval/notify";
import { canFinalApprove, docDeptId } from "@/lib/approval/final-rules";
import { generateDocSummary } from "@/lib/approval/summarize";
import { assignManualDocNo, markLetterPendingOnApproval } from "@/lib/letter/store";
import { assignManualNoticeNo } from "@/lib/notice/store";
import { assignManualQuoteNo, markQuotePendingOnApproval, resolveQuoteVersion } from "@/lib/quote/store";
import { markAgreementApproved } from "@/lib/agreement/store";
import { runFormActionsForDoc } from "@/lib/approval/actions";
import { kstToday, resolveAbsence } from "@/lib/approval/absence-routing";
import { userPostDeptIds } from "@/lib/org/posts";

/*
 * 전자결재 문서(084) — 기안 저장/상신·채번·결재선 상태 전이·대결 라우팅·결재함 쿼리.
 * field_values 는 양식 필드 스키마의 key 로 구조화 저장된다.
 * 상태: draft → in_progress(상신) → approved | rejected (반려 후 수정·재상신은 draft 복귀).
 * 단계: waiting(차례 전) → pending(내 차례) → approved | rejected | skipped.
 * 병렬 합의 = 같은 step_order 복수 행(전원 approved 시 다음 order 진행).
 * 설계: docs/e-approval-blueprint.md §4·§8-4(대결).
 */

export interface ApprovalLineStepInput {
  stepType: "agree" | "approve";
  assigneeUserId: string;
  assigneeName?: string;
  assigneePosition?: string;
  /** 같은 order 로 묶을 병렬 합의 그룹 — 미지정 시 순차(단계마다 order 증가) */
  parallelGroup?: number;
}

/** 참조/열람 지정(AX-P0) — ref=완료 통보, view=진행 중 열람. */
export interface ApprovalWatcherInput {
  userId: string;
  kind: "ref" | "view";
}

export interface ApprovalStep {
  stepId: string;
  stepOrder: number;
  stepType: string;
  mode: string;
  assigneeUserId: string;
  assigneeName: string | null;
  assigneePosition: string | null;
  status: string;
  actedAt: string | null;
  comment: string | null;
  delegatedFrom: string | null;
  /** 대결 원결재자 이름·직급(조회 시 조인 — 재기안 결재선 복원·표기용) */
  delegatedFromName: string | null;
  delegatedFromPosition: string | null;
  /** 처리 유형(301): normal | proxy(대결) | final(전결). null = 301 이전 처리분 */
  actType: string | null;
  /** 생략 사유(301): rejected | absence | final */
  skipReason: string | null;
  absenceId: string | null;
  /** 대결 중인 단계를 원결재자도 처리할 수 있는지(부재 설정 allow_self_act, 휴가 연동은 허용) */
  selfActAllowed: boolean;
}

export interface ApprovalDocSummary {
  docId: string;
  docNo: string | null;
  formId: string;
  formName: string;
  /** 양식 폴더(인사 fld-hr / 업무 fld-biz / 회계 fld-finance) — 홈 카드 색 바 구분용(결재함 조회 시). */
  folderId?: string | null;
  title: string;
  urgent: boolean;
  status: string;
  drafterName: string | null;
  deptName: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  /** 결재함 조회 시 — 내 차례 step */
  myStepId?: string | null;
  /** AX-P2 결재자 AI 요약(상신 시 생성). 미생성/실패 시 null. */
  aiSummary?: DocAiSummaryLite | null;
}

/** 홈·모달 카드용 요약 표출 형태(생성 세부는 lib/approval/summarize.ts). */
export interface DocAiSummaryLite {
  lines: string[];
  figures: { label: string; value: string }[];
  precedent?: string | null;
}

function parseAiSummary(raw: unknown): DocAiSummaryLite | null {
  if (raw == null) return null;
  let o: Record<string, unknown> = {};
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (v && typeof v === "object") o = v as Record<string, unknown>;
  } catch {
    return null;
  }
  const lines = Array.isArray(o.lines) ? o.lines.map((x) => String(x)).filter(Boolean) : [];
  const figures = Array.isArray(o.figures)
    ? (o.figures as Record<string, unknown>[]).map((x) => ({ label: String(x?.label ?? ""), value: String(x?.value ?? "") })).filter((x) => x.label && x.value)
    : [];
  if (!lines.length && !figures.length) return null;
  return { lines, figures, precedent: o.precedent != null ? String(o.precedent) : null };
}

export interface ApprovalDocDetail extends ApprovalDocSummary {
  formVersion: number;
  fieldValues: Record<string, unknown>;
  fields: ApprovalFieldDef[];
  steps: ApprovalStep[];
  drafterUserId: string | null;
  drafterPosition: string | null;
  /** 양식의 전사 문서함 지정값 — 있으면 승인 문서는 전 직원 열람 허용 */
  orgFolder: string | null;
  deptId: string | null;
  watchers: ApprovalWatcher[];
  /** 선행 문서 연결(127) — 연결된 신청서의 요약(열람 화면 링크·기안 화면 복원용). */
  refDoc: RefDocLite | null;
  /** 이 문서 양식에 지정된 선행 양식 id(127) — 재편집 시 연결 UI 표시 판단용. */
  formRefFormId: string | null;
}

/** 선행 문서 요약 — 연결 표시·불일치 비교에 필요한 최소 형태. */
export interface RefDocLite {
  docId: string;
  docNo: string | null;
  title: string;
  formId: string;
  formName: string;
  status: string;
  submittedAt: string | null;
  fieldValues: Record<string, unknown>;
}

export interface ApprovalWatcher {
  userId: string;
  name: string | null;
  /** 현재 직급명(조회 시 positions 조인 — 저장 스냅샷 아님). 작성 화면의 결재선과 같은 표기용 */
  position: string | null;
  kind: string; // ref | view
}

function mapStep(r: Record<string, unknown>): ApprovalStep {
  return {
    stepId: String(r.step_id ?? ""),
    stepOrder: Number(r.step_order ?? 0),
    stepType: String(r.step_type ?? "approve"),
    mode: String(r.mode ?? "seq"),
    assigneeUserId: String(r.assignee_user_id ?? ""),
    assigneeName: r.assignee_name != null ? String(r.assignee_name) : null,
    assigneePosition: r.assignee_position != null ? String(r.assignee_position) : null,
    status: String(r.status ?? "waiting"),
    actedAt: r.acted_at != null ? String(r.acted_at) : null,
    comment: r.comment != null ? String(r.comment) : null,
    delegatedFrom: r.delegated_from != null ? String(r.delegated_from) : null,
    delegatedFromName: r.delegated_from_name != null ? String(r.delegated_from_name) : null,
    delegatedFromPosition: r.delegated_from_position != null ? String(r.delegated_from_position) : null,
    actType: r.act_type != null ? String(r.act_type) : null,
    skipReason: r.skip_reason != null ? String(r.skip_reason) : null,
    absenceId: r.absence_id != null ? String(r.absence_id) : null,
    selfActAllowed: r.self_act_allowed == null ? true : Number(r.self_act_allowed) === 1,
  };
}

function mapSummary(r: Record<string, unknown>): ApprovalDocSummary {
  return {
    docId: String(r.doc_id ?? ""),
    docNo: r.doc_no != null ? String(r.doc_no) : null,
    formId: String(r.form_id ?? ""),
    formName: String(r.form_name ?? ""),
    folderId: r.folder_id != null ? String(r.folder_id) : null,
    title: String(r.title ?? ""),
    urgent: Number(r.urgent ?? 0) === 1,
    status: String(r.status ?? "draft"),
    drafterName: r.drafter_name != null ? String(r.drafter_name) : null,
    deptName: r.dept_name != null ? String(r.dept_name) : null,
    submittedAt: r.submitted_at != null ? String(r.submitted_at) : null,
    completedAt: r.completed_at != null ? String(r.completed_at) : null,
    updatedAt: String(r.updated_at ?? ""),
    myStepId: r.my_step_id != null ? String(r.my_step_id) : null,
    aiSummary: parseAiSummary(r.ai_summary),
  };
}

/** 기안자 스냅샷(이름·직급·부서) — users→employee_profiles 조인. (공문 미리보기 API 도 사용) */
export async function loadDrafterSnapshot(userId: string): Promise<{
  employeeId: string | null;
  name: string | null;
  position: string | null;
  deptId: string | null;
  deptName: string | null;
}> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT u.employee_id, ep.name, p.position_name, ep.dept_id, d.dept_name
         FROM users u
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
         LEFT JOIN positions p ON p.position_id = ep.position_id
         LEFT JOIN departments d ON d.dept_id = ep.dept_id
        WHERE u.user_id = $1`,
      [userId]
    )
  );
  const r = rows[0] ?? {};
  return {
    employeeId: r.employee_id != null ? String(r.employee_id) : null,
    name: r.name != null ? String(r.name) : null,
    position: r.position_name != null ? String(r.position_name) : null,
    deptId: r.dept_id != null ? String(r.dept_id) : null,
    deptName: r.dept_name != null ? String(r.dept_name) : null,
  };
}

/**
 * 문서번호 채번 — 양식별 규칙 약칭 + 연도별 일련. 예: 출장신청-2026-0001
 * 삭제로 반납된 번호(doc_no_pool, 130)가 있으면 가장 작은 번호부터 이어받고,
 * 없으면 시퀀스를 원자적으로 증가시킨다(테스트 문서 삭제 후 결번 방지 — 사용자 확정).
 * 공문(rule_key='대외', 135)은 실측 관행 포맷 `{연도}-대외-{NNNNN}` · 신규 연도 01001 시작.
 */
const LETTER_RULE_KEY = "대외"; // = lib/letter/types.ts LETTER_RULE_KEY (fields.ts 처럼 DB 계층은 클라이언트 모듈을 참조하지 않는다)
const LETTER_FORM_ID = "frm-official-letter"; // = lib/letter/types.ts LETTER_FORM_ID (동일 사유)
// 내부고시(266·267) — 연도 없는 통산 번호 `내부고시-{NNNN}호`, 시퀀스 year 키 'ALL'.
// = lib/notice/types.ts NOTICE_RULE_KEY / NOTICE_SEQ_YEAR / NOTICE_FORM_ID (동일 사유)
const NOTICE_RULE_KEY = "내부고시";
const NOTICE_SEQ_YEAR = "ALL";
const NOTICE_FORM_ID = "frm-internal-notice";

// 견적(136) — rule_key `견적:{종류}` 5종(통합허가/화관법/HAPs/ESG/기타), 포맷 `{연도}-{종류}-{NNNN}`.
// = lib/quote/types.ts QUOTE_RULE_PREFIX/QUOTE_NO_LABEL_BY_SERVICE_TYPE (DB 계층은 클라이언트 모듈 미참조)
const QUOTE_RULE_PREFIX = "견적:";
const QUOTE_FORM_ID = "frm-quotation"; // = lib/quote/types.ts QUOTE_FORM_ID (동일 사유)
const QUOTE_NO_LABELS: Record<string, string> = {
  통합허가: "통합허가",
  "장외&화관법": "화관법",
  HAPs: "HAPs",
  ESG탄소중립: "ESG",
  기타: "기타",
};

async function allocateDocNo(txn: PgDatabase, ruleKey: string, year: string): Promise<string> {
  const isLetter = ruleKey === LETTER_RULE_KEY;
  const isNotice = ruleKey === NOTICE_RULE_KEY;
  if (isNotice) year = NOTICE_SEQ_YEAR;
  const isQuote = ruleKey.startsWith(QUOTE_RULE_PREFIX);
  const reused = rowsToObjects(
    await txn.exec(
      `DELETE FROM doc_no_pool
        WHERE rule_key = $1 AND year = $2
          AND seq = (SELECT min(seq) FROM doc_no_pool WHERE rule_key = $1 AND year = $2)
        RETURNING seq`,
      [ruleKey, year]
    )
  );
  const seq = reused.length
    ? Number(reused[0].seq)
    : Number(
        rowsToObjects(
          await txn.exec(
            `INSERT INTO doc_no_sequences (rule_key, year, last_seq) VALUES ($1, $2, $3)
             ON CONFLICT (rule_key, year) DO UPDATE SET last_seq = doc_no_sequences.last_seq + 1
             RETURNING last_seq`,
            [ruleKey, year, isLetter || isNotice ? 1001 : 1]
          )
        )[0]?.last_seq ?? 1
      );
  if (isLetter) return `${year}-${ruleKey}-${String(seq).padStart(5, "0")}`;
  if (isNotice) return `${ruleKey}-${String(seq).padStart(4, "0")}호`;
  if (isQuote) return `${year}-${ruleKey.slice(QUOTE_RULE_PREFIX.length)}-${String(seq).padStart(4, "0")}`;
  return `${ruleKey}-${year}-${String(seq).padStart(4, "0")}`;
}

/** 결재자 이름·직급 로드(스냅샷 저장용) */
async function loadAssigneeSnapshots(userIds: string[]): Promise<Map<string, { name: string; position: string | null }>> {
  const out = new Map<string, { name: string; position: string | null }>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return out;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT u.user_id, COALESCE(ep.name, u.email) AS name, p.position_name
         FROM users u
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
         LEFT JOIN positions p ON p.position_id = ep.position_id
        WHERE u.user_id = ANY($1::text[])`,
      [ids]
    )
  );
  for (const r of rows) {
    out.set(String(r.user_id), {
      name: String(r.name ?? ""),
      position: r.position_name != null ? String(r.position_name) : null,
    });
  }
  return out;
}

/** 기안 저장(draft) — 문서+결재선(waiting)을 통째로 저장/교체한다. */
export async function saveDoc(params: {
  docId: string | null;
  formId: string;
  title: string;
  urgent: boolean;
  fieldValues: Record<string, unknown>;
  line: ApprovalLineStepInput[];
  watchers?: ApprovalWatcherInput[];
  /** 선행 문서 연결(127) — 신청서→보고서 연관(예: 출장신청 → 출장보고). */
  refDocId?: string | null;
  /** 문서번호 수동 지정(관리자) — 지정 시 상신 채번을 건너뛰고 이 번호로 확정한다. 공문·내부고시·견적 양식 전용. */
  manualDocNo?: string | null;
  actorUserId: string;
}): Promise<string> {
  const form = await getForm(params.formId);
  if (!form) throw new Error("양식을 찾을 수 없습니다.");
  const docId = params.docId ?? "adoc-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const now = new Date().toISOString();
  const drafter = await loadDrafterSnapshot(params.actorUserId);
  const snaps = await loadAssigneeSnapshots(params.line.map((s) => s.assigneeUserId));
  const watchers = (params.watchers ?? []).filter((w) => w.userId && (w.kind === "ref" || w.kind === "view"));

  const fieldValues: Record<string, unknown> = { ...(params.fieldValues ?? {}) };
  await withDbWrite(async (txn) => {
    if (params.docId) {
      const owned = rowsToObjects(
        await txn.exec(`SELECT drafter_user_id, status FROM approval_docs WHERE doc_id = $1`, [params.docId])
      );
      if (!owned.length) throw new Error("문서를 찾을 수 없습니다.");
      if (String(owned[0].drafter_user_id) !== params.actorUserId) throw new Error("본인 기안만 수정할 수 있습니다.");
      if (!["draft", "rejected"].includes(String(owned[0].status))) throw new Error("작성중/반려 문서만 수정할 수 있습니다.");
    }
    // 견적 재견적(269) — 같은 용역 건의 상신된 버전 max+1 을 저장마다 재계산해 기안 시 자동 버전업
    if (params.formId === QUOTE_FORM_ID && typeof fieldValues.quote_root_doc_id === "string" && fieldValues.quote_root_doc_id) {
      fieldValues.quote_version = await resolveQuoteVersion(txn, fieldValues.quote_root_doc_id, docId);
    }
    await txn.run(
      `INSERT INTO approval_docs
         (doc_id, form_id, form_version, title, urgent, status, drafter_user_id, drafter_employee_id,
          drafter_name, drafter_position, dept_id, dept_name, field_values, ref_doc_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $14)
       ON CONFLICT (doc_id) DO UPDATE SET
         title = EXCLUDED.title,
         urgent = EXCLUDED.urgent,
         status = 'draft',
         form_version = EXCLUDED.form_version,
         field_values = EXCLUDED.field_values,
         ref_doc_id = EXCLUDED.ref_doc_id,
         updated_at = EXCLUDED.updated_at`,
      [
        docId,
        params.formId,
        form.version,
        params.title.trim() || form.name,
        params.urgent ? 1 : 0,
        params.actorUserId,
        drafter.employeeId,
        drafter.name,
        drafter.position,
        drafter.deptId,
        drafter.deptName,
        JSON.stringify(fieldValues),
        params.refDocId ?? null,
        now,
      ]
    );
    await txn.run(`DELETE FROM approval_steps WHERE doc_id = $1`, [docId]);
    let order = 0;
    let lastGroup: number | null = null;
    for (const s of params.line) {
      const isParallel = s.parallelGroup != null && s.parallelGroup === lastGroup;
      if (!isParallel) order += 1;
      lastGroup = s.parallelGroup ?? null;
      const snap = snaps.get(s.assigneeUserId);
      await txn.run(
        `INSERT INTO approval_steps
           (step_id, doc_id, step_order, step_type, mode, assignee_user_id, assignee_name, assignee_position, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'waiting', $9)`,
        [
          "astp-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14),
          docId,
          order,
          s.stepType,
          s.parallelGroup != null ? "parallel" : "seq",
          s.assigneeUserId,
          s.assigneeName ?? snap?.name ?? null,
          s.assigneePosition ?? snap?.position ?? null,
          now,
        ]
      );
    }
    // 참조/열람자 교체 저장(중복 제거)
    await txn.run(`DELETE FROM approval_watchers WHERE doc_id = $1`, [docId]);
    const seen = new Set<string>();
    for (const w of watchers) {
      const dk = `${w.userId}:${w.kind}`;
      if (seen.has(dk)) continue;
      seen.add(dk);
      await txn.run(
        `INSERT INTO approval_watchers (watcher_id, doc_id, user_id, kind, created_at) VALUES ($1, $2, $3, $4, $5)`,
        ["awch-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14), docId, w.userId, w.kind, now]
      );
    }
    // 공문 번호 수동 지정(관리자) — draft 단계에서 doc_no 를 선점한다. 상신은 doc_no 가
    // 이미 있으면 그대로 쓰므로(submitDoc) 이 번호가 확정 번호가 된다.
    if (params.manualDocNo !== undefined) {
      if (params.formId !== LETTER_FORM_ID && params.formId !== NOTICE_FORM_ID && params.formId !== QUOTE_FORM_ID) {
        throw new Error("문서번호 직접 지정은 공문·내부고시·견적 양식에서만 가능합니다.");
      }
      const wanted = (params.manualDocNo ?? "").trim();
      if (wanted) {
        if (params.formId === NOTICE_FORM_ID) await assignManualNoticeNo(txn, docId, wanted);
        else if (params.formId === QUOTE_FORM_ID) await assignManualQuoteNo(txn, docId, wanted, String(params.fieldValues.service_type ?? ""));
        else await assignManualDocNo(txn, docId, wanted);
      } else {
        // 지정 해제 — 자동 채번으로 되돌린다. 상신 이력이 있는 문서(반려 후 재편집)는
        // 이미 확정된 번호를 유지해야 하므로 건드리지 않는다.
        await txn.run(`UPDATE approval_docs SET doc_no = NULL WHERE doc_id = $1 AND submitted_at IS NULL`, [docId]);
      }
    }
  });
  return docId;
}

/**
 * 승인 공문 회수(2026-08-19 사용자 확정) — 발주처 사정 재발송은 반드시 **수정 → 재결재**를
 * 거친다(내용 그대로 재송부는 무의미하다는 사용자 피드백). 승인 문서를 draft 로 되돌려
 * 작성 화면에서 고친 뒤 재상신하면 문서번호(doc_no)는 유지되고, 재승인 시 자동으로
 * 2차 발송된다(발송 이력 N차 누적 — 194). 공문 양식 전용: 일반 결재 문서의 승인 후
 * 회수는 결재 무결성 논의가 따로 필요해 열지 않는다.
 */
export async function recallLetterDoc(docId: string, actorUserId: string, isManager: boolean): Promise<void> {
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(`SELECT form_id, status, drafter_user_id FROM approval_docs WHERE doc_id = $1`, [docId])
    );
    if (!rows.length) throw new Error("문서를 찾을 수 없습니다.");
    const doc = rows[0];
    // 내부고시(266)도 같은 흐름 — 승인 후 오탈자·서식 수정은 회수 → 수정 → 재결재(번호 유지)로 한다(2026-09-22).
    if (String(doc.form_id) !== LETTER_FORM_ID && String(doc.form_id) !== NOTICE_FORM_ID) {
      throw new Error("공문·내부고시 문서만 회수할 수 있습니다.");
    }
    if (String(doc.status) !== "approved") throw new Error("승인 완료 문서만 회수할 수 있습니다.");
    if (String(doc.drafter_user_id) !== actorUserId && !isManager) throw new Error("기안자 본인 또는 관리자만 회수할 수 있습니다.");
    // 발송 파이프라인이 도는 중이면 회수 금지(생성 중 문서가 바뀌면 산출물이 어긋난다)
    const letter = rowsToObjects(await txn.exec(`SELECT send_status FROM official_letters WHERE doc_id = $1`, [docId]));
    if (letter.length && String(letter[0].send_status) === "generating") {
      throw new Error("발송 처리 중입니다 — 잠시 후 다시 시도하세요.");
    }
    await txn.run(`UPDATE approval_docs SET status = 'draft', completed_at = NULL, updated_at = $2 WHERE doc_id = $1`, [
      docId,
      new Date().toISOString(),
    ]);
  });
}

/**
 * 문서 완전 삭제(관리자 전용 — 테스트·오기안 문서 정리).
 * steps·watchers·cancel_requests 는 FK CASCADE 로 함께 삭제되고,
 * 연차 대장(annual_leave_ledger)의 이 문서 사용 엔트리는 수동 삭제(잔여 연차 복원),
 * 이 문서를 선행 문서로 참조하는 후행 문서는 연결만 해제(ref_doc_id NULL)한다.
 */
export async function deleteDoc(docId: string): Promise<{ docNo: string | null; title: string }> {
  let docNo: string | null = null;
  let title = "";
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(await txn.exec(`SELECT doc_no, title FROM approval_docs WHERE doc_id = $1`, [docId]));
    if (!rows.length) throw new Error("문서를 찾을 수 없습니다.");
    docNo = rows[0].doc_no != null ? String(rows[0].doc_no) : null;
    title = String(rows[0].title ?? "");
    await txn.run(`DELETE FROM annual_leave_ledger WHERE doc_id = $1`, [docId]);
    await txn.run(`UPDATE approval_docs SET ref_doc_id = NULL WHERE ref_doc_id = $1`, [docId]);
    // 개인 영수증·법인카드 내역 귀속 해제(2026-08-26) — doc_id 는 FK 가 아니라 함께 풀지 않으면
    // 영수증이 '사용됨'으로 남아 다른 기안에서 다시 불러올 수 없다. 미정산 경비 목록은 승인 문서
    // 실시간 스캔이라 문서 삭제만으로 지급대상에서 빠진다(expense-settlement 규약).
    const unbindNow = new Date().toISOString();
    await txn.run(`UPDATE personal_receipts SET doc_id = NULL, doc_form_id = NULL, updated_at = $2 WHERE doc_id = $1`, [docId, unbindNow]);
    await txn.run(`UPDATE card_transactions SET doc_id = NULL, doc_form_id = NULL, updated_at = $2 WHERE doc_id = $1`, [docId, unbindNow]);
    // 발송 대장 미러(135 공문 · 136 견적) — doc_id 는 FK 가 아니라 함께 지우지 않으면 고아로 남는다.
    // 백필(imported) 공문은 doc_id 가 NULL 이라 영향 없다. quotation_sites 는 CASCADE.
    await txn.run(`DELETE FROM official_letters WHERE doc_id = $1`, [docId]);
    await txn.run(`DELETE FROM quotations WHERE doc_id = $1`, [docId]);
    await txn.run(`DELETE FROM approval_docs WHERE doc_id = $1`, [docId]);
    // 문서번호 반납(130) — 다음 상신이 이 번호를 이어받는다.
    // 형식: 일반 `{약칭}-{연도}-{일련}` / 공문(135) `{연도}-대외-{일련}` / 견적(136) `{연도}-{종류}-{일련}`.
    const letterM = docNo ? new RegExp(`^(\\d{4})-(${LETTER_RULE_KEY})-(\\d+)$`).exec(docNo) : null;
    // 내부고시(267) `내부고시-{일련}호` — 통산 번호라 연도 키는 'ALL'
    const noticeM = !letterM && docNo ? new RegExp(`^${NOTICE_RULE_KEY}-(\\d+)호$`).exec(docNo) : null;
    const quoteLabels = Object.values(QUOTE_NO_LABELS).join("|");
    const quoteM = !letterM && !noticeM && docNo ? new RegExp(`^(\\d{4})-(${quoteLabels})-(\\d+)$`).exec(docNo) : null;
    const m = !letterM && !noticeM && !quoteM && docNo ? /^(.+)-(\d{4})-(\d+)$/.exec(docNo) : null;
    const pool = letterM
      ? { rule: letterM[2], year: letterM[1], seq: Number(letterM[3]) }
      : noticeM
        ? { rule: NOTICE_RULE_KEY, year: NOTICE_SEQ_YEAR, seq: Number(noticeM[1]) }
      : quoteM
        ? { rule: QUOTE_RULE_PREFIX + quoteM[2], year: quoteM[1], seq: Number(quoteM[3]) }
        : m
          ? { rule: m[1], year: m[2], seq: Number(m[3]) }
          : null;
    if (pool) {
      await txn.run(
        `INSERT INTO doc_no_pool (rule_key, year, seq, released_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (rule_key, year, seq) DO NOTHING`,
        [pool.rule, pool.year, pool.seq, new Date().toISOString()]
      );
    }
  });
  return { docNo, title };
}

/** 라우팅 기준 — 기안자(대결자 제외 대상)와 최종 순번(최대 step_order, 부재 미적용 단계·D-2). */
async function loadRoutingMeta(txn: PgDatabase, docId: string): Promise<{ drafterUserId: string; finalOrder: number }> {
  const rows = rowsToObjects(
    await txn.exec(
      `SELECT d.drafter_user_id, (SELECT max(x.step_order) FROM approval_steps x WHERE x.doc_id = d.doc_id) AS final_order
         FROM approval_docs d WHERE d.doc_id = $1`,
      [docId]
    )
  );
  return { drafterUserId: String(rows[0]?.drafter_user_id ?? ""), finalOrder: Number(rows[0]?.final_order ?? 0) };
}

/**
 * 중간 단계 1건에 부재 라우팅 적용(설계 §5-3). 최종 순번 단계에는 호출하지 않는다(D-2).
 * - delegate: pending + 처리자를 대결자로 교체. delegated_from·absence_id 는 최초 원결재자 기준을 유지(연쇄 재라우팅 대비).
 * - skip: skipped(skip_reason=absence). 이미 대결 중인 단계는 대결자가 건너뛰기 부재여도 생략하지 않는다(원결재자 단계이므로).
 * - none·unresolved: 현 처리자 유지. unresolved(순환·연쇄 초과·자기 결재)는 관리자 알림 대상(DA-2) — 지금은 로그만.
 */
async function routeStepForAbsence(
  txn: PgDatabase,
  step: { stepId: string; assigneeUserId: string; delegatedFrom: string | null },
  drafterUserId: string,
  now: string
): Promise<"delegate" | "skip" | "none"> {
  const res = await resolveAbsence(txn, step.assigneeUserId, { excludeUserIds: [drafterUserId] });
  if (res.kind === "delegate" && res.delegateUserId !== step.assigneeUserId) {
    const snap = await loadAssigneeSnapshots([res.delegateUserId]);
    await txn.run(
      `UPDATE approval_steps
          SET status = 'pending', activated_at = $6, assignee_user_id = $2, assignee_name = $3, assignee_position = $4,
              delegated_from = COALESCE(delegated_from, $5),
              absence_id = CASE WHEN delegated_from IS NULL THEN $7 ELSE absence_id END
        WHERE step_id = $1`,
      [
        step.stepId,
        res.delegateUserId,
        snap.get(res.delegateUserId)?.name ?? null,
        snap.get(res.delegateUserId)?.position ?? null,
        step.assigneeUserId,
        now,
        res.absenceId,
      ]
    );
    return "delegate";
  }
  if (res.kind === "skip" && !step.delegatedFrom) {
    await txn.run(
      `UPDATE approval_steps SET status = 'skipped', skip_reason = 'absence', absence_id = $2, activated_at = $3 WHERE step_id = $1`,
      [step.stepId, res.absenceId, now]
    );
    return "skip";
  }
  if (res.kind === "unresolved") {
    console.warn(`[approval-absence] 대결 미해결(${res.reason}) — 처리자 유지: ${res.chain.join(" → ")} (step ${step.stepId})`);
  }
  await txn.run(`UPDATE approval_steps SET status = 'pending', activated_at = $2 WHERE step_id = $1 AND status = 'waiting'`, [
    step.stepId,
    now,
  ]);
  return "none";
}

/** 해당 order 에 처리할 단계가 남지 않았으면(전원 건너뛰기) 다음 order — 최종 순번은 건너뛰지 않으므로 반드시 멈춘다. */
async function nextOrderIfCleared(txn: PgDatabase, docId: string, order: number): Promise<number | null> {
  const rows = rowsToObjects(
    await txn.exec(
      `SELECT (SELECT count(*) FROM approval_steps WHERE doc_id = $1 AND step_order = $2 AND status IN ('waiting','pending')) AS open_count,
              (SELECT min(step_order) FROM approval_steps WHERE doc_id = $1 AND step_order > $2) AS next_order`,
      [docId, order]
    )
  );
  if (Number(rows[0]?.open_count ?? 0) > 0) return null;
  return rows[0]?.next_order != null ? Number(rows[0].next_order) : null;
}

/**
 * 특정 order 의 waiting 단계를 pending 으로 — 부재 라우팅(대결·건너뛰기)을 여기서 적용한다. activated_at 기록(체류시간 산출용).
 * 건너뛰기로 order 가 비면 다음 order 로 이어 활성화한다. 최종 순번 단계는 부재와 무관하게 원결재자에게 활성화(D-2).
 */
async function activateOrder(txn: PgDatabase, docId: string, order: number): Promise<void> {
  const now = new Date().toISOString();
  const { drafterUserId, finalOrder } = await loadRoutingMeta(txn, docId);
  let current: number | null = order;
  while (current != null) {
    const steps = rowsToObjects(
      await txn.exec(
        `SELECT step_id, assignee_user_id, delegated_from FROM approval_steps WHERE doc_id = $1 AND step_order = $2 AND status = 'waiting'`,
        [docId, current]
      )
    );
    for (const s of steps) {
      if (current >= finalOrder) {
        await txn.run(`UPDATE approval_steps SET status = 'pending', activated_at = $2 WHERE step_id = $1`, [String(s.step_id), now]);
        continue;
      }
      await routeStepForAbsence(
        txn,
        {
          stepId: String(s.step_id),
          assigneeUserId: String(s.assignee_user_id),
          delegatedFrom: s.delegated_from != null ? String(s.delegated_from) : null,
        },
        drafterUserId,
        now
      );
    }
    current = current >= finalOrder ? null : await nextOrderIfCleared(txn, docId, current);
  }
}

/** 재상신 대비 — 이전 회차에 대결로 바뀐 처리자를 원결재자로 되돌린다(처리 유형·생략 사유 초기화는 호출부). */
async function restoreDelegatedAssignees(txn: PgDatabase, docId: string): Promise<void> {
  const rows = rowsToObjects(
    await txn.exec(`SELECT step_id, delegated_from FROM approval_steps WHERE doc_id = $1 AND delegated_from IS NOT NULL`, [docId])
  );
  if (!rows.length) return;
  const snaps = await loadAssigneeSnapshots(rows.map((r) => String(r.delegated_from)));
  for (const r of rows) {
    const original = String(r.delegated_from);
    await txn.run(
      `UPDATE approval_steps SET assignee_user_id = $2, assignee_name = $3, assignee_position = $4, delegated_from = NULL WHERE step_id = $1`,
      [String(r.step_id), original, snaps.get(original)?.name ?? null, snaps.get(original)?.position ?? null]
    );
  }
}

/**
 * 이미 내 차례(pending)로 대기 중인 중간 단계의 부재 재라우팅(설계 §5-5).
 * 부재 저장 직후(userId 지정)와 리마인드 틱(전체, 30분)에서 호출 — 미래 시작 부재는 시작일 첫 틱에 반영된다.
 * 최종 순번 단계는 제외(D-2). 처리자가 바뀐 문서는 커밋 후 결재 요청 알림을 보낸다.
 */
export async function rerouteAbsentPendingSteps(opts: { userId?: string } = {}): Promise<{ rerouted: number }> {
  const db = await getDb();
  const today = kstToday();
  const cands = rowsToObjects(
    await db.exec(
      `SELECT s.step_id, s.doc_id
         FROM approval_steps s JOIN approval_docs d ON d.doc_id = s.doc_id
        WHERE s.status = 'pending' AND d.status = 'in_progress'
          AND ($2::text IS NULL OR s.assignee_user_id = $2)
          AND s.step_order < (SELECT max(x.step_order) FROM approval_steps x WHERE x.doc_id = s.doc_id)
          AND (EXISTS (SELECT 1 FROM approval_absences a
                        WHERE a.user_id = s.assignee_user_id AND a.canceled_at IS NULL AND a.start_date <= $1 AND a.end_date >= $1)
               OR EXISTS (SELECT 1 FROM approval_delegates ad WHERE ad.user_id = s.assignee_user_id AND ad.enabled = 1))`,
      [today, opts.userId ?? null]
    )
  );
  const changedDocs = new Set<string>();
  for (const c of cands) {
    const docId = String(c.doc_id);
    const stepId = String(c.step_id);
    let changed = false;
    await withDbWrite(async (txn) => {
      // 같은 문서의 결재 처리(actOnDoc)와 직렬화 — 단계 전체 잠금 후 상태 재확인.
      const rows = rowsToObjects(
        await txn.exec(
          `SELECT step_id, step_order, assignee_user_id, delegated_from, status FROM approval_steps WHERE doc_id = $1 FOR UPDATE`,
          [docId]
        )
      );
      const step = rows.find((r) => String(r.step_id) === stepId);
      if (!step || String(step.status) !== "pending") return;
      const { drafterUserId, finalOrder } = await loadRoutingMeta(txn, docId);
      const order = Number(step.step_order);
      if (order >= finalOrder) return;
      const now = new Date().toISOString();
      const result = await routeStepForAbsence(
        txn,
        {
          stepId,
          assigneeUserId: String(step.assignee_user_id),
          delegatedFrom: step.delegated_from != null ? String(step.delegated_from) : null,
        },
        drafterUserId,
        now
      );
      if (result === "none") return;
      changed = true;
      if (result === "skip") {
        const next = await nextOrderIfCleared(txn, docId, order);
        if (next != null) await activateOrder(txn, docId, next);
      }
      await txn.run(`UPDATE approval_docs SET updated_at = $2 WHERE doc_id = $1`, [docId, now]);
    });
    if (changed) changedDocs.add(docId);
  }
  for (const docId of changedDocs) await notifyPendingSteps(docId);
  return { rerouted: changedDocs.size };
}

/** 상신 — 채번 + 첫 단계 활성화. draft/rejected 상태에서만 가능(본인 기안). */
export async function submitDoc(docId: string, actorUserId: string): Promise<{ docNo: string }> {
  let docNo = "";
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(
        `SELECT d.status, d.drafter_user_id, d.doc_no, f.doc_no_rule, f.name AS form_name, f.fields,
                d.field_values, d.field_values->>'service_type' AS quote_service_type
           FROM approval_docs d JOIN approval_forms f ON f.form_id = d.form_id
          WHERE d.doc_id = $1`,
        [docId]
      )
    );
    if (!rows.length) throw new Error("문서를 찾을 수 없습니다.");
    const doc = rows[0];
    if (String(doc.drafter_user_id) !== actorUserId) throw new Error("본인 기안만 상신할 수 있습니다.");
    if (!["draft", "rejected"].includes(String(doc.status))) throw new Error("작성중/반려 문서만 상신할 수 있습니다.");
    const stepCount = rowsToObjects(await txn.exec(`SELECT count(*) AS c FROM approval_steps WHERE doc_id = $1`, [docId]));
    if (Number(stepCount[0]?.c ?? 0) === 0) throw new Error("결재선에 결재자를 1명 이상 지정하세요.");
    // 표 필수 열(지출 내역의 지출 목적 등) — 기안 화면과 같은 규칙으로 서버에서도 막는다.
    const rowMissing = missingTableRequirements(
      parseFields(doc.fields),
      (doc.field_values as Record<string, unknown> | null) ?? {},
    );
    if (rowMissing.length) throw new Error(`다음 항목을 입력하세요 — ${rowMissing.join(" / ")}`);

    const now = new Date().toISOString();
    const year = now.slice(0, 4);
    // 견적 양식(doc_no_rule='견적')은 문서의 용역 대분류에 따라 5종 시퀀스로 분기(136)
    let ruleKey = String(doc.doc_no_rule ?? doc.form_name ?? "문서");
    if (ruleKey === "견적") {
      ruleKey = QUOTE_RULE_PREFIX + (QUOTE_NO_LABELS[String(doc.quote_service_type ?? "")] ?? "기타");
    }
    docNo = doc.doc_no != null && String(doc.doc_no) ? String(doc.doc_no) : await allocateDocNo(txn, ruleKey, year);
    await txn.run(
      `UPDATE approval_docs SET status = 'in_progress', doc_no = $2, submitted_at = $3, completed_at = NULL, updated_at = $3 WHERE doc_id = $1`,
      [docId, docNo, now]
    );
    // 재상신 대비 — 대결로 바뀐 처리자를 원결재자로 되돌리고 모든 단계를 waiting 초기화 후 1차 활성화
    await restoreDelegatedAssignees(txn, docId);
    await txn.run(
      `UPDATE approval_steps SET status = 'waiting', acted_at = NULL, comment = NULL, act_type = NULL, skip_reason = NULL, absence_id = NULL
        WHERE doc_id = $1`,
      [docId]
    );
    await activateOrder(txn, docId, 1);
    // 초과근무 신청 — 주 12h 초과 판정을 상신 시점에 고정 저장(결재 화면 경고 배너의 근거).
    await assessOverLimitOnSubmit(txn, docId);
    // 지출결의서 — 식대(복리후생비) 사용을 그 날 초과근무 신청(평일 2h·휴일 4h)과 대조해
    // 미달분을 경고 스냅샷·이력으로 남긴다(상신 차단 없음, 결재 화면 배너의 근거).
    await assessMealChecksOnSubmit(txn, docId);
    // 선행 문서 연계 정합성 — 불일치 판정·숙박출장수당 산정 내역을 상신 시점에 고정 저장(결재 화면 배너).
    await assessRefLinkOnSubmit(txn, docId);
  });
  // 커밋 후 — 등록 액션 실행(201 레지스트리, submitted 트리거. 내부에서 실패 격리)
  await runFormActionsForDoc(docId, "submitted");
  // 커밋 후 — 첫 결재자에게 알림(fire-and-forget, 실패해도 상신은 완료)
  await notifyPendingSteps(docId);
  // AI 요약 생성(상신 시 자동, 비차단) — 결재자가 열기 전 준비. 실패해도 원문 폴백.
  void generateDocSummary(docId).catch(() => {});
  return { docNo };
}

/** 승인/반려 — 본인 pending 단계에만. 병렬 합의는 전원 승인 시 다음 order 로. */
/** 사용자 오류(400·403 등) — authErrorToResponse 가 status 를 그대로 응답한다. */
function userError(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

/** 대결 중인 단계의 원결재자 처리 허용 여부(D-4) — 직접 등록 부재의 allow_self_act, 휴가 연동(부재 id 없음)은 허용. */
async function selfActAllowed(txn: PgDatabase, absenceId: string | null): Promise<boolean> {
  if (!absenceId) return true;
  const rows = rowsToObjects(await txn.exec(`SELECT allow_self_act FROM approval_absences WHERE absence_id = $1`, [absenceId]));
  return rows.length ? Number(rows[0].allow_self_act) === 1 : true;
}

/**
 * 문서 최종 승인 처리(트랜잭션 안) — 문서 approved + 승인 완료 후크. 일반 최종 승인과 [전결](DA-3)이 공용으로 쓴다.
 * 커밋 후 작업(양식 액션·기안자 알림·공문/견적 발송)은 호출부가 docStatus 로 판단해 실행한다.
 * 부재 처리 경로는 이 함수를 부르지 않는다 — 최종 결재자 본인 결재로만 결재라인 종료(D-2).
 */
async function finalizeApprovedDoc(txn: PgDatabase, docId: string, now: string): Promise<void> {
  await txn.run(`UPDATE approval_docs SET status = 'approved', completed_at = $2, updated_at = $2 WHERE doc_id = $1`, [docId, now]);
  // 휴가신청 승인 완료 → 연차 대장 use 적재(연차·반차만, doc당 1회)
  await recordLeaveUsageOnApproval(txn, docId);
  // 공문(135) 승인 완료 → 발송 대장 pending 등록(발송 자체는 커밋 후 비동기)
  await markLetterPendingOnApproval(txn, docId);
  // 견적(136) 승인 완료 → 발송 대장 pending 등록(산출물 생성·발송은 커밋 후 비동기)
  await markQuotePendingOnApproval(txn, docId);
  // 계약서(147) 승인 완료 → 대장 approved 마킹만 — 자동 발송 없음(수동 발송, 2026-08-10 확정)
  await markAgreementApproved(txn, docId);
}

export async function actOnDoc(params: {
  docId: string;
  stepId: string;
  action: "approve" | "reject" | "final";
  comment: string | null;
  actorUserId: string;
}): Promise<{ docStatus: string }> {
  let docStatus = "in_progress";
  let proxyActed = false;
  let finalActed = false;
  await withDbWrite(async (txn) => {
    // FOR UPDATE — 부재 재라우팅(rerouteAbsentPendingSteps)과 같은 문서 단계를 동시에 바꾸지 않도록 직렬화.
    const steps = rowsToObjects(
      await txn.exec(`SELECT * FROM approval_steps WHERE doc_id = $1 ORDER BY step_order, created_at FOR UPDATE`, [params.docId])
    );
    const me = steps.find((s) => String(s.step_id) === params.stepId);
    if (!me) throw new Error("결재 단계를 찾을 수 없습니다.");
    const isAssignee = String(me.assignee_user_id) === params.actorUserId;
    // 대결 중인 단계는 원결재자도 처리할 수 있다(D-4, 부재 설정에서 끈 경우 제외). 처리자는 원결재자로 되돌려 기록.
    const isOriginal =
      !isAssignee &&
      me.delegated_from != null &&
      String(me.delegated_from) === params.actorUserId &&
      (await selfActAllowed(txn, me.absence_id != null ? String(me.absence_id) : null));
    if (!isAssignee && !isOriginal) throw new Error("본인에게 배정된 결재만 처리할 수 있습니다.");
    if (String(me.status) !== "pending") throw new Error("현재 결재 차례가 아닙니다.");
    if (isOriginal) {
      const snap = await loadAssigneeSnapshots([params.actorUserId]);
      await txn.run(
        `UPDATE approval_steps SET assignee_user_id = $2, assignee_name = $3, assignee_position = $4, delegated_from = NULL, absence_id = NULL
          WHERE step_id = $1`,
        [params.stepId, params.actorUserId, snap.get(params.actorUserId)?.name ?? null, snap.get(params.actorUserId)?.position ?? null]
      );
    }
    const actType = isAssignee && me.delegated_from != null ? "proxy" : "normal";
    proxyActed = actType === "proxy";

    const now = new Date().toISOString();
    if (params.action === "final") {
      // 전결(DA-3) — 승인 단계 + 전결 규칙 충족 시 이후 단계를 모두 생략하고 최종 승인. 대결(proxy)로는 전결할 수 없다.
      if (String(me.step_type) !== "approve") throw userError("합의 단계에서는 전결할 수 없습니다.");
      if (actType === "proxy") throw userError("대결로 처리하는 결재는 전결할 수 없습니다.");
      const laterOpen = steps.filter((s) => String(s.step_id) !== params.stepId && ["waiting", "pending"].includes(String(s.status)));
      if (!laterOpen.length) throw userError("남은 결재자가 없습니다. 승인으로 처리하세요.");
      const meta = await docDeptId(txn, params.docId);
      if (!meta || !(await canFinalApprove(txn, { formId: meta.formId, deptId: meta.deptId, actorUserId: params.actorUserId }))) {
        throw userError("이 양식의 전결 권한이 없습니다.", 403);
      }
      await txn.run(`UPDATE approval_steps SET status = 'approved', acted_at = $2, comment = $3, act_type = 'final' WHERE step_id = $1`, [
        params.stepId,
        now,
        params.comment,
      ]);
      await txn.run(
        `UPDATE approval_steps SET status = 'skipped', skip_reason = 'final' WHERE doc_id = $1 AND status IN ('waiting','pending') AND step_id <> $2`,
        [params.docId, params.stepId]
      );
      await finalizeApprovedDoc(txn, params.docId, now);
      docStatus = "approved";
      finalActed = true;
      return;
    }
    if (params.action === "reject") {
      await txn.run(`UPDATE approval_steps SET status = 'rejected', acted_at = $2, comment = $3, act_type = $4 WHERE step_id = $1`, [
        params.stepId,
        now,
        params.comment,
        actType,
      ]);
      await txn.run(
        `UPDATE approval_steps SET status = 'skipped', skip_reason = 'rejected' WHERE doc_id = $1 AND status IN ('waiting','pending') AND step_id <> $2`,
        [params.docId, params.stepId]
      );
      await txn.run(`UPDATE approval_docs SET status = 'rejected', completed_at = $2, updated_at = $2 WHERE doc_id = $1`, [
        params.docId,
        now,
      ]);
      // 기안자의 반려 요청(취소 요청, 124)이 걸려 있었다면 이 반려로 처리 완료된 것 — 자동 마감.
      await resolveOpenCancelRequests(txn, params.docId, "rejected", params.actorUserId);
      docStatus = "rejected";
      return;
    }

    await txn.run(`UPDATE approval_steps SET status = 'approved', acted_at = $2, comment = $3, act_type = $4 WHERE step_id = $1`, [
      params.stepId,
      now,
      params.comment,
      actType,
    ]);
    const myOrder = Number(me.step_order);
    const sameOrderPending = steps.filter(
      (s) => Number(s.step_order) === myOrder && String(s.step_id) !== params.stepId && ["waiting", "pending"].includes(String(s.status))
    );
    if (sameOrderPending.length === 0) {
      const nextOrders = steps.filter((s) => Number(s.step_order) > myOrder).map((s) => Number(s.step_order));
      if (nextOrders.length === 0) {
        await finalizeApprovedDoc(txn, params.docId, now);
        docStatus = "approved";
      } else {
        await activateOrder(txn, params.docId, Math.min(...nextOrders));
        await txn.run(`UPDATE approval_docs SET updated_at = $2 WHERE doc_id = $1`, [params.docId, now]);
      }
    }
  });
  // 커밋 후 — 등록 액션 실행(201 레지스트리, 실패해도 결재는 유효·재실행 가능. 내부에서 실패 격리)
  // 대결 처리 후열 통지 — 원결재자에게 1회(DA-2).
  if (proxyActed) await notifyProxyDone(params.docId, params.stepId);
  if (docStatus === "approved") await runFormActionsForDoc(params.docId, "approved");
  else if (docStatus === "rejected") await runFormActionsForDoc(params.docId, "rejected");
  // 커밋 후 알림 — 최종 승인/반려는 기안자에게, 진행 중이면 다음 결재자에게(단계별 멱등).
  if (finalActed) await notifyFinalApproved(params.docId);
  else if (docStatus === "approved") await notifyDrafterResult(params.docId, "approved");
  else if (docStatus === "rejected") await notifyDrafterResult(params.docId, "rejected");
  else await notifyPendingSteps(params.docId);
  // 공문 최종 승인 → 산출물 생성·메일 자동 발송(비차단, 실패 시 대장 failed → 재발송 버튼).
  // 동적 import 로 순환 참조 회피(letter/generate → docs.getDoc). 공문 아니면 대장 선점 0행으로 no-op.
  if (docStatus === "approved") {
    void import("@/lib/letter/send")
      .then((m) => m.processLetterSend(params.docId))
      .catch(() => {});
    // 견적(136)도 동일 패턴 — direct 모드는 산출물 생성까지만(generated), mail 모드는 발송까지.
    void import("@/lib/quote/send")
      .then((m) => m.processQuoteSend(params.docId))
      .catch(() => {});
  }
  return { docStatus };
}

/** 기안함(내 문서) — box: draft(작성중/반려 포함) | in_progress | completed */
export async function listMyDocs(userId: string, box: "draft" | "in_progress" | "completed", limit = 30): Promise<ApprovalDocSummary[]> {
  const db = await getDb();
  const cond =
    box === "draft" ? `d.status IN ('draft','rejected')` : box === "in_progress" ? `d.status = 'in_progress'` : `d.status IN ('approved','rejected')`;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.*, f.name AS form_name FROM approval_docs d
         JOIN approval_forms f ON f.form_id = d.form_id
        WHERE d.drafter_user_id = $1 AND ${cond}
        ORDER BY d.updated_at DESC LIMIT $2`,
      [userId, limit]
    )
  );
  return rows.map(mapSummary);
}

/** 결재 대기(내 차례 pending) / 예정(내가 뒤 순번 waiting) */
export async function listInbox(userId: string, kind: "pending" | "upcoming", limit = 30): Promise<ApprovalDocSummary[]> {
  const db = await getDb();
  const status = kind === "pending" ? "pending" : "waiting";
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.*, f.name AS form_name, f.folder_id, s.step_id AS my_step_id FROM approval_steps s
         JOIN approval_docs d ON d.doc_id = s.doc_id
         JOIN approval_forms f ON f.form_id = d.form_id
         LEFT JOIN approval_absences ab ON ab.absence_id = s.absence_id
        WHERE (s.assignee_user_id = $1
               OR ($2 = 'pending' AND s.delegated_from = $1 AND COALESCE(ab.allow_self_act, 1) = 1))
          AND s.status = $2 AND d.status = 'in_progress'
        ORDER BY d.urgent DESC, d.submitted_at ASC LIMIT $3`,
      [userId, status, limit]
    )
  );
  return rows.map(mapSummary);
}

/** 내가 결재 처리한 문서(결재 문서함) */
export async function listActedDocs(userId: string, limit = 30): Promise<ApprovalDocSummary[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT ON (d.doc_id) d.*, f.name AS form_name FROM approval_steps s
         JOIN approval_docs d ON d.doc_id = s.doc_id
         JOIN approval_forms f ON f.form_id = d.form_id
        WHERE s.assignee_user_id = $1 AND s.status IN ('approved','rejected')
        ORDER BY d.doc_id, d.updated_at DESC`,
      [userId]
    )
  );
  return rows
    .map(mapSummary)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, limit);
}

export interface DocRecordRow extends ApprovalDocSummary {
  fieldValues: Record<string, unknown>;
}

export interface ArchiveDocRow extends ApprovalDocSummary {
  retentionYears: number | null;
  orgFolder: string | null;
}

function mapArchive(r: Record<string, unknown>): ArchiveDocRow {
  return {
    ...mapSummary(r),
    retentionYears: r.retention_years != null ? Number(r.retention_years) : null,
    orgFolder: r.org_folder != null ? String(r.org_folder) : null,
  };
}

/** 참조/열람자 열람 시각 기록(안 읽음 배지 해제). */
export async function markWatcherRead(docId: string, userId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`UPDATE approval_watchers SET read_at = $3 WHERE doc_id = $1 AND user_id = $2 AND read_at IS NULL`, [
      docId,
      userId,
      new Date().toISOString(),
    ]);
  });
}

/** 뷰어의 소속 부서(부서 문서함·열람 범위 판정용) */
export async function getUserDeptId(userId: string): Promise<string | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ep.dept_id FROM users u LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id WHERE u.user_id = $1`,
      [userId]
    )
  );
  return rows.length && rows[0].dept_id != null ? String(rows[0].dept_id) : null;
}

/** 뷰어의 보직 부서 전체(주 소속 + 겸직, 300) — 부서 문서함·완료 문서 열람 범위. */
export async function getUserDeptIds(userId: string): Promise<string[]> {
  return userPostDeptIds(userId);
}

/** 부서 문서함 — 본인 보직 부서(주 소속 + 겸직)의 완료 문서(기안 완료함). */
export async function listDeptDocs(userId: string, limit = 50): Promise<ArchiveDocRow[]> {
  const deptIds = await getUserDeptIds(userId);
  if (!deptIds.length) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.*, f.name AS form_name, f.retention_years, f.org_folder FROM approval_docs d
         JOIN approval_forms f ON f.form_id = d.form_id
        WHERE d.dept_id = ANY($1::text[]) AND d.status IN ('approved','rejected')
        ORDER BY d.completed_at DESC NULLS LAST LIMIT $2`,
      [deptIds, limit]
    )
  );
  return rows.map(mapArchive);
}

/** 전사 문서함 폴더 목록(양식별 org_folder 지정값) */
export async function listOrgFolders(): Promise<string[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT DISTINCT org_folder FROM approval_forms WHERE org_folder IS NOT NULL AND org_folder <> '' ORDER BY org_folder`)
  );
  return rows.map((r) => String(r.org_folder));
}

/** 전사 문서함 — 폴더별 승인 완료 문서(전 직원 열람). */
export async function listOrgFolderDocs(folder: string, limit = 50): Promise<ArchiveDocRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.*, f.name AS form_name, f.retention_years, f.org_folder FROM approval_docs d
         JOIN approval_forms f ON f.form_id = d.form_id
        WHERE f.org_folder = $1 AND d.status = 'approved'
        ORDER BY d.completed_at DESC NULLS LAST LIMIT $2`,
      [folder, limit]
    )
  );
  return rows.map(mapArchive);
}

/** 내가 참조/열람자로 지정된 문서(안 읽음 우선). ref/view 모두 포함. */
export async function listWatchedDocs(userId: string, limit = 50): Promise<Array<ArchiveDocRow & { watchKind: string; unread: boolean }>> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.*, f.name AS form_name, f.retention_years, f.org_folder, w.kind AS watch_kind, w.read_at
         FROM approval_watchers w
         JOIN approval_docs d ON d.doc_id = w.doc_id
         JOIN approval_forms f ON f.form_id = d.form_id
        WHERE w.user_id = $1 AND d.status <> 'draft'
        ORDER BY (w.read_at IS NULL) DESC, d.updated_at DESC LIMIT $2`,
      [userId, limit]
    )
  );
  return rows.map((r) => ({
    ...mapArchive(r),
    watchKind: String(r.watch_kind ?? "ref"),
    unread: r.read_at == null,
  }));
}

/**
 * ★양식별 문서 조회 — 필드가 컬럼으로 펼쳐지는 데이터 테이블의 소스(§5-6, 다우 대비 핵심).
 * field_values 를 그대로 내려 클라이언트가 현재 양식 스키마 기준으로 평탄화한다.
 */
export async function listDocsByForm(params: {
  formId: string;
  status?: "all" | "approved" | "in_progress" | "rejected";
  from?: string | null; // 상신일 범위(YYYY-MM-DD)
  to?: string | null;
  q?: string | null; // 제목·기안자 검색
  limit?: number;
}): Promise<DocRecordRow[]> {
  const db = await getDb();
  const where: string[] = ["d.form_id = $1", "d.status <> 'draft'"];
  const args: unknown[] = [params.formId];
  const status = params.status ?? "all";
  if (status !== "all") {
    args.push(status);
    where.push(`d.status = $${args.length}`);
  }
  if (params.from) {
    args.push(params.from);
    where.push(`d.submitted_at >= $${args.length}`);
  }
  if (params.to) {
    args.push(params.to + "T23:59:59");
    where.push(`d.submitted_at <= $${args.length}`);
  }
  if (params.q?.trim()) {
    args.push(`%${params.q.trim()}%`);
    where.push(`(d.title ILIKE $${args.length} OR d.drafter_name ILIKE $${args.length})`);
  }
  args.push(Math.min(500, params.limit ?? 200));
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.*, f.name AS form_name FROM approval_docs d
         JOIN approval_forms f ON f.form_id = d.form_id
        WHERE ${where.join(" AND ")}
        ORDER BY d.submitted_at DESC NULLS LAST
        LIMIT $${args.length}`,
      args
    )
  );
  return rows.map((r) => {
    let fieldValues: Record<string, unknown> = {};
    try {
      const v = typeof r.field_values === "string" ? JSON.parse(r.field_values) : r.field_values;
      if (v && typeof v === "object") fieldValues = v as Record<string, unknown>;
    } catch {
      // 무시
    }
    return { ...mapSummary(r), fieldValues };
  });
}

/** field_values jsonb 안전 파싱(공용). */
function parseFieldValues(raw: unknown): Record<string, unknown> {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (v && typeof v === "object") return v as Record<string, unknown>;
  } catch {
    // 무시
  }
  return {};
}

/**
 * 선행 문서 후보(127) — 내가 기안한 특정 양식의 문서(승인 완료 우선, 진행 중 포함).
 * 보고서 기안 화면의 '선행 문서 선택' 모달 목록 + 미연결 안내 배지에 쓰인다.
 * field_values 를 포함해 내려 클라이언트가 업체명·기간·계약명 불일치 비교를 수행한다.
 */
export async function listRefCandidates(userId: string, formId: string, limit = 20): Promise<RefDocLite[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.doc_no, d.title, d.form_id, d.status, d.submitted_at, d.field_values, f.name AS form_name
         FROM approval_docs d
         JOIN approval_forms f ON f.form_id = d.form_id
        WHERE d.drafter_user_id = $1 AND d.form_id = $2 AND d.status IN ('approved', 'in_progress')
        ORDER BY (d.status = 'approved') DESC, d.submitted_at DESC NULLS LAST
        LIMIT $3`,
      [userId, formId, limit]
    )
  );
  return rows.map((r) => ({
    docId: String(r.doc_id ?? ""),
    docNo: r.doc_no != null ? String(r.doc_no) : null,
    title: String(r.title ?? ""),
    formId: String(r.form_id ?? ""),
    formName: String(r.form_name ?? ""),
    status: String(r.status ?? ""),
    submittedAt: r.submitted_at != null ? String(r.submitted_at) : null,
    fieldValues: parseFieldValues(r.field_values),
  }));
}

/** 문서 상세 — 제출 당시 양식 버전의 fields 로 렌더한다. */
export async function getDoc(docId: string): Promise<ApprovalDocDetail | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.*, f.name AS form_name, f.org_folder, f.ref_form_id AS form_ref_form_id,
              COALESCE(v.fields, f.fields) AS render_fields,
              rd.doc_no AS ref_doc_no, rd.title AS ref_title, rd.form_id AS ref_form_id,
              rd.status AS ref_status, rd.submitted_at AS ref_submitted_at,
              rd.field_values AS ref_field_values, rf.name AS ref_form_name
         FROM approval_docs d
         JOIN approval_forms f ON f.form_id = d.form_id
         LEFT JOIN approval_form_versions v ON v.form_id = d.form_id AND v.version = d.form_version
         LEFT JOIN approval_docs rd ON rd.doc_id = d.ref_doc_id
         LEFT JOIN approval_forms rf ON rf.form_id = rd.form_id
        WHERE d.doc_id = $1`,
      [docId]
    )
  );
  if (!rows.length) return null;
  const r = rows[0];
  const stepRows = rowsToObjects(
    await db.exec(
      `SELECT s.*, COALESCE(oep.name, ou.email) AS delegated_from_name, op.position_name AS delegated_from_position,
              COALESCE(ab.allow_self_act, 1) AS self_act_allowed
         FROM approval_steps s
         LEFT JOIN users ou ON ou.user_id = s.delegated_from
         LEFT JOIN employee_profiles oep ON oep.employee_id = ou.employee_id
         LEFT JOIN positions op ON op.position_id = oep.position_id
         LEFT JOIN approval_absences ab ON ab.absence_id = s.absence_id
        WHERE s.doc_id = $1 ORDER BY s.step_order, s.created_at`,
      [docId]
    )
  );
  const watcherRows = rowsToObjects(
    await db.exec(
      `SELECT w.user_id, w.kind, COALESCE(ep.name, u.email) AS name, p.position_name
         FROM approval_watchers w
         LEFT JOIN users u ON u.user_id = w.user_id
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
         LEFT JOIN positions p ON p.position_id = ep.position_id
        WHERE w.doc_id = $1`,
      [docId]
    )
  );
  const fieldValues = parseFieldValues(r.field_values);
  const refDoc: RefDocLite | null =
    r.ref_doc_id != null && String(r.ref_doc_id)
      ? {
          docId: String(r.ref_doc_id),
          docNo: r.ref_doc_no != null ? String(r.ref_doc_no) : null,
          title: String(r.ref_title ?? ""),
          formId: String(r.ref_form_id ?? ""),
          formName: String(r.ref_form_name ?? ""),
          status: String(r.ref_status ?? ""),
          submittedAt: r.ref_submitted_at != null ? String(r.ref_submitted_at) : null,
          fieldValues: parseFieldValues(r.ref_field_values),
        }
      : null;
  return {
    ...mapSummary(r),
    formVersion: Number(r.form_version ?? 1),
    fieldValues,
    fields: parseFields(r.render_fields),
    steps: stepRows.map(mapStep),
    drafterUserId: r.drafter_user_id != null ? String(r.drafter_user_id) : null,
    drafterPosition: r.drafter_position != null ? String(r.drafter_position) : null,
    orgFolder: r.org_folder != null ? String(r.org_folder) : null,
    deptId: r.dept_id != null ? String(r.dept_id) : null,
    watchers: watcherRows.map((w) => ({
      userId: String(w.user_id ?? ""),
      name: w.name != null ? String(w.name) : null,
      position: w.position_name != null ? String(w.position_name) : null,
      kind: String(w.kind ?? "ref"),
    })),
    refDoc,
    formRefFormId: r.form_ref_form_id != null ? String(r.form_ref_form_id) : null,
  };
}
