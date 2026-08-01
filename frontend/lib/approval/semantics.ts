import { getDb, rowsToObjects } from "@/lib/db";
import { parseFields, AUTO_CONCEPT_BY_TYPE, type ApprovalFieldDef } from "@/lib/approval/fields";

/*
 * 데이터 관계 맵·연결 진단(서버 전용) — SW-P1.
 * 설계: docs/semantic-analytics-wizard-blueprint.md §4-2(관계 그래프)·§4-4(채널 위반 감지).
 * 관계는 별도 설정 없이 엔티티 참조 필드(계약/업체/인원/부서 검색)에서 자동 도출되고,
 * 이 모듈은 그 관계의 "연결 품질"(문서가 실제로 마스터에 귀속되는 비율)을 실측한다.
 * ⚠ 클라이언트에서 import 금지(pg). 화면은 /api/approval/semantics 를 fetch 한다.
 */

/** 엔티티 참조 개념 → 문서 값에서 연결 성공을 판정하는 방식 */
const REF_ENTITY: Record<string, { entity: string; label: string }> = {
  "ref.contract": { entity: "contract", label: "계약(용역)" },
  "ref.company": { entity: "company", label: "업체(사업장)" },
  "ref.employee": { entity: "employee", label: "직원" },
  "ref.dept": { entity: "dept", label: "부서" },
};

/**
 * 시스템 소스 카탈로그 — 결재 문서 밖의 분석 소스(안전한 뷰) 정의.
 * SW-P2 지표 엔진이 source.type='system.*' 로 참조한다. 여기 등재된 것만 조회 가능(화이트리스트).
 */
export const SYSTEM_SOURCES: {
  key: string;
  label: string;
  desc: string;
  countSql: string;
}[] = [
  {
    key: "system.contracts",
    label: "계약(용역) 마스터",
    desc: "계약금액·기성(세금계산서 발행)·용역분류·수행부서 — 마진율 계산의 분모",
    countSql: "SELECT count(*) FROM contracts",
  },
  {
    key: "system.participants",
    label: "수행인력",
    desc: "계약별 참여 인원·역할·수행 기간 — 인원별 수행 용역 수·평균 기간의 원천",
    countSql: "SELECT count(*) FROM service_participants",
  },
  {
    key: "system.attendance",
    label: "ADT 근태(주별 산정)",
    desc: "주별 인정 연장·야간 가산 시간 — 초과근무 실측치(신청서와 별개 소스)",
    countSql: "SELECT count(*) FROM attendance_weekly",
  },
  {
    key: "system.leave",
    label: "연차 대장",
    desc: "직원별 부여/사용/잔여 — 휴가 사용률 지표의 원천",
    countSql: "SELECT count(*) FROM annual_leave_ledger",
  },
];

export interface RefEdge {
  formId: string;
  formName: string;
  fieldKey: string;
  fieldLabel: string;
  concept: string;
  entity: string;
  entityLabel: string;
  /** 제출 문서(draft 제외) 기준 집계 */
  totalDocs: number;
  linkedDocs: number;
  manualDocs: number; // '직접 입력'(마스터 미연결) 문서
  missingDocs: number;
}

export interface SemanticsWarning {
  kind: "travel_tag_outside" | "travel_option_in_expense" | "untagged";
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
    untaggedCount: number;
    taggedConcepts: string[]; // ref.* 제외, 명시 태깅된 개념 key 목록(중복 제거)
  }[];
  edges: RefEdge[];
  systemSources: { key: string; label: string; desc: string; rows: number | null }[];
  warnings: SemanticsWarning[];
}

/** 경비 채널 정책(§4-4): 출장 경비(cost.travel)의 표준 입력 양식 */
const TRAVEL_FORM_ID = "frm-biz-trip-report";
const EXPENSE_FORM_ID = "frm-expense-report";
const TRAVEL_OPTION_PATTERN = /교통비|숙박비|유류비|일비|출장/;

/** 문서 값에서 "마스터 연결 성공"을 판정하는 SQL 조각 — 엔티티별 저장 구조가 다르다. */
function linkedCondition(entity: string, keyParam: string): string {
  switch (entity) {
    case "contract":
      return `field_values->${keyParam}->>'contractId' IS NOT NULL`;
    case "company":
      return `field_values->${keyParam}->>'facilityId' IS NOT NULL`;
    case "employee":
      // user_select 는 단일 {employeeId,name} 또는 복수 배열
      return `CASE WHEN jsonb_typeof(field_values->${keyParam}) = 'array'
                   THEN jsonb_array_length(field_values->${keyParam}) > 0
                   ELSE field_values->${keyParam}->>'employeeId' IS NOT NULL END`;
    default:
      // dept_select 는 자유 텍스트 저장 — 값 존재만 검사
      return `COALESCE(field_values->>${keyParam}, '') <> ''`;
  }
}

function refFieldsOf(fields: ApprovalFieldDef[]): { field: ApprovalFieldDef; concept: string }[] {
  return fields
    .map((f) => ({ field: f, concept: AUTO_CONCEPT_BY_TYPE[f.type] ?? "" }))
    .filter((x): x is { field: ApprovalFieldDef; concept: string } => !!x.concept);
}

