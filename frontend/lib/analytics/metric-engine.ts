import { getDb, rowsToObjects } from "@/lib/db";
import { parseFields, type ApprovalFieldDef } from "@/lib/approval/fields";
import { judgeRefValue, linkSlotsOf, ROW_EMPLOYEE_KEY, type LinkEntity } from "@/lib/approval/linkage";
import type { AggregateDefinition, CompositeDefinition, MetricDefinition, MetricItem, MetricResult } from "@/lib/analytics/metric-types";
import { axisOf, formulaMetricKeys, isRefDimension, validateDefinition } from "@/lib/analytics/metric-types";

/*
 * 지표 실행 엔진(서버 전용) — SW-P2. 설계: docs/semantic-analytics-wizard-blueprint.md §4-3.
 * 원칙(§3): 선언적 정의 + 화이트리스트 실행(자유 SQL/eval 금지), 지표는 태그 참조,
 * 모든 결과에 진단 메타(대상/제외 사유) 동봉.
 * 구현 노트: 결재 문서 소스는 SQL 로 문서를 로드한 뒤 JS 에서 태그 해석·표 행 전개·집계한다
 * (문서 수천 건 이하 실시간 전제 §8-5 — 표 행 전개·행 단위 진단 메타 산출에 SQL 보다 명료).
 * 시스템 소스는 카탈로그에 고정된 SQL 템플릿으로만 집계한다(semantics.ts SYSTEM_SOURCE_META 와 짝).
 * 2026-10-21 결재 연계 L3(docs/approval-master-linkage-audit-2026-10-21.md §4):
 *  - 참조 해석을 lib/approval/linkage.ts 로 일원화(자산·업체 담당자·휴가 종류 참조, 부서 ID 저장)
 *  - 기안자(doc.drafter)·기안 부서(doc.dept) 차원 — 모든 양식을 직원·부서 축으로 시스템 소스와 결합
 *  - 표 행 단위 귀속 — 지출 행의 연관 용역/사업장(_relatedContractId/_relatedFacilityId), 명세 표의 행 직원(_employeeId)
 *  - 시스템 소스 추가(기성·외주·법인카드·일별 근태)와 부서·발주처 차원
 *  - 복합 지표의 결합 축 정합 검사·시간축 결합
 * ⚠ 클라이언트 import 금지(pg).
 */

interface FlatRow {
  value: number | null;
  groupId: string | null;
  groupLabel: string;
  time: string | null;
}

/**
 * 계약금액대 밴드 — 연속값(계약금액)을 분석 가능한 구간 차원으로 변환한다.
 * 세분류가 같아도 규모에 따라 공량이 크게 다르므로, 같은 세분류 안에서 비슷한 금액대끼리 묶어
 * 평균 수행 기간 등을 비교하는 용도(사용자 확정 아이디어). 라벨의 번호 프리픽스는 정렬용.
 */
const AMOUNT_BAND_SQL = (col: string) => `CASE
  WHEN ${col} IS NULL OR ${col} <= 0 THEN NULL
  WHEN ${col} < 10000000 THEN '1) 1천만 미만'
  WHEN ${col} < 30000000 THEN '2) 1천만~3천만'
  WHEN ${col} < 50000000 THEN '3) 3천만~5천만'
  WHEN ${col} < 100000000 THEN '4) 5천만~1억'
  WHEN ${col} < 300000000 THEN '5) 1억~3억'
  ELSE '6) 3억 이상' END`;

/** 계약 축 공통 차원(계약·발주처·수행 부서·대분류) — alias c = contracts */
const CONTRACT_AXIS_DIMS = {
  "ref.contract": { idExpr: "c.contract_id", labelExpr: "c.contract_title" },
  "ref.company": { idExpr: "c.counterparty_facility_id", labelExpr: "cf.company_name" },
  "ref.dept": { idExpr: "c.owning_dept_id", labelExpr: "cd.dept_name" },
  "dim.category": { idExpr: "c.service_type", labelExpr: "c.service_type" },
};
const CONTRACT_AXIS_JOINS =
  "LEFT JOIN facilities cf ON cf.facility_id = c.counterparty_facility_id LEFT JOIN departments cd ON cd.dept_id = c.owning_dept_id";

/** ── 시스템 소스 카탈로그(실행 스펙) — 여기 정의된 field/dim/time 만 조회 가능 ── */
const SYSTEM_SPECS: Record<
  string,
  {
    measures: Record<string, string>; // field key → SQL 집계식 내부의 값 표현식
    dims: Record<string, { idExpr: string; labelExpr: string }>;
    times: Record<string, string>; // time field key → 날짜 표현식(YYYY-MM-DD 이상 텍스트)
    from: string;
  }
