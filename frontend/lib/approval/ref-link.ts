/*
 * 선행 문서 연관(127) — 후행 문서(보고서)와 선행 문서(신청서) 값의 불일치 비교.
 * 클라이언트 안전 모듈(DB 의존 없음) — 기안 화면이 선택 시·입력 시 양쪽에서 호출하고,
 * 상신 시 서버(ref-check.ts)가 같은 함수로 판정을 스냅샷한다.
 * 비교 기준(사용자 확정): 업체명 · 방문일시(기간) · 계약명.
 * 양식별 추가 규칙(2026-09-15 사용자 요청 — 연계 정합성 검증):
 *   출장보고서 ↔ 출장신청서: 출장기간(정확) · 용역분류(집합) · 업체명(출장지 텍스트 폴백) · 계약명
 *   교육훈련 보고 ↔ 신청: 교육기간(정확) · 교육명·교육기관(직접 입력이라 오타 허용 — 느슨한 매칭)
 *   지출결의서(법인카드) ↔ 구매품의서: 양식 간 연결만 — 사용 내역 합계가 품의 합계를 크게 넘으면 경고
 * 양쪽 모두 값이 있을 때만 비교하고, 선행 문서의 필드 스키마는 모를 수 있으므로 값의 형태(shape)로 식별한다.
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

// ── 느슨한 텍스트 매칭(교육명·교육기관 — 사용자가 직접 입력하는 값이라 오타·표기 차이를 용인) ──

/** 비교용 정규화 — 소문자·공백·법인 표기·괄호·구두점 제거(" (주)한국환경 교육원 " → "한국환경교육원"). */
export function looseKey(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\(주\)|㈜|주식회사|\(유\)|\(사\)|\(재\)/g, "")
    .replace(/[\s　]+/g, "")
    .replace(/[()\[\]{}<>「」『』"'`.,·:;!?/\\\-_~—–]/g, "");
}

/** 문자 바이그램 Dice 유사도(0~1) — 짧은 한글 명칭에서도 오타 1~2자를 흡수한다. */
export function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/** 느슨한 일치 판정 — 정규화 후 동일 / 한쪽이 다른 쪽을 포함(2자 이상) / 바이그램 유사도 ≥ 0.6. */
export function looseMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = looseKey(a);
  const kb = looseKey(b);
  if (!ka || !kb) return true; // 한쪽이 비면 비교 대상 아님
  if (ka === kb) return true;
  const shorter = ka.length <= kb.length ? ka : kb;
  const longer = shorter === ka ? kb : ka;
  if (shorter.length >= 2 && longer.includes(shorter)) return true;
  return diceSimilarity(ka, kb) >= 0.6;
}

/** 체크박스(배열)·단일 값을 정규화된 문자열 집합으로 — 122 개정 전 용역분류 옵션 표기도 맞춘다. */
const LEGACY_CLASS: Record<string, string> = { 통합환경허가: "통합허가", "장외&화관법": "화관법", "Etc.": "기타", 통합: "통합허가" };
function toClassSet(v: unknown): string[] {
  const arr = Array.isArray(v) ? v.map(String) : typeof v === "string" && v.trim() ? [v] : [];
  const out = new Set<string>();
  for (const raw of arr) {
    const t = raw.trim();
    if (!t) continue;
    out.add(LEGACY_CLASS[t] ?? t);
  }
  return [...out].sort();
}

const sumTable = (rows: unknown, amountKey: string): number => {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce<number>((acc, r) => {
    if (!isObj(r)) return acc;
    const n = Number(String(r[amountKey] ?? "").replace(/[^\d.-]/g, ""));
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
};

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

/** 양식별 정합성 규칙 — 후행 양식 id → 검사 함수. 범용 검사(업체·기간·계약명) 뒤에 추가로 돈다. */
type RuleFn = (fields: ApprovalFieldDef[], values: Record<string, unknown>, refValues: Record<string, unknown>) => RefMismatch[];

const FORM_RULES: Record<string, RuleFn> = {
  // 출장보고서 ↔ 출장신청서 — 용역분류(service_class ↔ contract_class 집합 비교). 기간·계약명은 범용 검사가 담당.
  "frm-biz-trip-report": (_fields, values, refValues) => {
    const out: RefMismatch[] = [];
    const cur = toClassSet(values.service_class ?? values.contract_class);
    const ref = toClassSet(refValues.contract_class ?? refValues.service_class);
    if (cur.length && ref.length && cur.join("|") !== ref.join("|")) {
      out.push({ label: "용역분류", refText: ref.join(", "), curText: cur.join(", ") });
    }
    return out;
  },
  // 교육훈련 보고 ↔ 신청 — 교육명·교육기관은 느슨한 매칭(오타 허용). 교육기간은 범용 period 검사(정확).
  "frm-education-report": (_fields, values, refValues) => {
    const out: RefMismatch[] = [];
    for (const [key, label] of [
      ["edu_name", "교육명"],
      ["edu_org", "교육기관"],
    ] as const) {
      const cur = typeof values[key] === "string" ? (values[key] as string).trim() : "";
      const ref = typeof refValues[key] === "string" ? (refValues[key] as string).trim() : "";
      if (cur && ref && !looseMatch(cur, ref)) out.push({ label, refText: ref, curText: cur });
    }
    return out;
  },
  // 지출결의서(법인카드) ↔ 구매품의서 — 항목 매칭 대신 양식 간 연결만 검증. 사용 내역 합계가 품의 합계를
  // 10% 넘게 초과하면 경고(품의 범위 밖 지출이 섞였을 가능성).
  "frm-expense-report": (_fields, values, refValues) => {
    const cur = sumTable(values.expenses, "amount");
    const ref = sumTable(refValues.items, "amount");
    if (cur > 0 && ref > 0 && cur > ref * 1.1) {
      return [{ label: "금액(사용 내역 합계 > 구매품의 합계)", refText: `${ref.toLocaleString("ko-KR")}원`, curText: `${cur.toLocaleString("ko-KR")}원` }];
    }
    return [];
  },
};

/**
 * 후행 문서 입력값과 선행 문서 값의 불일치 목록.
 * @param fields 후행 문서(현재 작성 중) 양식 필드 스키마
 * @param values 후행 문서 입력값
 * @param refValues 선행 문서 field_values
 * @param formId 후행 양식 id — 주면 양식별 추가 규칙(FORM_RULES)까지 검사
 */
export function compareWithRefDoc(
  fields: ApprovalFieldDef[],
  values: Record<string, unknown>,
  refValues: Record<string, unknown>,
  formId?: string | null
): RefMismatch[] {
  const out: RefMismatch[] = [];

  // ① 업체명 — 후행 company_select 값 vs 선행 업체형 값(같은 key 우선, 없으면 형태 탐색,
  //    그것도 없으면 출장신청서의 출장지 텍스트(destination)와 느슨 비교)
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
    } else if (curCo?.name && typeof refValues.destination === "string" && refValues.destination.trim()) {
      const dest = refValues.destination.trim();
      if (!looseMatch(curCo.name, dest)) out.push({ label: "업체명(출장지)", refText: dest, curText: curCo.name });
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

  // ④ 양식별 추가 규칙
  const rule = formId ? FORM_RULES[formId] : undefined;
  if (rule) out.push(...rule(fields, values, refValues));

  return out;
}
