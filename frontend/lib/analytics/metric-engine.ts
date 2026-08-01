import { getDb, rowsToObjects } from "@/lib/db";
import { parseFields, AUTO_CONCEPT_BY_TYPE, type ApprovalFieldDef } from "@/lib/approval/fields";
import type { AggregateDefinition, CompositeDefinition, MetricDefinition, MetricItem, MetricResult } from "@/lib/analytics/metric-types";
import { formulaMetricKeys, validateDefinition } from "@/lib/analytics/metric-types";

/*
 * 지표 실행 엔진(서버 전용) — SW-P2. 설계: docs/semantic-analytics-wizard-blueprint.md §4-3.
 * 원칙(§3): 선언적 정의 + 화이트리스트 실행(자유 SQL/eval 금지), 지표는 태그 참조,
 * 모든 결과에 진단 메타(대상/제외 사유) 동봉.
 * 구현 노트: 결재 문서 소스는 SQL 로 문서를 로드한 뒤 JS 에서 태그 해석·표 행 전개·집계한다
 * (문서 수천 건 이하 실시간 전제 §8-5 — 표 행 전개·행 단위 진단 메타 산출에 SQL 보다 명료).
 * 시스템 소스는 카탈로그에 고정된 SQL 템플릿으로만 집계한다(semantics.ts SYSTEM_SOURCES 와 짝).
 * ⚠ 클라이언트 import 금지(pg).
 */

interface FlatRow {
  value: number | null;
  groupId: string | null;
  groupLabel: string;
  time: string | null;
}

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
    from: "contracts c",
    measures: { amount: "c.contract_amount", count: "1" },
    dims: {
      "ref.contract": { idExpr: "c.contract_id", labelExpr: "c.contract_title" },
      "dim.category": { idExpr: "c.service_type", labelExpr: "c.service_type" },
    },
    times: { contract_date: "c.started_at" },
  },
  "system.participants": {
    from: "service_participants sp LEFT JOIN employee_profiles ep ON ep.employee_id = sp.employee_id LEFT JOIN contracts c ON c.contract_id = sp.contract_id",
    measures: {
      contract_id: "sp.contract_id", // count_distinct 용
      duration_days:
        "CASE WHEN sp.participated_from IS NOT NULL THEN (COALESCE(NULLIF(sp.participated_to,'')::date, CURRENT_DATE) - sp.participated_from::date) END",
    },
    dims: {
      "ref.employee": { idExpr: "sp.employee_id", labelExpr: "COALESCE(ep.name, sp.employee_id)" },
      "ref.contract": { idExpr: "sp.contract_id", labelExpr: "COALESCE(c.contract_title, sp.contract_id)" },
    },
    times: { participated_from: "sp.participated_from" },
  },
  "system.attendance": {
    from: "attendance_weekly aw LEFT JOIN employee_profiles ep ON ep.employee_id = aw.employee_id",
    measures: {
      overtime_hours: "aw.overtime_minutes / 60.0",
      excess_hours: "aw.excess_minutes / 60.0",
      worked_hours: "aw.worked_minutes / 60.0",
    },
    dims: { "ref.employee": { idExpr: "aw.employee_id", labelExpr: "COALESCE(ep.name, aw.emp_name, aw.adt_emp_no)" } },
    times: { week_start: "aw.week_start::text" },
  },
  "system.leave": {
    from: "annual_leave_ledger al LEFT JOIN employee_profiles ep ON ep.employee_id = al.employee_id",
    measures: {
      grant_days: "CASE WHEN al.entry_type = 'grant' THEN al.days END",
      use_days: "CASE WHEN al.entry_type = 'use' THEN al.days END",
    },
    dims: { "ref.employee": { idExpr: "al.employee_id", labelExpr: "COALESCE(ep.name, al.employee_id)" } },
    times: { year: "al.year || '-01-01'" },
  },
};

