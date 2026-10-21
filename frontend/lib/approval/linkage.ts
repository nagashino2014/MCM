import type { ApprovalFieldDef } from "@/lib/approval/fields";

/*
 * 양식 ↔ 마스터 연결 판정(클라이언트 안전, 순수 함수) — 데이터 관계 맵(L0)·지표 엔진(L3) 공용.
 * 설계: docs/approval-master-linkage-audit-2026-10-21.md §4 L0.
 * 관계 맵이 문서 단위 검색 필드 4종만 세던 것을 넓혀, 이미 ID 를 저장하는 참조를 모두 "연결 슬롯"으로 본다.
 *  - 문서 단위(doc): 계약·업체·직원·부서 검색, 차량(asset_select), 접견인(contact_select), 휴가 종류(leave_type)
 *  - 표 행 단위(row): people 열(직원), related 열(연관 용역/사업장 — 행 메타 _relatedContractId/_relatedFacilityId),
 *    부서·직급 선택 열, 행 직원 메타(_employeeId — 표 rowRef: "employee", 인사·급여 자동 생성 표)
 *  - 전용 화면 양식(value): 견적·공문·계약서처럼 fields 는 표시용이고 실제 참조는 값 안의 경로에 있다
 * ⚠ 서버 전용 import 금지(pg).
 */

export const LINK_ENTITIES = ["contract", "company", "employee", "dept", "position", "asset", "contact", "leave_type"] as const;
export type LinkEntity = (typeof LINK_ENTITIES)[number];

export const LINK_ENTITY_LABEL: Record<LinkEntity, string> = {
  contract: "계약(용역)",
  company: "업체(사업장)",
  employee: "직원",
  dept: "부서",
  position: "직급",
  asset: "자산(차량)",
  contact: "업체 담당자",
  leave_type: "휴가 종류",
};

/** 표 행 메타 — 인사·급여 자동 생성 표의 행 대상 직원(rowRef: "employee") */
export const ROW_EMPLOYEE_KEY = "_employeeId";
const RELATED_CONTRACT_KEY = "_relatedContractId";
const RELATED_FACILITY_KEY = "_relatedFacilityId";

export interface LinkSlot {
  /** 문서 단위 / 표 행 단위 / 전용 화면 값 경로 */
  level: "doc" | "row" | "value";
  entity: LinkEntity;
  fieldKey: string;
  fieldLabel: string;
  columnKey?: string;
  /** value 슬롯 — field_values 안의 경로 */
  path?: (string | number)[];
}

/** 필드 타입 → 문서 단위 참조 엔티티 */
const DOC_TYPE_ENTITY: Partial<Record<string, LinkEntity>> = {
  contract_select: "contract",
  company_select: "company",
  user_select: "employee",
  dept_select: "dept",
  asset_select: "asset",
  contact_select: "contact",
  leave_type: "leave_type",
};

/** 표 열 타입 → 행 단위 참조 엔티티(related 는 계약·사업장 두 슬롯) */
const ROW_TYPE_ENTITY: Partial<Record<string, LinkEntity>> = {
  people: "employee",
  dept: "dept",
  position: "position",
};

/**
 * 전용 화면 양식(견적·공문·계약서) — fields 는 표시용 text 뿐이라 값 안의 참조 경로를 고정 등록한다.
 * 경로는 lib/quote·letter·agreement 의 types.ts 값 구조를 따른다.
 */
const VALUE_SLOTS: Record<string, { entity: LinkEntity; label: string; path: (string | number)[] }[]> = {
  "frm-quotation": [
    { entity: "company", label: "수신처", path: ["recipients", 0, "facilityId"] },
    { entity: "contact", label: "참조(담당자)", path: ["cc_refs", 0, "contactId"] },
  ],
  "frm-official-letter": [
    { entity: "company", label: "수신처", path: ["recipients", 0, "facilityId"] },
    { entity: "contact", label: "참조(담당자)", path: ["cc_refs", 0, "contactId"] },
  ],
  "frm-agreement": [
    { entity: "company", label: "발주처", path: ["orderer", "facilityId"] },
    { entity: "contract", label: "계약", path: ["contractId"] },
  ],
};

