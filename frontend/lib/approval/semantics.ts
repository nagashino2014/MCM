import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { parseFields, type ApprovalFieldDef } from "@/lib/approval/fields";
import {
  LINK_ENTITY_LABEL,
  NON_LINK_FORMS,
  hasAttributionRef,
  hasCurrency,
  linkSlotsOf,
  tallySlot,
  type LinkEntity,
  type LinkSlot,
} from "@/lib/approval/linkage";
import { SYSTEM_SOURCE_CATALOG } from "@/lib/analytics/metric-types";

/*
 * 데이터 관계 맵·연결 진단(서버 전용) — SW-P1, 2026-10-21 전수조사 L0 로 확장.
 * 설계: docs/semantic-analytics-wizard-blueprint.md §4-2·§4-4, docs/approval-master-linkage-audit-2026-10-21.md §4.
 * 두 방향의 연결을 실측한다.
 *  ① 입력 참조 — 양식이 마스터를 가리키는 값(문서 필드·표 행·전용 화면 값). 연결 판정은 lib/approval/linkage.ts.
 *  ② 결과 원장 — 결재 완료 후 문서 id 를 기록하는 원장(연차 대장·카드·전표·증명서 …). LEDGERS 카탈로그.
 * ⚠ 클라이언트에서 import 금지(pg). 화면은 /api/approval/semantics 를 fetch 한다.
 */

/**
 * 시스템 소스 행 수 — 지표 엔진 카탈로그(metric-types SYSTEM_SOURCE_CATALOG)와 key 가 일치해야 한다.
 * 화면 설명(desc)과 행 수 SQL 만 여기서 정의한다.
 */
const SYSTEM_SOURCE_META: Record<string, { desc: string; countSql: string }> = {
  "system.contracts": { desc: "계약금액·용역분류·수행부서·발주처 — 마진율 계산의 분모", countSql: "SELECT count(*) FROM contracts" },
  "system.participants": { desc: "계약별 참여 인원·역할·수행 기간 — 인원별 수행 용역 수·평균 기간의 원천", countSql: "SELECT count(*) FROM service_participants" },
  "system.attendance": { desc: "주별 인정 연장·야간 가산 시간 — 초과근무 실측치(신청서와 별개 소스)", countSql: "SELECT count(*) FROM attendance_weekly" },
  "system.attendance_daily": { desc: "일별 실근무·연장 — 초과근무 신청과 근무일 단위 대조", countSql: "SELECT count(*) FROM attendance_daily" },
  "system.leave": { desc: "직원별 부여/사용/잔여 — 휴가 사용률 지표의 원천", countSql: "SELECT count(*) FROM annual_leave_ledger" },
  "system.invoices": { desc: "계약별 기성(세금계산서 발행) — 용역 매출, 마진율의 분자", countSql: "SELECT count(*) FROM contract_invoices" },
  "system.outsourcing": { desc: "계약별 외주 — 용역 원가(외주비)", countSql: "SELECT count(*) FROM contract_outsourcing" },
  "system.card": { desc: "법인카드 승인내역 — 지출결의 귀속 여부·용역별 카드 경비", countSql: "SELECT count(*) FROM card_transactions" },
};

/**
 * 결과 원장 카탈로그 — 결재 완료(또는 상신) 시 문서 id 를 기록하는 원장.
 * forms = 기록이 생기는 양식(기록 0건이어도 구조 선을 그린다). docCol = 문서 id 컬럼.
 * where = 같은 테이블을 여러 용도로 쓸 때의 조건(할 일의 link_kind 등).
 */