function bucketOf(dateText: string | null, bucket: "month" | "year" | "none"): string | null {
  if (bucket === "none") return null;
  const m = /^(\d{4})[-.]?(\d{2})?/.exec(String(dateText ?? "").trim());
  if (!m) return null;
  if (bucket === "year") return m[1];
  return m[2] ? `${m[1]}-${m[2]}` : null;
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

function findRefField(fields: ApprovalFieldDef[], refConcept: string): ApprovalFieldDef | undefined {
  return fields.find((f) => AUTO_CONCEPT_BY_TYPE[f.type] === refConcept);
}

/** 문서 레벨 참조 값 → {id,label} (미연결/직접 입력은 null — 진단 카운트로) */
function refValueOf(
  fieldValues: Record<string, unknown>,
  field: ApprovalFieldDef,
  refConcept: string
): { id: string; label: string } | "manual" | null {
  const v = fieldValues[field.key] as Record<string, unknown> | Record<string, unknown>[] | undefined;
  if (!v) return null;
  if (refConcept === "ref.contract") {
    const o = v as Record<string, unknown>;
    if (o.manual === true) return "manual";
    return o.contractId ? { id: String(o.contractId), label: String(o.title ?? o.contractId) } : null;
  }
  if (refConcept === "ref.company") {
    const o = v as Record<string, unknown>;
    if (o.manual === true) return "manual";
    return o.facilityId ? { id: String(o.facilityId), label: String(o.name ?? o.facilityId) } : null;
  }
  if (refConcept === "ref.employee") {
    // 복수 선택은 첫 인원 기준(v1 — 인원별 중복 집계 왜곡 방지)
    const o = (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | undefined;
    return o?.employeeId ? { id: String(o.employeeId), label: String(o.name ?? o.employeeId) } : null;
  }
  const s = String(v ?? "").trim(); // ref.dept — 자유 텍스트
  return s ? { id: s, label: s } : null;
}

async function runApprovalDocsAggregate(def: AggregateDefinition, label: string, metricKey: string): Promise<MetricResult> {
  const db = await getDb();
  const status = def.source.status?.length ? def.source.status : ["approved"];
  const groupBy = def.groupBy?.[0];
  const excluded: Record<string, number> = {};
  const notes: string[] = [];
  const bump = (k: string) => (excluded[k] = (excluded[k] ?? 0) + 1);

  // 대상 양식 해석 — auto 는 measure 태그를 가진 모든 양식(태그가 계약)
  const formRows = rowsToObjects(await db.exec("SELECT form_id, name, fields FROM approval_forms WHERE use_yn = 1"));
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
      diagnostics: { sources: ["approval_docs"], totalDocs: 0, usedRows: 0, excluded, notes: [`태그 ${def.measure.concept ?? "(count)"} 를 가진 양식이 없습니다.`] },
    };
  }
  notes.push(`대상 양식: ${targets.map((t) => t.name).join(", ")}`);

  const docRows = rowsToObjects(
    await db.exec(
      `SELECT doc_id, form_id, field_values, submitted_at FROM approval_docs
        WHERE form_id = ANY($1::text[]) AND status = ANY($2::text[])`,
      [targets.map((t) => t.formId), status]
    )
  );

  const flat: FlatRow[] = [];
  for (const doc of docRows) {
    const form = targets.find((t) => t.formId === String(doc.form_id));
    if (!form) continue;
    const fv = (typeof doc.field_values === "string" ? JSON.parse(String(doc.field_values)) : doc.field_values) as Record<string, unknown>;
    if (!fv || typeof fv !== "object") {
      bump("emptyDoc");
      continue;
    }

    // 문서 레벨 그룹 키(ref.* — 참조 필드에서)
    let group: { id: string; label: string } | null = null;
    if (groupBy?.startsWith("ref.")) {
      const rf = findRefField(form.fields, groupBy);
      if (!rf) {
        bump("formWithoutRefField");
        continue;
      }
      const rv = refValueOf(fv, rf, groupBy);
      if (rv === "manual") {
        bump("manualRef");
        continue;
      }
      if (!rv) {
        bump("noGroupKey");
        continue;
      }
      group = rv;
    }

    // 문서 레벨 시간(태그된 date/period 필드)
    let docTime: string | null = null;
    if (def.timeBy?.concept) {
      const tp = findConceptPaths(form.fields, def.timeBy.concept).find((p) => !p.columnKey);
      if (tp) {
        const raw = fv[tp.fieldKey];
        const s = typeof raw === "object" && raw != null ? String((raw as Record<string, unknown>).start ?? "") : String(raw ?? "");
        docTime = s || null;
      }
    }
    // 문서 레벨 dim.category(select 등)
    let docCat: string | null = null;
    if (groupBy === "dim.category") {
      const cp = findConceptPaths(form.fields, "dim.category").find((p) => !p.columnKey);
      if (cp) docCat = String(fv[cp.fieldKey] ?? "").trim() || null;
    }

    // measure 값 전개 — 필드 레벨 + 표 행 레벨
    const paths = def.measure.concept ? findConceptPaths(form.fields, def.measure.concept) : [{ fieldKey: "__doc__" } as DocPath];
    for (const p of paths) {
      if (p.fieldKey === "__doc__") {
        // count(문서 수) — 값 1 로 취급
        flat.push({ value: 1, groupId: group?.id ?? null, groupLabel: group?.label ?? docCat ?? "(전체)", time: bucketOf(docTime, def.timeBy?.bucket ?? "none") });
        continue;
      }
      if (!p.columnKey) {
        const n = toNumber(fv[p.fieldKey]);
        if (n == null) {
          bump("emptyValue");
          continue;
        }
        const g = groupBy === "dim.category" ? (docCat ? { id: docCat, label: docCat } : null) : group;
        if (groupBy === "dim.category" && !g) {
          bump("noGroupKey");
          continue;
        }
        flat.push({ value: n, groupId: g?.id ?? null, groupLabel: g?.label ?? "(전체)", time: bucketOf(docTime, def.timeBy?.bucket ?? "none") });
        continue;
      }
      // 표 행 전개 — 같은 행에서 분류(dim.category)·시간(when.occurred) 열도 함께 읽는다
      const tableField = form.fields.find((f) => f.key === p.fieldKey);
      const rowsVal = fv[p.fieldKey];
      if (!Array.isArray(rowsVal)) continue;
      const catCol = tableField?.tableColumns?.find((c) => c.semantic?.concept === "dim.category")?.key;
      const timeCol = def.timeBy?.concept
        ? tableField?.tableColumns?.find((c) => c.semantic?.concept === def.timeBy!.concept)?.key
        : undefined;
      for (const row of rowsVal as Record<string, unknown>[]) {
        const n = toNumber(row?.[p.columnKey]);
        if (n == null) {
          bump("emptyValue");
          continue;
        }
        let g = group;
        if (groupBy === "dim.category") {
          const cat = String(row?.[catCol ?? ""] ?? "").trim() || docCat;
          if (!cat) {
            bump("noGroupKey");
            continue;
          }
          g = { id: cat, label: cat };
        }
        const t = timeCol ? String(row?.[timeCol] ?? "") : docTime;
        flat.push({ value: n, groupId: g?.id ?? null, groupLabel: g?.label ?? "(전체)", time: bucketOf(t, def.timeBy?.bucket ?? "none") });
      }
    }
  }

  const rows = aggregateFlat(flat, def.measure.agg);
  return {
    metricKey,
    label,
    kind: "aggregate",
    format: def.measure.concept?.startsWith("cost.") || def.measure.concept?.startsWith("amount.") ? "currency" : "number",
    hasTime: !!def.timeBy && def.timeBy.bucket !== "none",
    rows,
    diagnostics: { sources: ["approval_docs"], totalDocs: docRows.length, usedRows: flat.length, excluded, notes },
  };
}

