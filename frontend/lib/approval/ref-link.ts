/*
 * 선행 문서 연관(127) — 후행 문서(보고서)와 선행 문서(신청서) 값의 불일치 비교.
 * 클라이언트 안전 모듈(DB 의존 없음) — 기안 화면이 선택 시·입력 시 양쪽에서 호출한다.
 * 비교 기준(사용자 확정): 업체명 · 방문일시(기간) · 계약명. 양쪽 모두 값이 있을 때만 비교하고,
 * 선행 문서의 필드 스키마는 모를 수 있으므로 값의 형태(shape)로 업체/계약 값을 식별한다.
 */

import type { ApprovalFieldDef } from "@/lib/approval/fields";

export interface RefMismatch {
  label: string;
  refText: string;
  curText: string;
}

interface CompanyShape {
  name?: string;
  facilityId?: string;
  manual?: boolean;
}

interface ContractShape {
  title?: string;
  contractId?: string;
  manual?: boolean;
}

interface PeriodShape {
  from?: string;
  to?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

/** 값 형태로 업체 검색 값({name, facilityId|manual})을 식별한다. */
function findCompanyValue(values: Record<string, unknown>): CompanyShape | null {
  for (const v of Object.values(values)) {
    if (isObj(v) && typeof v.name === "string" && ("facilityId" in v || "manual" in v)) return v as CompanyShape;
  }
  return null;
}

/** 값 형태로 계약 검색 값({title, contractId|manual})을 식별한다. */
function findContractValue(values: Record<string, unknown>): ContractShape | null {
  for (const v of Object.values(values)) {
    if (isObj(v) && typeof v.title === "string" && ("contractId" in v || "manual" in v)) return v as ContractShape;
  }
  return null;
}

const isPeriod = (v: unknown): v is PeriodShape =>
  isObj(v) && (typeof v.from === "string" || typeof v.to === "string") && !("name" in v) && !("title" in v);

const norm = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();
const periodText = (p: PeriodShape) => [p.from ?? "", p.to ?? ""].filter(Boolean).join(" ~ ") || "-";

/** 후행 필드 값이 '비어 있다'고 볼 수 있는지 — 자동 완성은 빈 필드만 채운다(입력 보호). */
function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return !v.trim();
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).every((x) => isEmptyValue(x));
  return false;
}

export interface RefAutofillResult {
  next: Record<string, unknown>;
  filledLabels: string[];
}

/**
 * 선행 문서 선택 시 자동 완성 — 선행 문서와 겹치는 입력 요소를 선행 값으로 채운다.
 * 매칭 우선순위: ① 같은 필드 key ② 선행 양식 스키마(refFields)의 같은 라벨
 * (예: 출장보고서 service_class ↔ 출장신청서 contract_class — 라벨 '용역분류' 매칭)
 * ③ 업체/계약 검색 필드는 값 형태(shape) 탐색(계약은 contract_name 텍스트 폴백 → 직접 입력).
 * 이미 입력된(비어 있지 않은) 필드는 덮지 않는다 — 다르면 불일치 경고가 담당.
 */
export function autofillFromRefDoc(
  fields: ApprovalFieldDef[],
  values: Record<string, unknown>,
  refValues: Record<string, unknown>,
  refFields: ApprovalFieldDef[] = []
): RefAutofillResult {
  const next: Record<string, unknown> = { ...values };
  const filledLabels: string[] = [];
  const labelToRefKey = new Map<string, string>();
  for (const rf of refFields) {
    const label = rf.label.trim();
    if (label && !labelToRefKey.has(label)) labelToRefKey.set(label, rf.key);
  }

  for (const f of fields) {
    if (f.type === "static") continue;
    if (!isEmptyValue(next[f.key])) continue; // 입력 보호 — 빈 필드만 채운다

    let refVal: unknown = refValues[f.key]; // ① 같은 key
    if (isEmptyValue(refVal)) {
      const byLabel = labelToRefKey.get(f.label.trim()); // ② 같은 라벨
      if (byLabel) refVal = refValues[byLabel];
    }
    if (isEmptyValue(refVal)) {
      // ③ 타입별 shape 탐색(선행 스키마를 몰라도 동작)
      if (f.type === "company_select") refVal = findCompanyValue(refValues);
      else if (f.type === "contract_select") {
        const shaped = findContractValue(refValues);
        if (shaped) refVal = shaped;
        else {
          const t = refValues["contract_name"];
          if (typeof t === "string" && t.trim()) refVal = { title: t.trim(), manual: true };
        }
      }
    }
    if (isEmptyValue(refVal)) continue;
    next[f.key] = refVal;
    filledLabels.push(f.label);
  }
  return { next, filledLabels };
}

