import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { parseFields, type ApprovalFieldDef } from "@/lib/approval/fields";
import { getForm } from "@/lib/approval/forms";
import { recordLeaveUsageOnApproval } from "@/lib/approval/leave";
import { assessOverLimitOnSubmit } from "@/lib/approval/overtime";
import { resolveOpenCancelRequests } from "@/lib/approval/cancel";
import { notifyPendingSteps, notifyDrafterResult } from "@/lib/approval/notify";
import { generateDocSummary } from "@/lib/approval/summarize";
import { markLetterPendingOnApproval } from "@/lib/letter/store";
import { markQuotePendingOnApproval } from "@/lib/quote/store";

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

// 견적(136) — rule_key `견적:{종류}` 5종(통합허가/화관법/HAPs/ESG/기타), 포맷 `{연도}-{종류}-{NNNN}`.
// = lib/quote/types.ts QUOTE_RULE_PREFIX/QUOTE_NO_LABEL_BY_SERVICE_TYPE (DB 계층은 클라이언트 모듈 미참조)
const QUOTE_RULE_PREFIX = "견적:";
const QUOTE_NO_LABELS: Record<string, string> = {
  통합허가: "통합허가",
  "장외&화관법": "화관법",
  HAPs: "HAPs",
  ESG탄소중립: "ESG",
  기타: "기타",
};

