/**
 * 설문 표시용 헬퍼 — 목록·상세·모바일이 같은 문구를 쓰도록 한 곳에 모은다.
 */
import type { SurveyRow, SurveyStatus } from "./types";

export const STATUS_LABELS: Record<SurveyStatus, string> = {
  draft: "작성 중",
  open: "응답 접수",
  closed: "마감",
};

/** CdBadge tone 매핑. */
export const STATUS_TONES: Record<SurveyStatus, "idle" | "info" | "success" | "warn"> = {
  draft: "idle",
  open: "success",
  closed: "warn",
};

const dot = (d: string) => d.replace(/-/g, ".").replace(/^20/, "");

/** "25.09.17 ~ 25.09.28" — 한쪽만 있으면 그쪽만. 둘 다 없으면 빈 문자열(= 상시). */
export function formatPeriod(s: Pick<SurveyRow, "periodStart" | "periodEnd">): string {
  if (s.periodStart && s.periodEnd) return `${dot(s.periodStart)} ~ ${dot(s.periodEnd)}`;
  if (s.periodStart) return `${dot(s.periodStart)} ~`;
  if (s.periodEnd) return `~ ${dot(s.periodEnd)}`;
  return "";
}

/** 기간 대비 오늘 위치를 한 마디로. 접수 중 설문의 남은 기간 안내에 쓴다. */
export function periodNote(
  s: Pick<SurveyRow, "periodStart" | "periodEnd" | "status">,
  today = new Date().toISOString().slice(0, 10)
): string {
  if (s.status !== "open") return "";
  if (s.periodStart && today < s.periodStart) return "시작 전";
  if (s.periodEnd && today > s.periodEnd) return "기간 종료";
  if (s.periodEnd) {
    const left = Math.round((Date.parse(s.periodEnd) - Date.parse(today)) / 86_400_000);
    if (left <= 0) return "오늘 마감";
    if (left <= 3) return `${left}일 남음`;
  }
  return "";
}

/** 배포 이미지 기본 문구용 — "2026.9.17(목) ~ 9.28(월)". */
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function formatPeriodLong(start: string | null, end: string | null): string {
  const fmt = (d: string, withYear: boolean) => {
    const dt = new Date(`${d}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return d;
    const [y, m, day] = d.split("-").map(Number);
    const w = WEEKDAYS[dt.getDay()];
    return withYear ? `${y}.${m}.${day}(${w})` : `${m}.${day}(${w})`;
  };
  if (start && end) return `${fmt(start, true)} ~ ${fmt(end, false)}`;
  if (start) return `${fmt(start, true)} ~`;
  if (end) return `~ ${fmt(end, true)}`;
  return "";
}