const LEDGERS: {
  key: string;
  label: string;
  group: "hr" | "finance" | "contract" | "work";
  table: string;
  docCol: string;
  where?: string;
  forms: string[];
}[] = [
  { key: "annual_leave_ledger", label: "연차 대장", group: "hr", table: "annual_leave_ledger", docCol: "doc_id", forms: ["frm-leave-request"] },
  { key: "employee_hr_events", label: "인사 이력", group: "hr", table: "employee_hr_events", docCol: "doc_id", forms: ["frm-resignation", "frm-leave-absence", "frm-hr-appointment"] },
  { key: "certificate_issues", label: "증명서 발급", group: "hr", table: "certificate_issues", docCol: "doc_id", forms: ["frm-certificate-request"] },
  { key: "absence_statement_requests", label: "결근사유서 요청", group: "hr", table: "absence_statement_requests", docCol: "doc_id", forms: ["frm-absence-statement"] },
  { key: "overtime_match_overrides", label: "초과근무 대조 예외", group: "hr", table: "overtime_match_overrides", docCol: "doc_id", forms: ["frm-overtime-request"] },
  { key: "labor_contracts", label: "근로계약", group: "hr", table: "labor_contracts", docCol: "approval_doc_id", forms: ["frm-labor-contract"] },
  { key: "payroll_ledgers", label: "급여·상여 대장", group: "hr", table: "payroll_ledgers", docCol: "plan_doc_id", forms: ["frm-bonus-payment-plan"] },
  { key: "bonus_period_settings", label: "성과급 산정 기간", group: "hr", table: "bonus_period_settings", docCol: "plan_doc_id", forms: ["frm-bonus-plan"] },
  { key: "severance_settlements", label: "퇴직 정산", group: "hr", table: "severance_settlements", docCol: "leave_pay_doc_id", forms: ["frm-annual-leave-pay"] },
  { key: "card_transactions", label: "법인카드 승인내역", group: "finance", table: "card_transactions", docCol: "doc_id", forms: ["frm-expense-report", "frm-biz-trip-report"] },
  { key: "personal_receipts", label: "개인 영수증", group: "finance", table: "personal_receipts", docCol: "doc_id", forms: ["frm-expense-personal", "frm-biz-trip-report"] },
  { key: "shop_receipts", label: "쇼핑몰 영수증", group: "finance", table: "shop_receipts", docCol: "doc_id", forms: ["frm-expense-report"] },
  { key: "expense_settlement_items", label: "경비 정산", group: "finance", table: "expense_settlement_items", docCol: "doc_id", forms: ["frm-expense-personal", "frm-biz-trip-report"] },
  { key: "journal_entries", label: "전표", group: "finance", table: "journal_entries", docCol: "doc_id", forms: ["frm-expense-report", "frm-expense-personal", "frm-biz-trip-report"] },
  { key: "income_payment_ledger", label: "사업·기타소득 대장", group: "finance", table: "income_payment_ledger", docCol: "doc_id", forms: ["frm-expert-fee"] },
  { key: "quotations", label: "견적 대장", group: "contract", table: "quotations", docCol: "doc_id", forms: ["frm-quotation"] },
  { key: "official_letters", label: "공문 발송 대장", group: "contract", table: "official_letters", docCol: "doc_id", forms: ["frm-official-letter"] },
  { key: "contract_deliverables", label: "착수·준공계", group: "contract", table: "contract_deliverables", docCol: "letter_doc_id", forms: ["frm-official-letter"] },
  { key: "contract_agreements", label: "계약서", group: "contract", table: "contract_agreements", docCol: "doc_id", forms: ["frm-agreement"] },
  { key: "vehicle_trip_logs", label: "차량 운행일지", group: "work", table: "vehicle_trip_logs", docCol: "doc_id", forms: ["frm-biz-trip-request"] },
  { key: "todo_items", label: "할 일(후속 작업)", group: "work", table: "todo_items", docCol: "link_id", where: "link_kind = 'approval_doc'", forms: ["frm-biz-trip-request", "frm-education-request"] },
];

export const LEDGER_GROUP_LABEL: Record<string, string> = {
  hr: "인사·근태 원장",
  finance: "재무·경비 원장",
  contract: "계약·영업 원장",
  work: "업무·자산 원장",
};

