/*
 * 자산 직접 예약의 날짜 범위 규칙(2026-11-12 사용자 결정, 직원 개선 요청 19) — 클라이언트 안전 모듈(DB 의존 없음).
 * - 회의실·기타 자산은 시작일~종료일을 한 건으로 예약한다. 여러 날이면 시각은 첫날 시작·마지막 날 종료로 보고,
 *   비우면 기간 전체 종일이다.
 * - 법인차량은 바꾸지 않는다 — 하루 안의 짧은 사용만(lib/assets/vehicle-booking-rules.ts), 출장은 출장신청서로.
 * 화면(AssetCalendarBoard)과 서버 저장(lib/assets/store.ts)·이용 현황 겹침 표시(lib/assets/usage.ts)가 함께 쓴다.
 */
import type { AssetKind } from "@/lib/assets/types";
import { TRIP_VEHICLE_GUIDE, vehicleReservationTimeError, type VehicleSlot } from "@/lib/assets/vehicle-booking-rules";

/** 이용 구간 — 차량 구간과 같은 모양(날짜 범위 + 시각). */
export type AssetSlot = VehicleSlot;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidYmd(s: string): boolean {
  if (!YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * 직접 예약 입력 검사 — 문제가 있으면 사용자에게 보일 문장을, 통과하면 null 을 돌려준다.
 * endDate 가 비면 시작일 하루로 본다. 법인차량은 종료일이 시작일과 달라질 수 없다.
 */
export function reservationRangeError(input: {
  kind: AssetKind | null | undefined;
  startDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}): string | null {
  const startDate = input.startDate.trim();
  const endDate = input.endDate?.trim() || startDate;
  const start = input.startTime?.trim() || "";
  const end = input.endTime?.trim() || "";
  if (!isValidYmd(startDate)) return "예약 날짜가 올바르지 않습니다.";
  if (!isValidYmd(endDate)) return "종료일이 올바르지 않습니다.";
  if (endDate < startDate) return "종료일은 시작일과 같거나 뒤여야 합니다.";
  if (input.kind === "vehicle") {
    if (endDate !== startDate) return `법인차량은 하루 안의 짧은 사용만 예약합니다. ${TRIP_VEHICLE_GUIDE}.`;
    return vehicleReservationTimeError(start, end);
  }
  if ((start && !end) || (!start && end)) return "시작·종료 시각은 함께 입력하세요.";
  if (start && (!HHMM.test(start) || !HHMM.test(end))) return "시각은 HH:mm 형식으로 입력하세요.";
  if (start && endDate === startDate && start >= end) return "종료 시각은 시작 시각보다 뒤여야 합니다.";
  return null;
}

/** 구간의 시작·끝 시점("YYYY-MM-DD HH:mm") — 시각이 없으면 첫날 00:00 ~ 마지막 날 24:00. */
function slotBounds(s: AssetSlot): [string, string] {
  const timed = !!s.startTime && !!s.endTime;
  return [`${s.startDate} ${timed ? s.startTime : "00:00"}`, `${s.endDate} ${timed ? s.endTime : "24:00"}`];
}

/**
 * 두 이용 구간이 겹치는지 — 첫날 시작 시점부터 마지막 날 종료 시점까지를 한 구간으로 비교한다.
 * 하루짜리·종일·출장 반나절(00:00~12:00 / 12:00~24:00)은 vehicleSlotsOverlap 과 같은 결과이고,
 * 여러 날 시각 지정 예약(예: 11.13 14:00 ~ 11.15 12:00)도 첫날 오전·마지막 날 오후와 겹치지 않는다.
 */
export function assetSlotsOverlap(a: AssetSlot, b: AssetSlot): boolean {
  const [as, ae] = slotBounds(a);
  const [bs, be] = slotBounds(b);
  return as < be && bs < ae;
}
