// 결재 완료 문서 관리자 값 수정(346) — 순수 규칙(클라이언트 안전). DB 로직은 lib/approval/admin-controls.ts.
//   - 고칠 수 있는 항목: 일자·시각·기간·글·선택형처럼 결재 판단을 바꾸지 않는 간단한 값만.
//     금액(number·currency)·표·첨부·사람/업체/계약 선택·휴가 종류는 결재 판단 자체가 달라지므로 취소 후 재기안한다.
//   - 값은 기안 화면과 같은 저장 형식으로 정규화해 검사한다(date YYYY-MM-DD, time HH:MM, period {from,to}, time_range {start,end}).

import { parseTimeRange, timeRangeText, type ApprovalFieldDef, type ApprovalFieldType } from "@/lib/approval/fields";

export const ADMIN_EDITABLE_TYPES: ApprovalFieldType[] = ["text", "multitext", "date", "time", "time_range", "period", "select", "radio"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TEXT_MAX = 500;
const MULTITEXT_MAX = 20000;

export function isAdminEditable(f: ApprovalFieldDef): boolean {
  return ADMIN_EDITABLE_TYPES.includes(f.type) && !!f.key && !f.key.startsWith("_");
}

/** 문서 양식에서 관리자가 고칠 수 있는 항목(화면 순서). */
export function adminEditableFields(fields: ApprovalFieldDef[]): ApprovalFieldDef[] {
  return fields.filter(isAdminEditable);
}

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type AdminEditCheck = { ok: true; value: unknown } | { ok: false; error: string };

/** 새 값 정규화·검사 — 필수 항목은 비울 수 없다. */
export function normalizeAdminEditValue(f: ApprovalFieldDef, raw: unknown): AdminEditCheck {
  if (!isAdminEditable(f)) return { ok: false, error: `'${f.label}' 항목은 관리자 수정 대상이 아닙니다. 결재 취소 후 다시 기안하세요.` };
  const empty = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");
  switch (f.type) {
    case "text":
    case "multitext": {
      const s = typeof raw === "string" ? (f.type === "text" ? raw.trim() : raw) : "";
      if (f.required && !s.trim()) return { ok: false, error: `'${f.label}'은(는) 비울 수 없습니다.` };
      if (s.length > (f.type === "text" ? TEXT_MAX : MULTITEXT_MAX)) return { ok: false, error: `'${f.label}' 내용이 너무 깁니다.` };
      return { ok: true, value: s };
    }
    case "select":
    case "radio": {
      const s = typeof raw === "string" ? raw : "";
      if (!s) return f.required ? { ok: false, error: `'${f.label}'을(를) 선택하세요.` } : { ok: true, value: "" };
      if (!(f.options ?? []).includes(s)) return { ok: false, error: `'${f.label}'에 없는 선택지입니다.` };
      return { ok: true, value: s };
    }
    case "date": {
      const s = typeof raw === "string" ? raw.trim() : "";
      if (!s) return f.required ? { ok: false, error: `'${f.label}'을(를) 입력하세요.` } : { ok: true, value: "" };
      return validDate(s) ? { ok: true, value: s } : { ok: false, error: `'${f.label}' 날짜가 올바르지 않습니다(YYYY-MM-DD).` };
    }
    case "time": {
      const s = typeof raw === "string" ? raw.trim() : "";
      if (!s) return f.required ? { ok: false, error: `'${f.label}'을(를) 입력하세요.` } : { ok: true, value: "" };
      return HHMM_RE.test(s) ? { ok: true, value: s } : { ok: false, error: `'${f.label}' 시각이 올바르지 않습니다(HH:MM).` };
    }
    case "time_range": {
      const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const start = String(r.start ?? "").trim();
      const end = String(r.end ?? "").trim();
      if (!start && !end) return f.required ? { ok: false, error: `'${f.label}'을(를) 입력하세요.` } : { ok: true, value: {} };
      if (!HHMM_RE.test(start) || !HHMM_RE.test(end)) return { ok: false, error: `'${f.label}' 시작·종료 시각을 모두 HH:MM 으로 입력하세요.` };
      const overnight = r.overnight === true;
      if (!overnight && end <= start) return { ok: false, error: `'${f.label}' 종료가 시작보다 이릅니다. 자정을 넘긴 근무면 익일 야간으로 표시해야 합니다.` };
      return { ok: true, value: { start, end, ...(overnight ? { overnight: true } : {}) } };
    }
    case "period": {
      const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const from = String(r.from ?? "").trim();
      const to = f.singleDay ? from : String(r.to ?? "").trim() || from;
      if (!from) return f.required ? { ok: false, error: `'${f.label}'을(를) 입력하세요.` } : { ok: true, value: {} };
      if (!validDate(from) || !validDate(to)) return { ok: false, error: `'${f.label}' 날짜가 올바르지 않습니다(YYYY-MM-DD).` };
      if (to < from) return { ok: false, error: `'${f.label}' 종료일이 시작일보다 이릅니다.` };
      return { ok: true, value: { from, to } };
    }
    default:
      return empty(raw) ? { ok: true, value: "" } : { ok: false, error: `'${f.label}' 항목은 관리자 수정 대상이 아닙니다.` };
  }
}

/** 값 비교 — 같으면 저장하지 않는다(키 순서 무관). */
export function sameAdminValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (v == null || v === "") return "";
    if (Array.isArray(v)) return v.map(norm);
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).filter((k) => o[k] != null && o[k] !== "" && o[k] !== false).sort();
      return keys.length ? Object.fromEntries(keys.map((k) => [k, norm(o[k])])) : "";
    }
    return String(v);
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** 이력 표시용 짧은 글. */
export function adminValueText(type: string | null | undefined, v: unknown): string {
  if (v == null || v === "") return "(비어 있음)";
  if (type === "time_range") return timeRangeText(parseTimeRange(v)) || "(비어 있음)";
  if (type === "period" && typeof v === "object") {
    const p = v as { from?: string; to?: string };
    if (!p.from) return "(비어 있음)";
    return p.to && p.to !== p.from ? `${p.from} ~ ${p.to}` : p.from;
  }
  if (typeof v === "object") return JSON.stringify(v);
  const s = type === "multitext" ? stripHtml(String(v)) : String(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s || "(비어 있음)";
}