/**
 * 문서 id 를 남기지 않고 승인 문서를 읽어 가는 파생 경로 — 기록이 없어 건수 대신 경로만 표시한다.
 */
const DERIVED_READERS: { key: string; label: string; desc: string; forms: string[] }[] = [
  { key: "payroll_overtime", label: "급여 초과근무 대조", desc: "승인 문서를 ADT 일별 근태와 대조해 초과근무수당을 산정(lib/payroll/overtime.ts)", forms: ["frm-overtime-request"] },
  { key: "special_leave", label: "대체휴가 적재", desc: "ADT 업로드 때 승인 초과근무로 대체휴가를 적재(special_leave_ledger, ref_key 기준)", forms: ["frm-overtime-request"] },
  { key: "trip_allowance", label: "숙박출장수당", desc: "출장 신청·보고의 출장 분류로 급여 숙박수당 산정(lib/payroll/trip-allowance.ts)", forms: ["frm-biz-trip-request", "frm-biz-trip-report"] },
  { key: "calendar", label: "일정(캘린더)", desc: "출장·휴가·교육 일정을 승인 문서에서 실시간 파생(lib/calendar/queries.ts)", forms: ["frm-biz-trip-request", "frm-leave-request", "frm-education-request"] },
];

export interface RefEdge {
  formId: string;
  formName: string;
  /** doc = 문서 필드, row = 표 행, value = 전용 화면 값 경로 */
  level: LinkSlot["level"];
  fieldKey: string;
  columnKey?: string;
  fieldLabel: string;
  entity: LinkEntity;
  entityLabel: string;
  /** 문서·값 슬롯은 문서 수, 표 행 슬롯은 값이 있는 행 수 */
  totalDocs: number;
  linkedDocs: number;
  manualDocs: number; // '직접 입력'(마스터 미연결)
  missingDocs: number;
}

export interface ResultEdge {
  formId: string;
  ledgerKey: string;
  /** 이 양식 문서 중 원장에 기록된 문서 수(null = 원장 미구축·컬럼 없음) */
  recordedDocs: number | null;
  /** 승인 문서 수 — 기록 비율의 참고 분모(지출처럼 문서마다 기록이 없을 수도 있는 원장이 있다) */
  approvedDocs: number;
}

export interface SemanticsWarning {
  kind: "travel_tag_outside" | "travel_option_in_expense" | "untagged" | "no_attribution" | "manual_ratio";
  formId: string;
  formName: string;
  message: string;
}

export interface SemanticsOverview {
  forms: {
    formId: string;
    name: string;
    version: number;
    submittedDocs: number;
    approvedDocs: number;
    untaggedCount: number;
    taggedConcepts: string[]; // ref.* 제외, 명시 태깅된 개념 key 목록(중복 제거)
    /** 연계 대상이 아닌 양식이면 사유(공지성) */
    nonLinkReason: string | null;
    /** 선행 양식(ref_form_id)이 있으면 선행 문서가 연결된 제출 문서 수 */
    refLink: { refFormName: string; linkedDocs: number } | null;
  }[];
  edges: RefEdge[];
  ledgers: { key: string; label: string; group: string; rows: number | null }[];
  resultEdges: ResultEdge[];
  derived: { key: string; label: string; desc: string; forms: string[] }[];
  systemSources: { key: string; label: string; desc: string; rows: number | null }[];
  warnings: SemanticsWarning[];
}

/** 경비 채널 정책(§4-4): 출장 경비(cost.travel)의 표준 입력 양식 */
const TRAVEL_FORM_ID = "frm-biz-trip-report";
const EXPENSE_FORM_ID = "frm-expense-report";
const TRAVEL_OPTION_PATTERN = /교통비|숙박비|유류비|일비|출장/;
/** 직접 입력 비율 경고 기준(L4) — 표본이 너무 적으면 경고하지 않는다 */
const MANUAL_RATIO_LIMIT = 0.3;
const MANUAL_RATIO_MIN_TOTAL = 5;