/**
 * 연계 대상이 아닌 양식 — 공지성 문서라 마스터 귀속이 필요 없다(맵에서 "연계 대상 아님"으로 분류).
 * 기안자 자신이 대상인 인사 신청(휴가·결근·휴직·퇴직·증명서)은 기안자(drafter_employee_id)로 이미 직원에 귀속된다.
 */
export const NON_LINK_FORMS: Record<string, string> = {
  "frm-internal-notice": "공지성 문서 — 수신·발신만 있어 마스터 귀속이 필요 없습니다.",
};

export function linkSlotsOf(formId: string, fields: ApprovalFieldDef[]): LinkSlot[] {
  const out: LinkSlot[] = [];
  for (const f of fields) {
    const docEntity = DOC_TYPE_ENTITY[f.type];
    if (docEntity) out.push({ level: "doc", entity: docEntity, fieldKey: f.key, fieldLabel: f.label });
    if (f.type !== "table") continue;
    if (f.rowRef === "employee") out.push({ level: "row", entity: "employee", fieldKey: f.key, fieldLabel: `${f.label}(대상 직원)`, columnKey: ROW_EMPLOYEE_KEY });
    for (const c of f.tableColumns ?? []) {
      if (c.type === "related") {
        out.push({ level: "row", entity: "contract", fieldKey: f.key, fieldLabel: `${f.label} · ${c.label}`, columnKey: c.key });
        out.push({ level: "row", entity: "company", fieldKey: f.key, fieldLabel: `${f.label} · ${c.label}`, columnKey: c.key });
        continue;
      }
      const rowEntity = ROW_TYPE_ENTITY[c.type];
      if (rowEntity) out.push({ level: "row", entity: rowEntity, fieldKey: f.key, fieldLabel: `${f.label} · ${c.label}`, columnKey: c.key });
    }
  }
  for (const v of VALUE_SLOTS[formId] ?? []) {
    out.push({ level: "value", entity: v.entity, fieldKey: v.path.join("."), fieldLabel: v.label, path: v.path });
  }
  return out;
}

export interface SlotTally {
  total: number;
  linked: number;
  manual: number;
  missing: number;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function filled(v: unknown): boolean {
  // 불리언 표식(manual:false 등)은 값으로 세지 않는다 — 빈 검색 값 {name:"", manual:false} 가 '직접 입력'으로 잡히지 않게
  if (typeof v === "boolean") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isObj(v)) return Object.values(v).some(filled);
  return String(v ?? "").trim() !== "";
}
const TABLE_META = new Set(["_cardTxnId", "_receiptId", "_shopReceiptId", RELATED_CONTRACT_KEY, RELATED_FACILITY_KEY, ROW_EMPLOYEE_KEY]);

/** 값 하나의 연결 상태 — linked(마스터 ID 있음) / manual(값은 있는데 ID 없음) / missing(값 없음) */
export function judgeRefValue(entity: LinkEntity, v: unknown): "linked" | "manual" | "missing" {
  if (v == null || !filled(v)) return "missing";
  const first = Array.isArray(v) ? v[0] : v;
  if (!isObj(first)) {
    // 문자열 값 — 휴가 종류 코드는 그 자체가 카탈로그 키, 나머지(부서 자유 텍스트 등)는 직접 입력
    return entity === "leave_type" ? "linked" : "manual";
  }
  const idKey: Record<LinkEntity, string[]> = {
    contract: ["contractId"],
    company: ["facilityId"],
    employee: ["employeeId"],
    dept: ["deptId"],
    position: ["positionId"],
    asset: ["assetId"],
    contact: ["id", "contactId"],
    leave_type: ["code", "key"],
  };
  if (idKey[entity].some((k) => String(first[k] ?? "").trim() !== "")) return "linked";
  return "manual";
}

function at(v: unknown, path: (string | number)[]): unknown {
  let cur: unknown = v;
  for (const p of path) {
    if (cur == null) return undefined;
    cur = (cur as Record<string | number, unknown>)[p];
  }
  return cur;
}