> = {
  "system.contracts": {
    from: `contracts c ${CONTRACT_AXIS_JOINS}`,
    measures: { amount: "c.contract_amount", count: "1" },
    dims: {
      ...CONTRACT_AXIS_DIMS,
      "dim.subcategory": { idExpr: "c.service_subtype", labelExpr: "c.service_subtype" },
      "dim.amount_band": { idExpr: AMOUNT_BAND_SQL("c.contract_amount"), labelExpr: AMOUNT_BAND_SQL("c.contract_amount") },
    },
    times: { contract_date: "c.started_at" },
  },
  "system.invoices": {
    // 기성 = 계약별 세금계산서 발행(contract_invoices) — 용역 매출, 마진율의 분자
    from: `contract_invoices ci JOIN contracts c ON c.contract_id = ci.contract_id ${CONTRACT_AXIS_JOINS}`,
    measures: { supply_amount: "ci.supply_amount", invoice_amount: "ci.invoice_amount", count: "1" },
    dims: CONTRACT_AXIS_DIMS,
    times: { issue_date: "ci.issue_date" },
  },
  "system.outsourcing": {
    // 외주 = 용역 원가(외주비)
    from: `contract_outsourcing co JOIN contracts c ON c.contract_id = co.contract_id ${CONTRACT_AXIS_JOINS}`,
    measures: { amount: "co.amount", count: "1" },
    dims: CONTRACT_AXIS_DIMS,
    times: { contract_date: "co.contract_date" },
  },
  "system.card": {
    // 법인카드 승인내역(회계 보호 표 — 읽기 집계만). 승인 건만 금액으로 본다(취소·거절 제외), 경비 아님 표시 건 제외.
    from:
      "card_transactions ct LEFT JOIN card_registry cr ON cr.card_id = ct.card_id LEFT JOIN employee_profiles ep ON ep.employee_id = cr.holder_employee_id LEFT JOIN departments ed ON ed.dept_id = ep.dept_id LEFT JOIN expense_card_tags tg ON tg.card_txn_id = ct.card_txn_id LEFT JOIN contracts tc ON tc.contract_id = tg.related_contract_id LEFT JOIN facilities tf ON tf.facility_id = tg.related_facility_id",
    measures: {
      amount: "CASE WHEN ct.approval_type = '승인' AND ct.excluded = 0 THEN ct.amount_total END",
      unlinked_amount: "CASE WHEN ct.approval_type = '승인' AND ct.excluded = 0 AND ct.doc_id IS NULL THEN ct.amount_total END",
      unlinked_count: "CASE WHEN ct.approval_type = '승인' AND ct.excluded = 0 AND ct.doc_id IS NULL THEN 1 ELSE 0 END",
    },
    dims: {
      "ref.employee": { idExpr: "cr.holder_employee_id", labelExpr: "COALESCE(ep.name, cr.holder_employee_id)" },
      "ref.dept": { idExpr: "ep.dept_id", labelExpr: "ed.dept_name" },
      "ref.contract": { idExpr: "tg.related_contract_id", labelExpr: "tc.contract_title" },
      "ref.company": { idExpr: "tg.related_facility_id", labelExpr: "tf.company_name" },
      "dim.category": { idExpr: "ct.category_key", labelExpr: "ct.category_key" },
    },
    times: { approved_at: "ct.approved_at" },
  },
  "system.participants": {
    // pr = 계약금액 백분위(cume_dist, 0~1 — 금액 미입력 계약 제외 모집단). percent_rank 는 최저가 0점이
    // 되어 "수행 건수도 반영"이라는 취지가 깨지므로, 최저 계약도 1/N 점을 받는 cume_dist 를 쓴다.
    from: "service_participants sp LEFT JOIN employee_profiles ep ON ep.employee_id = sp.employee_id LEFT JOIN departments ed ON ed.dept_id = ep.dept_id LEFT JOIN contracts c ON c.contract_id = sp.contract_id LEFT JOIN (SELECT contract_id, cume_dist() OVER (ORDER BY contract_amount) AS amount_pctile FROM contracts WHERE contract_amount IS NOT NULL AND contract_amount > 0) pr ON pr.contract_id = sp.contract_id",
    measures: {
      contract_id: "sp.contract_id", // count_distinct 용
      duration_days:
        "CASE WHEN sp.participated_from IS NOT NULL THEN (COALESCE(NULLIF(sp.participated_to,'')::date, CURRENT_DATE) - sp.participated_from::date) END",
      // 백분위 가중 수행 점수의 원료 — sum 하면 "큰 용역일수록 1점에 가까운 점수가 건마다 누적"
      amount_percentile: "pr.amount_pctile",
      amount_sum: "c.contract_amount",
    },
    dims: {
      "ref.employee": { idExpr: "sp.employee_id", labelExpr: "COALESCE(ep.name, sp.employee_id)" },
      "ref.dept": { idExpr: "ep.dept_id", labelExpr: "ed.dept_name" },
      "ref.contract": { idExpr: "sp.contract_id", labelExpr: "COALESCE(c.contract_title, sp.contract_id)" },
      "dim.category": { idExpr: "c.service_type", labelExpr: "c.service_type" },
      "dim.subcategory": { idExpr: "c.service_subtype", labelExpr: "c.service_subtype" },
      "dim.amount_band": { idExpr: AMOUNT_BAND_SQL("c.contract_amount"), labelExpr: AMOUNT_BAND_SQL("c.contract_amount") },
    },
    times: { participated_from: "sp.participated_from" },
  },
  "system.attendance": {
    from: "attendance_weekly aw LEFT JOIN employee_profiles ep ON ep.employee_id = aw.employee_id LEFT JOIN departments ed ON ed.dept_id = ep.dept_id",
    measures: {
      overtime_hours: "aw.overtime_minutes / 60.0",
      excess_hours: "aw.excess_minutes / 60.0",
      worked_hours: "aw.worked_minutes / 60.0",
    },
    dims: {
      "ref.employee": { idExpr: "aw.employee_id", labelExpr: "COALESCE(ep.name, aw.emp_name, aw.adt_emp_no)" },
      "ref.dept": { idExpr: "ep.dept_id", labelExpr: "ed.dept_name" },
    },
    times: { week_start: "aw.week_start::text" },
  },
  "system.attendance_daily": {
    from: "attendance_daily ad LEFT JOIN employee_profiles ep ON ep.employee_id = ad.employee_id LEFT JOIN departments ed ON ed.dept_id = ep.dept_id",
    measures: {
      worked_hours: "COALESCE(ad.worked_minutes, 0) / 60.0",
      night_hours: "COALESCE(ad.night_minutes, 0) / 60.0",
      days: "CASE WHEN COALESCE(ad.worked_minutes, 0) > 0 THEN 1 ELSE 0 END",
    },
    dims: {
      "ref.employee": { idExpr: "ad.employee_id", labelExpr: "COALESCE(ep.name, ad.emp_name, ad.adt_emp_no)" },
      "ref.dept": { idExpr: "ep.dept_id", labelExpr: "ed.dept_name" },
    },
    times: { work_date: "ad.work_date::text" },
  },
  "system.leave": {
    from: "annual_leave_ledger al LEFT JOIN employee_profiles ep ON ep.employee_id = al.employee_id LEFT JOIN departments ed ON ed.dept_id = ep.dept_id",
    measures: {
      grant_days: "CASE WHEN al.entry_type = 'grant' THEN al.days END",
      use_days: "CASE WHEN al.entry_type = 'use' THEN al.days END",
    },
    dims: {
      "ref.employee": { idExpr: "al.employee_id", labelExpr: "COALESCE(ep.name, al.employee_id)" },
      "ref.dept": { idExpr: "ep.dept_id", labelExpr: "ed.dept_name" },
    },
    times: { year: "al.year || '-01-01'" },
  },
};