interface DocRow {
  docId: string;
  docNo: string | null;
  formId: string;
  status: string;
  drafterName: string | null;
  submittedAt: string | null;
  refDocId: string | null;
  fv: Record<string, unknown>;
}

function parseValues(v: unknown): Record<string, unknown> {
  try {
    const o = typeof v === "string" ? JSON.parse(v) : v;
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function loadSubmittedDocs(formId?: string): Promise<DocRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT doc_id, doc_no, form_id, status, drafter_name, submitted_at, ref_doc_id, field_values
         FROM approval_docs WHERE status <> 'draft' ${formId ? "AND form_id = $1" : ""}
        ORDER BY submitted_at DESC NULLS LAST`,
      formId ? [formId] : []
    )
  );
  return rows.map((r) => ({
    docId: String(r.doc_id ?? ""),
    docNo: r.doc_no != null ? String(r.doc_no) : null,
    formId: String(r.form_id ?? ""),
    status: String(r.status ?? ""),
    drafterName: r.drafter_name != null ? String(r.drafter_name) : null,
    submittedAt: r.submitted_at != null ? String(r.submitted_at) : null,
    refDocId: r.ref_doc_id != null ? String(r.ref_doc_id) : null,
    fv: parseValues(r.field_values),
  }));
}

/** 원장 테이블 행 수·양식별 기록 문서 수(테이블·컬럼 미존재는 null — 화면에서 '미구축') */
async function ledgerCounts(): Promise<Map<string, { rows: number | null; byForm: Map<string, number> | null }>> {
  const db = await getDb();
  const out = new Map<string, { rows: number | null; byForm: Map<string, number> | null }>();
  for (const l of LEDGERS) {
    let rows: number | null = null;
    let byForm: Map<string, number> | null = null;
    try {
      const where = l.where ? `WHERE ${l.where}` : "";
      const rr = rowsToObjects(await db.exec(`SELECT count(*)::int AS n FROM ${l.table} ${where}`));
      rows = Number(rr[0]?.n ?? 0);
      const fr = rowsToObjects(
        await db.exec(
          `SELECT d.form_id, count(DISTINCT x.${l.docCol})::int AS n
             FROM ${l.table} x JOIN approval_docs d ON d.doc_id = x.${l.docCol}
            ${l.where ? `WHERE x.${l.where}` : ""}
            GROUP BY d.form_id`
        )
      );
      byForm = new Map(fr.map((r) => [String(r.form_id), Number(r.n ?? 0)]));
    } catch {
      // 테이블 또는 문서 id 컬럼 미구축(예: 인사 이력 doc_id 는 307 적용 후) — null 로 표시
    }
    out.set(l.key, { rows, byForm });
  }
  return out;
}

export async function getSemanticsOverview(): Promise<SemanticsOverview> {
  const db = await getDb();
  const formRows = rowsToObjects(
    // 사용 해제 양식도 제출 문서가 있으면 포함한다(과거 문서의 연결 진단이 빠지지 않게).
    await db.exec(
      `SELECT f.form_id, f.name, f.version, f.fields, f.ref_form_id FROM approval_forms f
        WHERE f.use_yn = 1 OR EXISTS (SELECT 1 FROM approval_docs d WHERE d.form_id = f.form_id AND d.status <> 'draft')
        ORDER BY f.sort_order, f.name`
    )
  );
  const formName = new Map(formRows.map((r) => [String(r.form_id), String(r.name ?? "")]));
  const docs = await loadSubmittedDocs();
  const docsByForm = new Map<string, DocRow[]>();
  for (const d of docs) docsByForm.set(d.formId, [...(docsByForm.get(d.formId) ?? []), d]);

  const forms: SemanticsOverview["forms"] = [];
  const edges: RefEdge[] = [];
  const warnings: SemanticsWarning[] = [];
  const ledgerStat = await ledgerCounts();
  const resultEdges: ResultEdge[] = [];

  for (const r of formRows) {
    const formId = String(r.form_id ?? "");
    const name = String(r.name ?? "");
    const fields = parseFields(r.fields);
    const formDocs = docsByForm.get(formId) ?? [];
    const approvedDocs = formDocs.filter((d) => d.status === "approved").length;
    const nonLinkReason = NON_LINK_FORMS[formId] ?? null;

    // 미태깅(분석 후보인데 의미 미지정) — §8-6 소프트 안내의 진단 화면 버전
    const untagged = fields.filter(
      (f) => ["currency", "number", "date", "period"].includes(f.type) && !f.semantic?.concept
    );
    if (untagged.length > 0 && !nonLinkReason) {
      warnings.push({
        kind: "untagged",
        formId,
        formName: name,
        message: `의미 미지정 금액·날짜 항목 ${untagged.length}개 (${untagged.map((f) => f.label).join(", ")})`,
      });
    }

    // 명시 태깅된 개념(필드 + 표 열)
    const tagged = new Set<string>();
    for (const f of fields) {
      if (f.semantic?.concept) tagged.add(f.semantic.concept);
      for (const c of f.tableColumns ?? []) if (c.semantic?.concept) tagged.add(c.semantic.concept);
    }
    channelWarnings(formId, name, fields, tagged, warnings);

    // ① 입력 참조 엣지 — 문서·표 행·전용 화면 값
    const slots = linkSlotsOf(formId, fields);
    for (const slot of slots) {
      const sum = { total: 0, linked: 0, manual: 0, missing: 0 };
      for (const d of formDocs) {
        const t = tallySlot(slot, d.fv);
        sum.total += t.total;
        sum.linked += t.linked;
        sum.manual += t.manual;
        sum.missing += t.missing;
      }
      edges.push({
        formId,
        formName: name,
        level: slot.level,
        fieldKey: slot.fieldKey,
        columnKey: slot.columnKey,
        fieldLabel: slot.fieldLabel,
        entity: slot.entity,
        entityLabel: LINK_ENTITY_LABEL[slot.entity],
        totalDocs: sum.total,
        linkedDocs: sum.linked,
        manualDocs: sum.manual,
        missingDocs: sum.missing,
      });
      if (sum.total >= MANUAL_RATIO_MIN_TOTAL && sum.manual / sum.total > MANUAL_RATIO_LIMIT) {
        warnings.push({
          kind: "manual_ratio",
          formId,
          formName: name,
          message: `'${slot.fieldLabel}' → ${LINK_ENTITY_LABEL[slot.entity]} 직접 입력 ${sum.manual}/${sum.total}건(${Math.round((sum.manual / sum.total) * 100)}%) — 마스터에 연결되지 않아 ${LINK_ENTITY_LABEL[slot.entity]}별 집계에서 빠집니다. 연결 품질 상세에서 보정하세요.`,
        });
      }
    }

    // §4-2 "참조 필드 없음" 안내 — 금액이 있는데 귀속 참조가 없는 양식
    if (!nonLinkReason && hasCurrency(fields) && !hasAttributionRef(slots)) {
      warnings.push({
        kind: "no_attribution",
        formId,
        formName: name,
        message: "금액 항목이 있는데 관련 용역·업체·부서·직원 참조 항목이 없어 용역·부서별 집계에서 제외됩니다 — 빌더에서 '계약 검색' 항목을 추가하세요.",
      });
    }

    // ② 결과 원장 엣지
    for (const l of LEDGERS) {
      if (!l.forms.includes(formId)) continue;
      const st = ledgerStat.get(l.key);
      resultEdges.push({
        formId,
        ledgerKey: l.key,
        recordedDocs: st?.byForm ? st.byForm.get(formId) ?? 0 : null,
        approvedDocs,
      });
    }

    const refFormId = r.ref_form_id != null ? String(r.ref_form_id) : null;
    forms.push({
      formId,
      name,
      version: Number(r.version ?? 1),
      submittedDocs: formDocs.length,
      approvedDocs,
      untaggedCount: untagged.length,
      taggedConcepts: [...tagged],
      nonLinkReason,
      refLink: refFormId
        ? { refFormName: formName.get(refFormId) ?? refFormId, linkedDocs: formDocs.filter((d) => d.refDocId).length }
        : null,
    });
  }

  // 시스템 소스 행 수(테이블 미존재 등 실패는 null — 화면에서 '미구축' 표시)
  const systemSources: SemanticsOverview["systemSources"] = [];
  for (const s of SYSTEM_SOURCE_CATALOG) {
    const meta = SYSTEM_SOURCE_META[s.key];
    let rows: number | null = null;
    if (meta) {
      try {
        const rr = rowsToObjects(await db.exec(meta.countSql));
        rows = Number(Object.values(rr[0] ?? {})[0] ?? 0);
      } catch {
        rows = null;
      }
    }
    systemSources.push({ key: s.key, label: s.label, desc: meta?.desc ?? "", rows });
  }

  return {
    forms,
    edges,
    ledgers: LEDGERS.map((l) => ({ key: l.key, label: l.label, group: l.group, rows: ledgerStat.get(l.key)?.rows ?? null })),
    resultEdges,
    derived: DERIVED_READERS,
    systemSources,
    warnings,
  };
}

function channelWarnings(formId: string, name: string, fields: ApprovalFieldDef[], tagged: Set<string>, warnings: SemanticsWarning[]) {
  // 채널 위반(§4-4): cost.travel 이 표준 양식 밖에 태깅됨
  if (tagged.has("cost.travel") && formId !== TRAVEL_FORM_ID) {
    warnings.push({
      kind: "travel_tag_outside",
      formId,
      formName: name,
      message: `출장 경비(cost.travel) 태그가 출장보고서 외 양식에 있습니다 — 경비 채널 정책(출장 경비=출장보고서 일원화)과 충돌`,
    });
  }
  // 채널 위반: 지출결의서 분류 옵션에 출장성 항목 잔존
  if (formId === EXPENSE_FORM_ID) {
    for (const f of fields) {
      for (const c of f.tableColumns ?? []) {
        const bad = (c.options ?? []).filter((o) => TRAVEL_OPTION_PATTERN.test(o));
        if (c.key === "category" && bad.length) {
          warnings.push({
            kind: "travel_option_in_expense",
            formId,
            formName: name,
            message: `지출결의서 분류 옵션에 출장성 항목이 남아 있습니다: ${bad.join(", ")}`,
          });
        }
      }
    }
  }
}

export interface MissingDoc {
  docId: string;
  docNo: string | null;
  status: string;
  drafterName: string | null;
  submittedAt: string | null;
  manual: boolean;
  /** 직접 입력 값(문서 단위 계약·업체 슬롯) — 보정 대응표의 키 */
  manualText: string | null;
}

async function findSlot(formId: string, fieldKey: string, columnKey: string | null, entity: string | null): Promise<LinkSlot | null> {
  const db = await getDb();
  const formRows = rowsToObjects(await db.exec("SELECT fields FROM approval_forms WHERE form_id = $1", [formId]));
  if (!formRows.length) return null;
  const slots = linkSlotsOf(formId, parseFields(formRows[0].fields));
  return (
    slots.find(
      (s) => s.fieldKey === fieldKey && (s.columnKey ?? null) === (columnKey || null) && (!entity || s.entity === entity)
    ) ?? null
  );
}

/** 문서 단위 계약·업체 값의 직접 입력 텍스트 */
function manualTextOf(slot: LinkSlot, fv: Record<string, unknown>): string | null {
  if (slot.level !== "doc") return null;
  const v = fv[slot.fieldKey];
  if (!v || typeof v !== "object" || Array.isArray(v)) return typeof v === "string" && v.trim() ? v.trim() : null;
  const o = v as Record<string, unknown>;
  const s = String(o.title ?? o.name ?? "").trim();
  return s || null;
}

/** 특정 양식×참조 슬롯의 미연결(또는 직접 입력) 문서 목록 — 진단 상세에서 원인 추적용. */
export async function listUnlinkedDocs(
  formId: string,
  fieldKey: string,
  opts: { columnKey?: string | null; entity?: string | null; limit?: number } = {}
): Promise<MissingDoc[]> {
  const slot = await findSlot(formId, fieldKey, opts.columnKey ?? null, opts.entity ?? null);
  if (!slot) return [];
  const limit = Math.max(1, Math.min(200, opts.limit ?? 100));
  const out: MissingDoc[] = [];
  for (const d of await loadSubmittedDocs(formId)) {
    const t = tallySlot(slot, d.fv);
    if (t.manual + t.missing === 0) continue;
    out.push({
      docId: d.docId,
      docNo: d.docNo,
      status: d.status,
      drafterName: d.drafterName,
      submittedAt: d.submittedAt,
      manual: t.manual > 0,
      manualText: t.manual > 0 ? manualTextOf(slot, d.fv) : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 직접 입력 보정(L2) — 같은 직접 입력 값을 가진 문서들을 한 번에 마스터에 연결한다.
 * 대상: 문서 단위 계약(contract_select)·업체(company_select) 슬롯. 원래 입력값은 originalTitle/originalName 으로 보존.
 * 후보 제시는 기존 /api/approval/related-search(계약·사업장 검색)를 쓰고, 확정은 사람이 한다(자동 확정 없음, D-3).
 */
export async function relinkManualValue(input: {
  formId: string;
  fieldKey: string;
  entity: "contract" | "company";
  manualText: string;
  targetId: string;
}): Promise<{ updated: number; label: string }> {
  const slot = await findSlot(input.formId, input.fieldKey, null, input.entity);
  if (!slot || slot.level !== "doc") throw new Error("보정할 수 있는 참조 항목이 아닙니다(문서 단위 계약·업체 검색 항목만).");
  const text = input.manualText.trim();
  if (!text) throw new Error("직접 입력 값이 비어 있습니다.");
  return withDbWrite(async (db) => {
    let value: Record<string, unknown>;
    let label: string;
    if (input.entity === "contract") {
      const rows = rowsToObjects(
        await db.exec(
          `SELECT c.contract_id, c.contract_title, c.counterparty_facility_id
             FROM contracts c WHERE c.contract_id = $1 AND c.deleted_at IS NULL`,
          [input.targetId]
        )
      );
      if (!rows.length) throw new Error("계약을 찾을 수 없습니다.");
      label = String(rows[0].contract_title ?? "");
      value = { title: label, contractId: String(rows[0].contract_id), originalTitle: text };
      if (rows[0].counterparty_facility_id) value.counterpartyFacilityId = String(rows[0].counterparty_facility_id);
    } else {
      const rows = rowsToObjects(
        await db.exec(`SELECT facility_id, company_name FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL`, [input.targetId])
      );
      if (!rows.length) throw new Error("사업장을 찾을 수 없습니다.");
      label = String(rows[0].company_name ?? "");
      value = { name: label, facilityId: String(rows[0].facility_id), originalName: text };
    }
    const textKey = input.entity === "contract" ? "title" : "name";
    const res = rowsToObjects(
      await db.exec(
        `UPDATE approval_docs
            SET field_values = jsonb_set(field_values::jsonb, ARRAY[$2::text], $3::jsonb, true),
                updated_at = now()::text
          WHERE form_id = $1 AND status <> 'draft'
            AND field_values::jsonb -> $2 ->> 'manual' = 'true'
            AND btrim(field_values::jsonb -> $2 ->> '${textKey}') = $4
          RETURNING doc_id`,
        [input.formId, input.fieldKey, JSON.stringify(value), text]
      )
    );
    return { updated: res.length, label };
  });
}