/** 문서 한 건에서 슬롯의 연결 상태를 센다. 문서·값 슬롯은 1건, 표 행 슬롯은 값이 있는 행 수만큼. */
export function tallySlot(slot: LinkSlot, fieldValues: Record<string, unknown>): SlotTally {
  const t: SlotTally = { total: 0, linked: 0, manual: 0, missing: 0 };
  const add = (s: "linked" | "manual" | "missing") => {
    t.total += 1;
    t[s] += 1;
  };
  if (slot.level === "doc") {
    add(judgeRefValue(slot.entity, fieldValues[slot.fieldKey]));
    return t;
  }
  if (slot.level === "value") {
    const v = at(fieldValues, slot.path ?? []);
    add(String(v ?? "").trim() !== "" ? "linked" : "missing");
    return t;
  }
  const rows = fieldValues[slot.fieldKey];
  if (!Array.isArray(rows)) return t;
  for (const row of rows) {
    if (!isObj(row)) continue;
    // 빈 행(최소 행 수로 깔린 행)은 세지 않는다 — 메타 키만 있는 행도 빈 행
    if (!Object.entries(row).some(([k, v]) => !TABLE_META.has(k) && filled(v))) continue;
    if (slot.columnKey === ROW_EMPLOYEE_KEY) {
      add(String(row[ROW_EMPLOYEE_KEY] ?? "").trim() ? "linked" : "manual");
      continue;
    }
    const cell = row[slot.columnKey ?? ""];
    if (slot.entity === "contract" || slot.entity === "company") {
      // related 열 — 표시 문자열은 열 값, ID 는 행 메타
      const cid = String(row[RELATED_CONTRACT_KEY] ?? "").trim();
      const fid = String(row[RELATED_FACILITY_KEY] ?? "").trim();
      const id = slot.entity === "contract" ? cid : fid;
      if (id) add("linked");
      // 다른 쪽 ID 만 있는 행(계약 전 영업 출장이라 사업장만 고른 행 등)은 이 엔티티 기준 미해당 — 세지 않는다
      else if (cid || fid) continue;
      else add(filled(cell) ? "manual" : "missing");
      continue;
    }
    add(judgeRefValue(slot.entity, cell));
  }
  return t;
}

/** 금액(currency) 필드·열이 있는가 — "금액이 있는데 귀속 참조가 없음" 경고(L0 진단·L4 빌더 가드) 판정용 */
export function hasCurrency(fields: ApprovalFieldDef[]): boolean {
  return fields.some((f) => f.type === "currency" || (f.tableColumns ?? []).some((c) => c.type === "currency"));
}

/** 비용 귀속 참조(계약·업체·부서·직원)가 하나라도 있는가 */
export function hasAttributionRef(slots: LinkSlot[]): boolean {
  return slots.some((s) => s.entity === "contract" || s.entity === "company" || s.entity === "dept" || s.entity === "employee");
}

/**
 * 빌더 저장 전 소프트 경고(L4) — 저장은 막지 않는다.
 *  1) 금액이 있는데 관련 용역·업체·부서·직원 참조가 없음
 *  2) 사람·부서를 자유 텍스트로 받는 표 열(성명·부서 등)
 */
export function linkageWarningsOf(formId: string, fields: ApprovalFieldDef[]): string[] {
  if (NON_LINK_FORMS[formId]) return [];
  const out: string[] = [];
  const slots = linkSlotsOf(formId, fields);
  if (hasCurrency(fields) && !hasAttributionRef(slots)) {
    out.push("금액 항목이 있는데 관련 용역·업체·부서·직원 참조 항목이 없습니다 — 용역·부서별 집계에서 빠집니다. '계약 검색' 항목 추가를 검토하세요.");
  }
  const TEXT_PERSON = /^(성명|이름|직원|대상자|부서|소속)/;
  for (const f of fields) {
    if (f.type !== "table" || f.rowRef === "employee") continue;
    const bad = (f.tableColumns ?? []).filter((c) => c.type === "text" && TEXT_PERSON.test(c.label.trim()));
    if (bad.length) {
      out.push(`표 '${f.label}'의 ${bad.map((c) => `'${c.label}'`).join(", ")} 열이 자유 입력입니다 — 직원은 '인원 선택', 부서는 '부서 선택' 열로 받아야 마스터에 연결됩니다.`);
    }
  }
  return out;
}