function bucketOf(dateText: string | null, bucket: "month" | "year" | "none"): string | null {
  if (bucket === "none") return null;
  // 온전한 날짜 형식만 인정 — 연도 조각·자유 텍스트 잔해("2", "25년" 등)는 버킷 없음(null) 처리.
  const m = /^((?:19|20)\d{2})[-.](0[1-9]|1[0-2])/.exec(String(dateText ?? "").trim());
  if (!m) {
    const y = /^((?:19|20)\d{2})$/.exec(String(dateText ?? "").trim());
    return bucket === "year" && y ? y[1] : null;
  }
  return bucket === "year" ? m[1] : `${m[1]}-${m[2]}`;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return isFinite(n) && String(v).trim() !== "" ? n : null;
}

/** ── 결재 문서 소스: 태그 해석 → 문서/표 행 전개 ── */

interface DocPath {
  fieldKey: string;
  columnKey?: string; // 표 열이면 지정
}

function findConceptPaths(fields: ApprovalFieldDef[], concept: string): DocPath[] {
  const out: DocPath[] = [];
  for (const f of fields) {
    if (f.semantic?.concept === concept) out.push({ fieldKey: f.key });
    for (const c of f.tableColumns ?? []) {
      if (c.semantic?.concept === concept) out.push({ fieldKey: f.key, columnKey: c.key });
    }
  }
  return out;
}

type RefPart = { id: string; label: string };

/** ref.* 차원 → 연결 엔티티 */
function entityOfDim(dim: string): LinkEntity | null {
  const e = dim.startsWith("ref.") ? dim.slice(4) : "";
  return (["contract", "company", "employee", "dept", "asset", "contact", "leave_type"] as const).includes(e as never) ? (e as LinkEntity) : null;
}