/**
 * 후행 문서 입력값과 선행 문서 값의 불일치 목록.
 * @param fields 후행 문서(현재 작성 중) 양식 필드 스키마
 * @param values 후행 문서 입력값
 * @param refValues 선행 문서 field_values
 */
export function compareWithRefDoc(
  fields: ApprovalFieldDef[],
  values: Record<string, unknown>,
  refValues: Record<string, unknown>
): RefMismatch[] {
  const out: RefMismatch[] = [];

  // ① 업체명 — 후행 company_select 값 vs 선행 업체형 값(같은 key 우선, 없으면 형태 탐색)
  const companyField = fields.find((f) => f.type === "company_select");
  if (companyField) {
    const cur = values[companyField.key];
    const curCo = isObj(cur) && typeof cur.name === "string" ? (cur as CompanyShape) : null;
    const refRaw = refValues[companyField.key];
    const refCo =
      isObj(refRaw) && typeof refRaw.name === "string" ? (refRaw as CompanyShape) : findCompanyValue(refValues);
    if (curCo?.name && refCo?.name) {
      const same =
        curCo.facilityId && refCo.facilityId ? curCo.facilityId === refCo.facilityId : norm(curCo.name) === norm(refCo.name);
      if (!same) out.push({ label: "업체명", refText: refCo.name, curText: curCo.name });
    }
  }

  // ② 방문일시 — 후행의 period 필드(같은 key 우선) vs 선행 period 값
  for (const f of fields.filter((x) => x.type === "period")) {
    const cur = values[f.key];
    if (!isPeriod(cur) || (!cur.from && !cur.to)) continue;
    let ref: PeriodShape | null = null;
    const sameKey = refValues[f.key];
    if (isPeriod(sameKey)) ref = sameKey;
    else {
      const found = Object.values(refValues).find(isPeriod);
      ref = found ?? null;
    }
    if (!ref || (!ref.from && !ref.to)) continue;
    if (norm(cur.from) !== norm(ref.from) || norm(cur.to) !== norm(ref.to)) {
      out.push({ label: `${f.label}(방문일시)`, refText: periodText(ref), curText: periodText(cur) });
    }
    break; // 대표 기간 1건만 비교(중복 경고 방지)
  }

  // ③ 계약명 — 후행 contract_select 또는 contract_name 텍스트 vs 선행의 계약형 값/contract_name
  const contractField = fields.find((f) => f.type === "contract_select");
  const curContract: string | null = (() => {
    if (contractField) {
      const v = values[contractField.key];
      if (isObj(v) && typeof v.title === "string" && v.title.trim()) return String(v.title);
    }
    const t = values["contract_name"];
    return typeof t === "string" && t.trim() ? t : null;
  })();
  const refContract: string | null = (() => {
    const shaped = findContractValue(refValues);
    if (shaped?.title?.trim()) return shaped.title;
    const t = refValues["contract_name"];
    return typeof t === "string" && t.trim() ? t : null;
  })();
  if (curContract && refContract && norm(curContract) !== norm(refContract)) {
    out.push({ label: "계약명", refText: refContract, curText: curContract });
  }

  return out;
}