export async function getSemanticsOverview(): Promise<SemanticsOverview> {
  const db = await getDb();
  const formRows = rowsToObjects(
    await db.exec("SELECT form_id, name, version, fields FROM approval_forms WHERE use_yn = 1 ORDER BY sort_order, name")
  );

  const forms: SemanticsOverview["forms"] = [];
  const edges: RefEdge[] = [];
  const warnings: SemanticsWarning[] = [];

  for (const r of formRows) {
    const formId = String(r.form_id ?? "");
    const name = String(r.name ?? "");
    const fields = parseFields(r.fields);

    // 제출 문서 수(임시저장 제외 — 연결 진단은 제출된 문서가 대상)
    const docCountRows = rowsToObjects(
      await db.exec("SELECT count(*)::int AS n FROM approval_docs WHERE form_id = $1 AND status <> 'draft'", [formId])
    );
    const submittedDocs = Number(docCountRows[0]?.n ?? 0);

    // 미태깅(분석 후보인데 의미 미지정) — §8-6 소프트 안내의 진단 화면 버전
    const untagged = fields.filter(
      (f) => ["currency", "number", "date", "period"].includes(f.type) && !f.semantic?.concept
    );
    if (untagged.length > 0) {
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

    // 엔티티 참조 엣지 + 연결 집계
    for (const { field, concept } of refFieldsOf(fields)) {
      const ent = REF_ENTITY[concept];
      if (!ent) continue;
      const linked = linkedCondition(ent.entity, "$2");
      const aggRows = rowsToObjects(
        await db.exec(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE ${linked})::int AS linked,
                  count(*) FILTER (WHERE field_values->$2->>'manual' = 'true')::int AS manual
             FROM approval_docs WHERE form_id = $1 AND status <> 'draft'`,
          [formId, field.key]
        )
      );
      const total = Number(aggRows[0]?.total ?? 0);
      const linkedN = Number(aggRows[0]?.linked ?? 0);
      const manualN = Number(aggRows[0]?.manual ?? 0);
      edges.push({
        formId,
        formName: name,
        fieldKey: field.key,
        fieldLabel: field.label,
        concept,
        entity: ent.entity,
        entityLabel: ent.label,
        totalDocs: total,
        linkedDocs: linkedN,
        manualDocs: manualN,
        missingDocs: Math.max(0, total - linkedN - manualN),
      });
    }

    forms.push({ formId, name, version: Number(r.version ?? 1), submittedDocs, untaggedCount: untagged.length, taggedConcepts: [...tagged] });
  }

  // 시스템 소스 행 수(테이블 미존재 등 실패는 null — 화면에서 '미구축' 표시)
  const systemSources: SemanticsOverview["systemSources"] = [];
  for (const s of SYSTEM_SOURCES) {
    let rows: number | null = null;
    try {
      const rr = rowsToObjects(await db.exec(s.countSql));
      rows = Number(Object.values(rr[0] ?? {})[0] ?? 0);
    } catch {
      rows = null;
    }
    systemSources.push({ key: s.key, label: s.label, desc: s.desc, rows });
  }

  return { forms, edges, systemSources, warnings };
}

export interface MissingDoc {
  docId: string;
  docNo: string | null;
  status: string;
  drafterName: string | null;
  submittedAt: string | null;
  manual: boolean;
}

/** 특정 양식×참조 필드의 미연결(또는 직접 입력) 문서 목록 — 진단 상세에서 원인 추적용. */
export async function listUnlinkedDocs(formId: string, fieldKey: string, limit = 30): Promise<MissingDoc[]> {
  const db = await getDb();
  const formRows = rowsToObjects(await db.exec("SELECT fields FROM approval_forms WHERE form_id = $1", [formId]));
  if (!formRows.length) return [];
  const field = parseFields(formRows[0].fields).find((f) => f.key === fieldKey);
  const concept = field ? AUTO_CONCEPT_BY_TYPE[field.type] : undefined;
  const ent = concept ? REF_ENTITY[concept] : undefined;
  if (!field || !ent) return [];
  const linked = linkedCondition(ent.entity, "$2");
  const rows = rowsToObjects(
    await db.exec(
      `SELECT doc_id, doc_no, status, drafter_name, submitted_at,
              (field_values->$2->>'manual' = 'true') AS manual
         FROM approval_docs
        WHERE form_id = $1 AND status <> 'draft' AND NOT (${linked})
        ORDER BY submitted_at DESC NULLS LAST
        LIMIT ${Math.max(1, Math.min(100, limit))}`,
      [formId, fieldKey]
    )
  );
  return rows.map((r) => ({
    docId: String(r.doc_id ?? ""),
    docNo: r.doc_no != null ? String(r.doc_no) : null,
    status: String(r.status ?? ""),
    drafterName: r.drafter_name != null ? String(r.drafter_name) : null,
    submittedAt: r.submitted_at != null ? String(r.submitted_at) : null,
    manual: r.manual === true,
  }));
}