/** 문서 단위 참조 필드(첫 번째) — 연결 판정은 linkage.ts 와 같은 규칙 */
function findRefField(formId: string, fields: ApprovalFieldDef[], entity: LinkEntity): string | null {
  return linkSlotsOf(formId, fields).find((s) => s.level === "doc" && s.entity === entity)?.fieldKey ?? null;
}

/** 문서 레벨 참조 값 → {id,label} (미연결 null·직접 입력 "manual" — 진단 카운트로) */
function refValueOf(v: unknown, entity: LinkEntity): RefPart | "manual" | null {
  const state = judgeRefValue(entity, v);
  if (state === "missing") return null;
  if (state === "manual") return "manual";
  // 복수 선택(인원·담당자)은 첫 값 기준(v1 — 중복 집계 왜곡 방지)
  const o = (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | string;
  if (typeof o === "string") return { id: o, label: o }; // 휴가 종류 코드
  const idKey: Record<LinkEntity, string> = {
    contract: "contractId",
    company: "facilityId",
    employee: "employeeId",
    dept: "deptId",
    position: "positionId",
    asset: "assetId",
    contact: o.id != null ? "id" : "contactId",
    leave_type: "code",
  };
  const id = String(o[idKey[entity]] ?? "");
  return { id, label: String(o.title ?? o.name ?? id) };
}

async function runApprovalDocsAggregate(def: AggregateDefinition, label: string, metricKey: string): Promise<MetricResult> {
  const db = await getDb();
  const status = def.source.status?.length ? def.source.status : ["approved"];
  const excluded: Record<string, number> = {};
  const notes: string[] = [];
  const bump = (k: string) => (excluded[k] = (excluded[k] ?? 0) + 1);
  const groupBy = def.groupBy ?? [];
  const bucket = def.timeBy?.bucket ?? "none";
  const meta = {
    axes: groupBy.map(axisOf),
    timeBucket: bucket !== "none" ? bucket : undefined,
  };

  // 대상 양식 해석 — auto 는 measure 태그를 가진 모든 양식(태그가 계약).
  // 사용 해제(use_yn=0) 양식도 포함한다 — 해제 전에 결재된 문서가 집계에서 빠지지 않게.
  const formRows = rowsToObjects(await db.exec("SELECT form_id, name, fields FROM approval_forms"));
  const formDefs = formRows.map((r) => ({ formId: String(r.form_id), name: String(r.name), fields: parseFields(r.fields) }));
  let targets = formDefs;
  if (Array.isArray(def.source.forms)) {
    targets = formDefs.filter((f) => (def.source.forms as string[]).includes(f.formId));
  } else if (def.measure.concept) {
    targets = formDefs.filter((f) => findConceptPaths(f.fields, def.measure.concept!).length > 0);
  }
  if (!targets.length) {
    return {
      metricKey, label, kind: "aggregate", format: def.measure.concept?.startsWith("cost.") || def.measure.concept?.startsWith("amount.") ? "currency" : "number",
      hasTime: !!def.timeBy && def.timeBy.bucket !== "none",
      rows: [],
      ...meta,
      diagnostics: { sources: ["approval_docs"], totalDocs: 0, usedRows: 0, excluded, notes: [`태그 ${def.measure.concept ?? "(count)"} 를 가진 양식이 없습니다.`] },
    };
  }
  notes.push(`대상 양식: ${targets.map((t) => t.name).join(", ")}`);

  const docRows = rowsToObjects(
    await db.exec(
      `SELECT doc_id, form_id, field_values, submitted_at, drafter_employee_id, drafter_name, dept_id, dept_name FROM approval_docs
        WHERE form_id = ANY($1::text[]) AND status = ANY($2::text[])`,
      [targets.map((t) => t.formId), status]
    )
  );

  // 그룹 차원 해석 — 참조 차원(ref.*·doc.*)은 1개, dim.category 는 문서/표 행 레벨
  const refDim = groupBy.find(isRefDimension);
  const refEntity = refDim ? entityOfDim(refDim) : null;
  const wantCat = groupBy.includes("dim.category");
  if (refDim === "doc.drafter" || refDim === "doc.dept") notes.push(`${refDim === "doc.drafter" ? "기안자" : "기안 부서"} 기준으로 귀속했습니다.`);
  let rowAttributed = 0;

  const flat: FlatRow[] = [];
  for (const doc of docRows) {
    const form = targets.find((t) => t.formId === String(doc.form_id));
    if (!form) continue;
    const fv = (typeof doc.field_values === "string" ? JSON.parse(String(doc.field_values)) : doc.field_values) as Record<string, unknown>;
    if (!fv || typeof fv !== "object") {
      bump("emptyDoc");
      continue;
    }

    // 문서 단위 참조 — 기안자·기안 부서는 문서 메타, ref.* 는 문서 단위 참조 필드
    let docRef: RefPart | "manual" | null = null;
    let docRefField: string | null = null;
    if (refDim === "doc.drafter") {
      docRef = doc.drafter_employee_id ? { id: String(doc.drafter_employee_id), label: String(doc.drafter_name ?? doc.drafter_employee_id) } : null;
    } else if (refDim === "doc.dept") {
      docRef = doc.dept_id ? { id: String(doc.dept_id), label: String(doc.dept_name ?? doc.dept_id) } : null;
    } else if (refEntity) {
      docRefField = findRefField(form.formId, form.fields, refEntity);
      if (docRefField) docRef = refValueOf(fv[docRefField], refEntity);
    }
    // 이 양식에 귀속 근거가 있는가(문서 필드·연관 용역 열·행 직원 표) — 없으면 '참조 필드 없음'으로 센다
    const formHasRef =
      !refEntity ||
      !!docRefField ||
      form.fields.some(
        (f) =>
          f.type === "table" &&
          (((refEntity === "contract" || refEntity === "company") && (f.tableColumns ?? []).some((c) => c.type === "related")) ||
            (refEntity === "employee" && f.rowRef === "employee"))
      );

    // 문서 레벨 시간(태그된 date/period 필드)
    let docTime: string | null = null;
    if (def.timeBy?.concept) {
      const tp = findConceptPaths(form.fields, def.timeBy.concept).find((p) => !p.columnKey);
      if (tp) {
        const raw = fv[tp.fieldKey];
        const s = typeof raw === "object" && raw != null ? String((raw as Record<string, unknown>).from ?? (raw as Record<string, unknown>).start ?? "") : String(raw ?? "");
        docTime = s || null;
      }
    }
    // 문서 레벨 dim.category(select 등) — 표 행에 분류 열이 있으면 행 값이 우선
    let docCat: string | null = null;
    if (wantCat) {
      const cp = findConceptPaths(form.fields, "dim.category").find((p) => !p.columnKey);
      if (cp) docCat = String(fv[cp.fieldKey] ?? "").trim() || null;
    }

    /** groupBy 순서대로 참조/분류 파트를 조합. 분류가 필요한데 없으면 null(제외). */
    const combine = (cat: string | null, ref: RefPart | null): RefPart | null => {
      if (wantCat && !cat) return null;
      const parts = groupBy.map((g) => (g === "dim.category" ? { id: cat as string, label: cat as string } : ref));
      if (!parts.length) return null;
      return {
        id: parts.map((p) => p?.id ?? "").join("|"),
        label: parts.map((p) => p?.label ?? "(없음)").join(" · "),
      };
    };
    /** 참조 해석 결과로 행을 넣는다 — 참조가 필요한데 없거나 직접 입력이면 제외 사유만 센다 */
    const pushRow = (value: number, cat: string | null, time: string | null, ref: RefPart | "manual" | null) => {
      if (refDim) {
        if (ref === "manual") {
          bump("manualRef");
          return;
        }
        if (!ref) {
          bump(formHasRef ? "noGroupKey" : "formWithoutRefField");
          return;
        }
      }
      const g = combine(cat, ref === "manual" ? null : ref);
      if (groupBy.length > 0 && !g) {
        bump("noGroupKey");
        return;
      }
      flat.push({ value, groupId: g?.id ?? null, groupLabel: g?.label ?? "(전체)", time: bucketOf(time, bucket) });
    };

    // measure 값 전개 — 필드 레벨 + 표 행 레벨
    const paths = def.measure.concept ? findConceptPaths(form.fields, def.measure.concept) : [{ fieldKey: "__doc__" } as DocPath];
    for (const p of paths) {
      if (p.fieldKey === "__doc__") {
        pushRow(1, docCat, docTime, docRef); // count(문서 수) — 값 1 로 취급
        continue;
      }
      if (!p.columnKey) {
        const n = toNumber(fv[p.fieldKey]);
        if (n == null) {
          bump("emptyValue");
          continue;
        }
        pushRow(n, docCat, docTime, docRef);
        continue;
      }
      // 표 행 전개 — 같은 행에서 분류(dim.category)·시간(when.occurred)·행 귀속(연관 용역/사업장·행 직원) 열도 함께 읽는다
      const tableField = form.fields.find((f) => f.key === p.fieldKey);
      const rowsVal = fv[p.fieldKey];
      if (!Array.isArray(rowsVal)) continue;
      const catCol = tableField?.tableColumns?.find((c) => c.semantic?.concept === "dim.category")?.key;
      const timeCol = def.timeBy?.concept
        ? tableField?.tableColumns?.find((c) => c.semantic?.concept === def.timeBy!.concept)?.key
        : undefined;
      const relatedCol = tableField?.tableColumns?.find((c) => c.type === "related")?.key;
      for (const row of rowsVal as Record<string, unknown>[]) {
        const n = toNumber(row?.[p.columnKey]);
        if (n == null) {
          bump("emptyValue");
          continue;
        }
        const rowCat = wantCat ? String(row?.[catCol ?? ""] ?? "").trim() || docCat : null;
        const t = timeCol ? String(row?.[timeCol] ?? "") : docTime;
        // 행 단위 귀속이 있으면 문서 단위 참조보다 우선한다(지출 행마다 용역이 다를 수 있다)
        let ref: RefPart | "manual" | null = docRef;
        if (relatedCol && (refEntity === "contract" || refEntity === "company")) {
          const id = String(row?.[refEntity === "contract" ? "_relatedContractId" : "_relatedFacilityId"] ?? "").trim();
          if (id) {
            ref = { id, label: String(row?.[relatedCol] ?? "").trim() || id };
            rowAttributed += 1;
          } else if (!docRef && String(row?.[relatedCol] ?? "").trim()) ref = "manual";
        } else if (refEntity === "employee" && tableField?.rowRef === "employee") {
          const id = String(row?.[ROW_EMPLOYEE_KEY] ?? "").trim();
          if (id) {
            ref = { id, label: String(row?.name ?? id) };
            rowAttributed += 1;
          }
        }
        pushRow(n, rowCat, t, ref);
      }
    }
  }
  if (rowAttributed) notes.push(`표 행 단위로 귀속한 행 ${rowAttributed}개(연관 용역/사업장·행 직원).`);

  const rows = aggregateFlat(flat, def.measure.agg);
  return {
    metricKey,
    label,
    kind: "aggregate",
    format: def.measure.concept?.startsWith("cost.") || def.measure.concept?.startsWith("amount.") ? "currency" : "number",
    hasTime: !!def.timeBy && def.timeBy.bucket !== "none",
    rows,
    ...meta,
    diagnostics: { sources: ["approval_docs"], totalDocs: docRows.length, usedRows: flat.length, excluded, notes },
  };
}

function aggregateFlat(flat: FlatRow[], agg: AggregateDefinition["measure"]["agg"]): MetricResult["rows"] {
  const map = new Map<string, { groupId: string | null; groupLabel: string; time?: string; sum: number; count: number; min: number; max: number; distinct: Set<string> }>();
  for (const r of flat) {
    const key = `${r.groupId ?? ""}${r.time ?? ""}`;
    let e = map.get(key);
    if (!e) {
      e = { groupId: r.groupId, groupLabel: r.groupLabel, time: r.time ?? undefined, sum: 0, count: 0, min: Infinity, max: -Infinity, distinct: new Set() };
      map.set(key, e);
    }
    const v = r.value ?? 0;
    e.sum += v;
    e.count += 1;
    e.min = Math.min(e.min, v);
    e.max = Math.max(e.max, v);
    e.distinct.add(String(r.value));
  }
  return [...map.values()]
    .map((e) => ({
      groupId: e.groupId,
      groupLabel: e.groupLabel,
      time: e.time,
      value:
        agg === "sum" ? e.sum
        : agg === "avg" ? (e.count ? e.sum / e.count : null)
        : agg === "count" ? e.count
        : agg === "count_distinct" ? e.distinct.size
        : agg === "min" ? (e.count ? e.min : null)
        : e.count ? e.max : null,
    }))
    .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "") || (b.value ?? 0) - (a.value ?? 0));
}