async function allocateDocNo(txn: PgDatabase, ruleKey: string, year: string): Promise<string> {
  const isLetter = ruleKey === LETTER_RULE_KEY;
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
            [ruleKey, year, isLetter ? 1001 : 1]
          )
        )[0]?.last_seq ?? 1
      );
  if (isLetter) return `${year}-${ruleKey}-${String(seq).padStart(5, "0")}`;
  if (isQuote) return `${year}-${ruleKey.slice(QUOTE_RULE_PREFIX.length)}-${String(seq).padStart(4, "0")}`;
  return `${ruleKey}-${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * 대결 라우팅(§8-4) — 결재 차례가 도래한 시점에 결재자가 '승인된 휴가' 기간 중이고
 * 대결자가 지정돼 있으면 대결자로 교체한다(delegated_from 기록). 출장은 대상이 아니다.
 */
async function resolveDelegate(db: PgDatabase, assigneeUserId: string): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ad.delegate_user_id
         FROM approval_delegates ad
        WHERE ad.user_id = $1 AND ad.enabled = 1
          AND EXISTS (
            SELECT 1 FROM approval_docs ld
             WHERE ld.form_id = 'frm-leave-request' AND ld.status = 'approved'
               AND ld.drafter_user_id = $1
               AND ld.field_values->'leave_period'->>'from' <= $2
               AND ld.field_values->'leave_period'->>'to' >= $2
          )`,
      [assigneeUserId, today]
    )
  );
  return rows.length ? String(rows[0].delegate_user_id) : null;
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
  actorUserId: string;
}): Promise<string> {
  const form = await getForm(params.formId);
  if (!form) throw new Error("양식을 찾을 수 없습니다.");
  const docId = params.docId ?? "adoc-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const now = new Date().toISOString();
  const drafter = await loadDrafterSnapshot(params.actorUserId);
  const snaps = await loadAssigneeSnapshots(params.line.map((s) => s.assigneeUserId));
  const watchers = (params.watchers ?? []).filter((w) => w.userId && (w.kind === "ref" || w.kind === "view"));

  await withDbWrite(async (txn) => {
    if (params.docId) {
      const owned = rowsToObjects(
        await txn.exec(`SELECT drafter_user_id, status FROM approval_docs WHERE doc_id = $1`, [params.docId])
      );
      if (!owned.length) throw new Error("문서를 찾을 수 없습니다.");
      if (String(owned[0].drafter_user_id) !== params.actorUserId) throw new Error("본인 기안만 수정할 수 있습니다.");
      if (!["draft", "rejected"].includes(String(owned[0].status))) throw new Error("작성중/반려 문서만 수정할 수 있습니다.");
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
        JSON.stringify(params.fieldValues ?? {}),
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
  });
  return docId;
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
    await txn.run(`DELETE FROM approval_docs WHERE doc_id = $1`, [docId]);
    // 문서번호 반납(130) — 다음 상신이 이 번호를 이어받는다.
    // 형식: 일반 `{약칭}-{연도}-{일련}` / 공문(135) `{연도}-대외-{일련}` / 견적(136) `{연도}-{종류}-{일련}`.
    const letterM = docNo ? new RegExp(`^(\\d{4})-(${LETTER_RULE_KEY})-(\\d+)$`).exec(docNo) : null;
    const quoteLabels = Object.values(QUOTE_NO_LABELS).join("|");
    const quoteM = !letterM && docNo ? new RegExp(`^(\\d{4})-(${quoteLabels})-(\\d+)$`).exec(docNo) : null;
    const m = !letterM && !quoteM && docNo ? /^(.+)-(\d{4})-(\d+)$/.exec(docNo) : null;
    const pool = letterM
      ? { rule: letterM[2], year: letterM[1], seq: Number(letterM[3]) }
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

/** 특정 order 의 waiting 단계를 pending 으로 — 대결 라우팅을 여기서 적용한다. activated_at 기록(체류시간 산출용). */
async function activateOrder(txn: PgDatabase, docId: string, order: number): Promise<void> {
  const now = new Date().toISOString();
  const steps = rowsToObjects(
    await txn.exec(`SELECT step_id, assignee_user_id FROM approval_steps WHERE doc_id = $1 AND step_order = $2 AND status = 'waiting'`, [
      docId,
      order,
    ])
  );
  for (const s of steps) {
    const assignee = String(s.assignee_user_id);
    const delegate = await resolveDelegate(txn, assignee);
    if (delegate && delegate !== assignee) {
      const snap = await loadAssigneeSnapshots([delegate]);
      await txn.run(
        `UPDATE approval_steps SET status = 'pending', activated_at = $6, assignee_user_id = $2, assignee_name = $3, assignee_position = $4, delegated_from = $5
          WHERE step_id = $1`,
        [String(s.step_id), delegate, snap.get(delegate)?.name ?? null, snap.get(delegate)?.position ?? null, assignee, now]
      );
    } else {
      await txn.run(`UPDATE approval_steps SET status = 'pending', activated_at = $2 WHERE step_id = $1`, [String(s.step_id), now]);
    }
  }
}

/** 상신 — 채번 + 첫 단계 활성화. draft/rejected 상태에서만 가능(본인 기안). */
export async function submitDoc(docId: string, actorUserId: string): Promise<{ docNo: string }> {
  let docNo = "";
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(
        `SELECT d.status, d.drafter_user_id, d.doc_no, f.doc_no_rule, f.name AS form_name,
                d.field_values->>'service_type' AS quote_service_type
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
    // 재상신 대비 — 모든 단계를 waiting 초기화 후 1차 활성화
    await txn.run(`UPDATE approval_steps SET status = 'waiting', acted_at = NULL, comment = NULL WHERE doc_id = $1`, [docId]);
    await activateOrder(txn, docId, 1);
    // 초과근무 신청 — 주 12h 초과 판정을 상신 시점에 고정 저장(결재 화면 경고 배너의 근거).
    await assessOverLimitOnSubmit(txn, docId);
  });
  // 커밋 후 — 첫 결재자에게 알림(fire-and-forget, 실패해도 상신은 완료)
  await notifyPendingSteps(docId);
  // AI 요약 생성(상신 시 자동, 비차단) — 결재자가 열기 전 준비. 실패해도 원문 폴백.
  void generateDocSummary(docId).catch(() => {});
  return { docNo };
}

/** 승인/반려 — 본인 pending 단계에만. 병렬 합의는 전원 승인 시 다음 order 로. */
export async function actOnDoc(params: {
  docId: string;
  stepId: string;
  action: "approve" | "reject";
  comment: string | null;
  actorUserId: string;
}): Promise<{ docStatus: string }> {
  let docStatus = "in_progress";
  await withDbWrite(async (txn) => {
    const steps = rowsToObjects(
      await txn.exec(`SELECT * FROM approval_steps WHERE doc_id = $1 ORDER BY step_order, created_at`, [params.docId])
    );
    const me = steps.find((s) => String(s.step_id) === params.stepId);
    if (!me) throw new Error("결재 단계를 찾을 수 없습니다.");
    if (String(me.assignee_user_id) !== params.actorUserId) throw new Error("본인에게 배정된 결재만 처리할 수 있습니다.");
    if (String(me.status) !== "pending") throw new Error("현재 결재 차례가 아닙니다.");

    const now = new Date().toISOString();
    if (params.action === "reject") {
      await txn.run(`UPDATE approval_steps SET status = 'rejected', acted_at = $2, comment = $3 WHERE step_id = $1`, [
        params.stepId,
        now,
        params.comment,
      ]);
      await txn.run(`UPDATE approval_steps SET status = 'skipped' WHERE doc_id = $1 AND status IN ('waiting','pending') AND step_id <> $2`, [
        params.docId,
        params.stepId,
      ]);
      await txn.run(`UPDATE approval_docs SET status = 'rejected', completed_at = $2, updated_at = $2 WHERE doc_id = $1`, [
        params.docId,
        now,
      ]);
      // 기안자의 반려 요청(취소 요청, 124)이 걸려 있었다면 이 반려로 처리 완료된 것 — 자동 마감.
      await resolveOpenCancelRequests(txn, params.docId, "rejected", params.actorUserId);
      docStatus = "rejected";
      return;
    }

    await txn.run(`UPDATE approval_steps SET status = 'approved', acted_at = $2, comment = $3 WHERE step_id = $1`, [
      params.stepId,
      now,
      params.comment,
    ]);
    const myOrder = Number(me.step_order);
    const sameOrderPending = steps.filter(
      (s) => Number(s.step_order) === myOrder && String(s.step_id) !== params.stepId && ["waiting", "pending"].includes(String(s.status))
    );
    if (sameOrderPending.length === 0) {
      const nextOrders = steps.filter((s) => Number(s.step_order) > myOrder).map((s) => Number(s.step_order));
      if (nextOrders.length === 0) {
        await txn.run(`UPDATE approval_docs SET status = 'approved', completed_at = $2, updated_at = $2 WHERE doc_id = $1`, [
          params.docId,
          now,
        ]);
        docStatus = "approved";
        // 휴가신청 승인 완료 → 연차 대장 use 적재(연차·반차만, doc당 1회)
        await recordLeaveUsageOnApproval(txn, params.docId);
        // 공문(135) 승인 완료 → 발송 대장 pending 등록(발송 자체는 커밋 후 비동기)
        await markLetterPendingOnApproval(txn, params.docId);
        // 견적(136) 승인 완료 → 발송 대장 pending 등록(산출물 생성·발송은 커밋 후 비동기)
        await markQuotePendingOnApproval(txn, params.docId);
      } else {
        await activateOrder(txn, params.docId, Math.min(...nextOrders));
        await txn.run(`UPDATE approval_docs SET updated_at = $2 WHERE doc_id = $1`, [params.docId, now]);
      }
    }
  });
  // 커밋 후 알림 — 최종 승인/반려는 기안자에게, 진행 중이면 다음 결재자에게(단계별 멱등).
  if (docStatus === "approved") await notifyDrafterResult(params.docId, "approved");
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
        WHERE s.assignee_user_id = $1 AND s.status = $2 AND d.status = 'in_progress'
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

/** 부서 문서함 — 본인 부서의 완료 문서(기안 완료함). */
export async function listDeptDocs(userId: string, limit = 50): Promise<ArchiveDocRow[]> {
  const deptId = await getUserDeptId(userId);
  if (!deptId) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.*, f.name AS form_name, f.retention_years, f.org_folder FROM approval_docs d
         JOIN approval_forms f ON f.form_id = d.form_id
        WHERE d.dept_id = $1 AND d.status IN ('approved','rejected')
        ORDER BY d.completed_at DESC NULLS LAST LIMIT $2`,
      [deptId, limit]
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
    await db.exec(`SELECT * FROM approval_steps WHERE doc_id = $1 ORDER BY step_order, created_at`, [docId])
  );
  const watcherRows = rowsToObjects(
    await db.exec(
      `SELECT w.user_id, w.kind, COALESCE(ep.name, u.email) AS name
         FROM approval_watchers w
         LEFT JOIN users u ON u.user_id = w.user_id
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
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
      kind: String(w.kind ?? "ref"),
    })),
    refDoc,
    formRefFormId: r.form_ref_form_id != null ? String(r.form_ref_form_id) : null,
  };
}
