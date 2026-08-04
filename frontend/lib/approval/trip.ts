/*
 * 출장신청서(frm-biz-trip-request) field_values 해석 헬퍼 — 클라이언트 안전 모듈(DB 의존 없음).
 * 일정 캘린더(lib/calendar/queries.ts)와 자산 이용 현황(lib/assets/usage.ts)이 공유한다.
 */

export const TRIP_FORM_ID = "frm-biz-trip-request";
export const EDUCATION_FORM_ID = "frm-education-request";

/** 용역분류 표준 옵션(122 개정) — 일정 스케줄명 "[출장지]:[용역분류]"의 원천. */
export const CONTRACT_CLASS_OPTIONS = ["통합허가", "화관법", "HAPs", "ESG탄소중립", "기타"] as const;

/** 122 개정 전 옵션 → 개정 후 옵션 매핑(기존 문서 데이터는 손대지 않고 조회 시 정규화). */
const LEGACY_CONTRACT_CLASS: Record<string, string> = {
  통합환경허가: "통합허가",
  "장외&화관법": "화관법",
  HAPs: "HAPs",
  "Etc.": "기타",
};

export function normalizeContractClass(value: unknown): string[] {
  const arr = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
  const out: string[] = [];
  for (const raw of arr) {
    const v = LEGACY_CONTRACT_CLASS[raw] ?? raw;
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export interface TripPeriod {
  from: string; // YYYY-MM-DD
  to: string;
}

/** period 값({from,to})을 정규화 — to 누락 시 from 으로 보정. 둘 다 없으면 null. */
export function parsePeriod(value: unknown): TripPeriod | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { from?: unknown; to?: unknown };
  const from = String(v.from ?? "").slice(0, 10);
  const to = String(v.to ?? "").slice(0, 10) || from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return null;
  return { from, to: /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : from };
}

/**
 * 출장지 추출 — 구양식의 destination(텍스트) 우선, 없으면 개정 양식의 업체 검색 값
 * ({name, facilityId|manual} 형태)을 키와 무관하게 탐색해 업체명을 쓴다
 * (관리자가 빌더에서 출장지를 업체 검색으로 교체한 실측 대응 — field_12 등 임의 키).
 * asset_select 값({name, assetId})은 facilityId/manual 이 없어 걸리지 않는다.
 */
export function extractTripDestination(fieldValues: Record<string, unknown>): string | null {
  const direct = String(fieldValues.destination ?? "").trim();
  if (direct) return direct;
  for (const v of Object.values(fieldValues)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as { name?: unknown; facilityId?: unknown; manual?: unknown };
      if (typeof o.name === "string" && o.name.trim() && ("facilityId" in o || "manual" in o)) {
        return o.name.trim();
      }
    }
  }
  return null;
}

export interface TripVehicleUse {
  /** asset_select 값의 assetId(레거시 문자열 값이면 null) */
  assetId: string | null;
  /** 차종명(니로, K8 …) */
  assetName: string;
  period: TripPeriod;
  /** 이용시간(종일/오전/오후) */
  carTime: string | null;
}

/**
 * 출장 문서에서 법인차량 이용을 추출한다 — transport 체크박스에 '법인차량' 이 포함되고
 * car_name 이 선택된 상신 건만 차량 일정으로 인정. 값 형태는
 * {assetId,name}(asset_select) 또는 문자열(122 개정 전 select) 둘 다 수용한다.
 */
export function extractVehicleUse(fieldValues: Record<string, unknown>): TripVehicleUse | null {
  const transport = fieldValues.transport;
  const arr = Array.isArray(transport) ? transport.map(String) : [];
  if (!arr.includes("법인차량")) return null;
  const period = parsePeriod(fieldValues.trip_period);
  if (!period) return null;

  const car = fieldValues.car_name;
  let assetId: string | null = null;
  let assetName = "";
  if (car && typeof car === "object") {
    const v = car as { assetId?: unknown; name?: unknown };
    assetId = v.assetId != null ? String(v.assetId) : null;
    assetName = String(v.name ?? "");
  } else if (car != null) {
    assetName = String(car);
  }
  if (!assetName.trim()) return null;

  const carTime = fieldValues.car_time != null && String(fieldValues.car_time).trim() ? String(fieldValues.car_time) : null;
  return { assetId, assetName: assetName.trim(), period, carTime };
}
