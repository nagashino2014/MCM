/*
 * 법인차량 예약 규칙(2026-11-12 사용자 결정) — 클라이언트 안전 모듈(DB 의존 없음).
 * - 자산 이용 현황의 직접 예약은 우체국 방문처럼 짧은 일시 사용만 받는다: 하루 안의 시작·종료 시각 필수.
 * - 출장은 출장신청서(교통편 '법인차량' + 이용차량·이용시간)로만 예약한다. 상신=가예약, 승인=확정,
 *   반려·취소=해제 — 결재 문서 상태에서 실시간 파생되므로 별도 예약 표가 없다(lib/assets/usage.ts).
 * - 같은 차량의 직접 예약·다른 출장과 겹치면 출장 상신과 직접 예약 저장을 모두 막는다.
 * 차량이 아닌 자산(회의실·기타)의 예약 규칙은 여기서 다루지 않는다.
 */
import type { TripVehicleUse } from "@/lib/approval/trip";

/** 자산 이용 현황 화면·서버 오류에 함께 쓰는 안내 문구. */
export const TRIP_VEHICLE_GUIDE = "출장은 출장신청서에서 법인차량을 선택하세요";

/** 출장신청서 작성 화면 경로. */
export const TRIP_DRAFT_HREF = "/approval/draft?formId=frm-biz-trip-request";

/** 차량 이용 구간 — 날짜 범위 + (하루짜리일 때만) 시각. 시각이 없으면 그날들 전체를 쓴다. */
export interface VehicleSlot {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  startTime: string | null; // HH:mm
  endTime: string | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * 법인차량 직접 예약의 시각 검사 — 시작·종료가 모두 있고 같은 날 안에서 시작 < 종료여야 한다.
 * 문제가 있으면 사용자에게 보일 문장을, 통과하면 null 을 돌려준다.
 */
export function vehicleReservationTimeError(startTime: string | null | undefined, endTime: string | null | undefined): string | null {
  const start = startTime?.trim() || "";
  const end = endTime?.trim() || "";
  if (!start || !end) return `법인차량은 시작·종료 시각을 넣어 하루 안의 짧은 사용만 예약합니다. ${TRIP_VEHICLE_GUIDE}.`;
  if (!HHMM.test(start) || !HHMM.test(end)) return "시각은 HH:mm 형식으로 입력하세요.";
  if (start >= end) return "종료 시각은 시작 시각보다 뒤여야 합니다(하루를 넘길 수 없습니다).";
  return null;
}

/**
 * 출장의 차량 이용 구간 — 여러 날 출장은 기간 전체(종일), 하루 출장의 이용시간 오전·오후는
 * 그 반나절만 잡는다(오후 우체국 방문과 오전 출장이 함께 들어갈 수 있게).
 */
export function tripVehicleSlot(use: Pick<TripVehicleUse, "period" | "carTime">): VehicleSlot {
  const { from, to } = use.period;
  if (from === to && use.carTime === "오전") return { startDate: from, endDate: to, startTime: "00:00", endTime: "12:00" };
  if (from === to && use.carTime === "오후") return { startDate: from, endDate: to, startTime: "12:00", endTime: "24:00" };
  return { startDate: from, endDate: to, startTime: null, endTime: null };
}

/** 두 이용 구간이 겹치는지 — 날짜가 겹치고, 둘 다 같은 하루의 시각이 있으면 시각까지 비교한다. */
export function vehicleSlotsOverlap(a: VehicleSlot, b: VehicleSlot): boolean {
  if (a.startDate > b.endDate || a.endDate < b.startDate) return false;
  const aTimed = a.startDate === a.endDate && !!a.startTime && !!a.endTime;
  const bTimed = b.startDate === b.endDate && !!b.startTime && !!b.endTime;
  if (aTimed && bTimed && a.startDate === b.startDate) {
    return a.startTime! < b.endTime! && b.startTime! < a.endTime!;
  }
  return true;
}

/** MM.DD(~MM.DD)( HH:mm~HH:mm) — 겹침 안내 문장용. 반나절 출장은 오전·오후로 적는다. */
export function formatVehicleSlot(s: VehicleSlot): string {
  const d = (v: string) => v.slice(5).replace("-", ".");
  const range = s.startDate === s.endDate ? d(s.startDate) : `${d(s.startDate)}~${d(s.endDate)}`;
  if (!s.startTime || !s.endTime) return range;
  if (s.startTime === "00:00" && s.endTime === "12:00") return `${range} 오전`;
  if (s.startTime === "12:00" && s.endTime === "24:00") return `${range} 오후`;
  return `${range} ${s.startTime}~${s.endTime}`;
}