/** ── 시스템 소스: 카탈로그 고정 SQL 템플릿으로 집계 ── */
async function runSystemAggregate(def: AggregateDefinition, label: string, metricKey: string): Promise<MetricResult> {
  const spec = SYSTEM_SPECS[def.source.type];
  if (!spec) throw new Error(`등록되지 않은 시스템 소스입니다: ${def.source.type}`);
  const measureExpr = def.measure.field ? spec.measures[def.measure.field] : undefined;
  if (!measureExpr) throw new Error(`소스 ${def.source.type} 에 없는 측정값입니다: ${def.measure.field}`);
  // 다중 그룹(최대 3) — 세분류 × 금액대 같은 조합 차원. 조합 키는 '|', 표시는 ' · ' 로 잇는다.
  const dims = (def.groupBy ?? []).map((g) => {
    const d = spec.dims[g];
    if (!d) throw new Error(`소스 ${def.source.type} 에 없는 차원입니다: ${g}`);
    return d;
  });
  const timeExpr = def.timeBy?.field ? spec.times[def.timeBy.field] : undefined;
  if (def.timeBy?.field && !timeExpr) throw new Error(`소스 ${def.source.type} 에 없는 시간축입니다: ${def.timeBy.field}`);

  const agg = def.measure.agg;
  const valueSql =
    agg === "count" ? "count(*)"
    : agg === "count_distinct" ? `count(DISTINCT ${measureExpr})`
    : `${agg}((${measureExpr})::double precision)`;
  const bucket = def.timeBy?.bucket ?? "none";
  // 시간 버킷은 YYYY-MM(-DD…) 형식일 때만 인정 — 자유 텍스트 날짜 잔해는 NULL(형식 불량 그룹으로 묶임)
  const timeSql =
    timeExpr && bucket !== "none"
      ? `left(substring(COALESCE(${timeExpr}, '') from '^(19|20)\\d{2}-(0[1-9]|1[0-2])'), ${bucket === "year" ? 4 : 7})`
      : null;

  const idSql = dims.length
    ? dims.map((d) => `COALESCE((${d.idExpr})::text, '')`).join(` || '|' || `)
    : null;
  const labelSql = dims.length
    ? `concat_ws(' · ', ${dims.map((d) => `min(COALESCE((${d.labelExpr})::text, '(없음)'))`).join(", ")})`
    : null;
  const selects = [
    idSql ? `${idSql} AS group_id, ${labelSql} AS group_label` : `NULL AS group_id, '(전체)' AS group_label`,
    timeSql ? `${timeSql} AS t` : `NULL AS t`,
    `${valueSql} AS value`,
    `count(*) AS used`,
  ];
  const groups = [...dims.map((d) => `(${d.idExpr})`), ...(timeSql ? [timeSql] : [])];
  const sql = `SELECT ${selects.join(", ")} FROM ${spec.from} ${groups.length ? `GROUP BY ${groups.join(", ")}` : ""} ORDER BY t NULLS FIRST, group_label, value DESC NULLS LAST LIMIT 500`;
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(sql));
  const notes: string[] = [];
  if (rows.length >= 500) notes.push("그룹이 500개를 넘어 상위 500개만 표시했습니다(침묵 절단 방지 고지)."); // §3-3
  const currencyFields = new Set(["amount", "amount_sum", "supply_amount", "invoice_amount", "unlinked_amount"]);
  return {
    metricKey,
    label,
    kind: "aggregate",
    format: def.measure.field && currencyFields.has(def.measure.field) ? "currency" : "number",
    hasTime: !!timeSql,
    rows: rows.map((r) => ({
      groupId: r.group_id != null ? String(r.group_id) : null,
      groupLabel: String(r.group_label ?? "(전체)"),
      time: r.t != null && String(r.t) !== "" ? String(r.t) : undefined,
      value: r.value != null ? Number(r.value) : null,
    })),
    axes: (def.groupBy ?? []).map(axisOf),
    timeBucket: timeSql ? (bucket as "month" | "year") : undefined,
    diagnostics: {
      sources: [def.source.type],
      usedRows: rows.reduce((a, r) => a + Number(r.used ?? 0), 0),
      excluded: {},
      notes,
    },
  };
}