function aggregateFlat(flat: FlatRow[], agg: AggregateDefinition["measure"]["agg"]): MetricResult["rows"] {
  const map = new Map<string, { groupId: string | null; groupLabel: string; time?: string; sum: number; count: number; min: number; max: number; distinct: Set<string> }>();
  for (const r of flat) {
    const key = `${r.groupId ?? ""}${r.time ?? ""}`;
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
  const groupBy = def.groupBy?.[0];
  const dim = groupBy ? spec.dims[groupBy] : undefined;
  if (groupBy && !dim) throw new Error(`소스 ${def.source.type} 에 없는 차원입니다: ${groupBy}`);
  const timeExpr = def.timeBy?.field ? spec.times[def.timeBy.field] : undefined;
  if (def.timeBy?.field && !timeExpr) throw new Error(`소스 ${def.source.type} 에 없는 시간축입니다: ${def.timeBy.field}`);

  const agg = def.measure.agg;
  const valueSql =
    agg === "count" ? "count(*)"
    : agg === "count_distinct" ? `count(DISTINCT ${measureExpr})`
    : `${agg}((${measureExpr})::double precision)`;
  const bucket = def.timeBy?.bucket ?? "none";
  const timeSql = timeExpr && bucket !== "none" ? `left(regexp_replace(COALESCE(${timeExpr}, ''), '[^0-9-]', '', 'g'), ${bucket === "year" ? 4 : 7})` : null;

  const selects = [
    dim ? `${dim.idExpr} AS group_id, min(${dim.labelExpr}) AS group_label` : `NULL AS group_id, '(전체)' AS group_label`,
    timeSql ? `${timeSql} AS t` : `NULL AS t`,
    `${valueSql} AS value`,
    `count(*) AS used`,
  ];
  const groups = [dim ? `${dim.idExpr}` : "", timeSql ? timeSql : ""].filter(Boolean);
  const sql = `SELECT ${selects.join(", ")} FROM ${spec.from} ${groups.length ? `GROUP BY ${groups.join(", ")}` : ""} ORDER BY t NULLS FIRST, value DESC NULLS LAST LIMIT 500`;
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(sql));
  const notes: string[] = [];
  if (rows.length >= 500) notes.push("그룹이 500개를 넘어 상위 500개만 표시했습니다(침묵 절단 방지 고지)."); // §3-3
  return {
    metricKey,
    label,
    kind: "aggregate",
    format: def.measure.field === "amount" ? "currency" : "number",
    hasTime: !!timeSql,
    rows: rows.map((r) => ({
      groupId: r.group_id != null ? String(r.group_id) : null,
      groupLabel: String(r.group_label ?? "(전체)"),
      time: r.t != null && String(r.t) !== "" ? String(r.t) : undefined,
      value: r.value != null ? Number(r.value) : null,
    })),
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
  // 차원 키 합집합으로 결합(값 없는 지표는 0) — 시간축 결합은 v1 미지원
  const groupMap = new Map<string, string>();
  for (const k of refKeys) {
    for (const r of parts[k].rows) {
      if (r.time) throw new Error(`복합 지표 참조 지표에 시간축이 있습니다(v1 미지원): ${k}`);
      groupMap.set(r.groupId ?? "", r.groupLabel);
    }
  }
  const rows: MetricResult["rows"] = [...groupMap.entries()].map(([gid, glabel]) => {
    const values: Record<string, number> = {};
    for (const k of refKeys) {
      const hit = parts[k].rows.find((r) => (r.groupId ?? "") === gid);
      values[k] = hit?.value ?? 0;
    }
    return { groupId: gid || null, groupLabel: glabel, value: evalFormula(def.formula, values) };
  });
  rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  return {
    metricKey,
    label,
    kind: "composite",
    format: def.format ?? "number",
    hasTime: false,
    rows,
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