/** ── 복합 지표: 참조 지표 실행 → 차원 키 결합 → 안전한 수식 평가(재귀 하강, eval 금지) ── */
function evalFormula(tokens: string[], values: Record<string, number>): number | null {
  let pos = 0;
  function parseExpr(): number | null {
    let left = parseTerm();
    while (pos < tokens.length && (tokens[pos] === "+" || tokens[pos] === "-")) {
      const op = tokens[pos++];
      const right = parseTerm();
      if (left == null || right == null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseTerm(): number | null {
    let left = parseFactor();
    while (pos < tokens.length && (tokens[pos] === "*" || tokens[pos] === "/")) {
      const op = tokens[pos++];
      const right = parseFactor();
      if (left == null || right == null) return null;
      if (op === "/") {
        if (right === 0) return null; // 0 나눗셈 → null(화면 '-')
        left = left / right;
      } else left = left * right;
    }
    return left;
  }
  function parseFactor(): number | null {
    const t = tokens[pos];
    if (t === "(") {
      pos++;
      const v = parseExpr();
      if (tokens[pos] !== ")") return null;
      pos++;
      return v;
    }
    if (t === "-") {
      pos++;
      const v = parseFactor();
      return v == null ? null : -v;
    }
    pos++;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    return values[t] ?? 0; // 값 없는 그룹은 0(비용 없음 = 0)
  }
  const out = parseExpr();
  return pos === tokens.length ? out : null;
}

/**
 * 복합 지표 결합 정합 검사 — 참조 지표들의 결합 축(groupBy 를 축으로 정규화)과 시간 버킷이 같아야 한다.
 * 축이 다르면 groupId 가 우연히 같은 값끼리 엉뚱하게 결합된다(예: 직원 ID 와 계약 ID). 오류 메시지 반환(정상이면 null).
 */
export function compositeMismatch(parts: Record<string, Pick<MetricResult, "axes" | "hasTime" | "timeBucket">>): string | null {
  const keys = Object.keys(parts);
  if (keys.length < 2) return null;
  const sig = (k: string) => (parts[k].axes ?? []).join(" × ") || "(그룹 없음)";
  const base = keys[0];
  for (const k of keys.slice(1)) {
    if (sig(k) !== sig(base)) return `결합 축이 다릅니다: ${base}=${sig(base)}, ${k}=${sig(k)} — 같은 기준(계약·직원·부서 등)으로 집계한 지표끼리만 결합할 수 있습니다.`;
    if (!!parts[k].hasTime !== !!parts[base].hasTime || (parts[k].timeBucket ?? null) !== (parts[base].timeBucket ?? null))
      return `시간축이 다릅니다: ${base}와 ${k}의 시간 단위(월·연·없음)를 맞추세요.`;
  }
  return null;
}

async function runComposite(
  def: CompositeDefinition,
  label: string,
  metricKey: string,
  loadMetric: (key: string) => Promise<MetricItem | null>,
  depth: number
): Promise<MetricResult> {
  if (depth > 1) throw new Error("복합 지표는 집계 지표만 참조할 수 있습니다(중첩 복합 금지).");
  const refKeys = formulaMetricKeys(def.formula);
  const parts: Record<string, MetricResult> = {};
  const notes: string[] = [];
  const excluded: Record<string, number> = {};
  for (const k of refKeys) {
    const item = await loadMetric(k);
    if (!item) throw new Error(`수식이 참조하는 지표가 없습니다: ${k}`);
    if (item.definition.kind !== "aggregate") throw new Error(`복합 지표는 집계 지표만 참조할 수 있습니다: ${k}`);
    parts[k] = await runAggregate(item.definition, item.label, item.metricKey);
    notes.push(`${k}: ${parts[k].diagnostics.usedRows}행 사용`);
    for (const [ek, ev] of Object.entries(parts[k].diagnostics.excluded)) excluded[`${k}.${ek}`] = ev;
  }
  const mismatch = compositeMismatch(parts);
  if (mismatch) throw new Error(mismatch);
  const first = refKeys.length ? parts[refKeys[0]] : null;
  const hasTime = !!first?.hasTime;
  // 차원 키(+시간 버킷) 합집합으로 결합(값 없는 지표는 0)
  const keyOf = (r: MetricResult["rows"][number]) => `${r.groupId ?? ""}\u0001${hasTime ? r.time ?? "" : ""}`;
  const groupMap = new Map<string, { groupId: string | null; groupLabel: string; time?: string }>();
  for (const k of refKeys) {
    for (const r of parts[k].rows) {
      if (!groupMap.has(keyOf(r))) groupMap.set(keyOf(r), { groupId: r.groupId ?? null, groupLabel: r.groupLabel, time: hasTime ? r.time : undefined });
    }
  }
  const rows: MetricResult["rows"] = [...groupMap.entries()].map(([key, g]) => {
    const values: Record<string, number> = {};
    for (const k of refKeys) {
      const hit = parts[k].rows.find((r) => keyOf(r) === key);
      values[k] = hit?.value ?? 0;
    }
    return { groupId: g.groupId || null, groupLabel: g.groupLabel, time: g.time, value: evalFormula(def.formula, values) };
  });
  rows.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "") || (b.value ?? -Infinity) - (a.value ?? -Infinity));
  return {
    metricKey,
    label,
    kind: "composite",
    format: def.format ?? "number",
    hasTime,
    rows,
    axes: first?.axes,
    timeBucket: first?.timeBucket,
    diagnostics: {
      sources: [...new Set(refKeys.flatMap((k) => parts[k].diagnostics.sources))],
      usedRows: rows.length,
      excluded,
      notes,
    },
  };
}

async function runAggregate(def: AggregateDefinition, label: string, metricKey: string): Promise<MetricResult> {
  if (def.source.type === "approval_docs") return runApprovalDocsAggregate(def, label, metricKey);
  return runSystemAggregate(def, label, metricKey);
}

/** 지표 실행 진입점 — 정의 검증 후 종류별 실행. loadMetric 은 복합 지표의 참조 해석용. */
export async function runMetric(
  item: Pick<MetricItem, "metricKey" | "label" | "definition">,
  loadMetric: (key: string) => Promise<MetricItem | null>
): Promise<MetricResult> {
  const err = validateDefinition(item.definition);
  if (err) throw new Error(err);
  const def = item.definition as MetricDefinition;
  if (def.kind === "aggregate") return runAggregate(def, item.label, item.metricKey);
  return runComposite(def, item.label, item.metricKey, loadMetric, 0);
}
