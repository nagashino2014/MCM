/**
 * ADT 근태 조회 엑셀(.xls/.xlsx) 파서 — 웹 업로드/배치 공용(서버 전용).
 * 본사(전체)·지사(개인) 두 형식을 헤더명 기준으로 매핑한다. 헤더: 사용자ID·부서·직급·이름·근무일자·
 * 근무일명칭·출근·퇴근·기본·연장·총합·인정… "총합" 합계행과 출퇴근 누락일은 스킵.
 * 출근/퇴근 원본 시각으로 자체 재산정하고, 연장/총합/인정(컨트롤러 산정치)은 분으로 환산해 감사 보존.
 */

import * as XLSX from "xlsx";
import type { AdtRawRecord } from "./types";

// 엑셀 헤더명 → AdtRawRecord 필드(vendor 시간류는 *_min 임시키 → 분 환산 후 매핑).
const HEADER_MAP: Record<string, string> = {
  "사용자ID": "e_idno",
  "부서": "c_dept",
  "직급": "c_pos",
  "이름": "e_name",
  "근무일자": "d_date",
  "근무일명칭": "n_date",
  "출근": "in_time",
  "퇴근": "out_time",
  "연장": "over_min",
  "총합": "total_min",
  "인정": "allow_min",
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 엑셀 날짜 셀 → YYYYMMDD. 텍스트('2026/05/26')·serial 모두 대응. */
function normDate(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return "";
    return `${d.y}${pad2(d.m)}${pad2(d.d)}`;
  }
  const digits = String(v).replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : "";
}

/** 엑셀 시각 셀 → HHMMSS. 텍스트('09:07')·serial(0.38..) 모두 대응. 빈값 null. */
function normTime(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    // 시각 serial(하루=1.0)의 소수부. 날짜 포함 serial 이면 소수부만.
    const sec = Math.round((v - Math.floor(v)) * 86400);
    const hh = Math.floor(sec / 3600) % 24;
    const mm = Math.floor((sec % 3600) / 60);
    const ss = sec % 60;
    return `${pad2(hh)}${pad2(mm)}${pad2(ss)}`;
  }
  const digits = String(v).replace(/\D/g, "");
  if (digits.length < 4) return null;
  return (digits + "0000").slice(0, 6); // HHMM → HHMMSS(초 00)
}

/** 엑셀 시간값(하루=1.0 serial) → 분 문자열. 텍스트면 숫자만 추출. 감사용. */
function toMinuteStr(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const min = Math.round(v * 24 * 60);
    return String(min);
  }
  const s = String(v).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s); // 'H:MM' 형태 방어
  if (m) return String(Number(m[1]) * 60 + Number(m[2]));
  const digits = s.replace(/\D/g, "");
  return digits || null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export interface ParseResult {
  records: AdtRawRecord[];
  sheetName: string;
  totalRows: number; // 데이터 후보 행 수(헤더 이후)
  skipped: number; // 총합/누락 등으로 제외된 행
}

/** 엑셀 buffer → AdtRawRecord[]. 첫 시트 사용. */
export function parseAttendanceWorkbook(buf: Buffer | ArrayBuffer): ParseResult {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return { records: [], sheetName: sheetName ?? "", totalRows: 0, skipped: 0 };

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

  // 헤더 행: '근무일자'와 '사용자ID'(또는 '출근')를 포함한 첫 행.
  const isHeader = (row: unknown[]) => {
    const cells = row.map((c) => String(c ?? "").trim());
    return cells.includes("근무일자") && (cells.includes("사용자ID") || cells.includes("출근"));
  };
  const hi = aoa.findIndex((row) => Array.isArray(row) && isHeader(row));
  if (hi < 0) throw new Error("근태 엑셀 헤더(사용자ID·근무일자·출근·퇴근)를 찾지 못했습니다.");

  const header = (aoa[hi] as unknown[]).map((c) => String(c ?? "").trim());
  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = HEADER_MAP[h];
    if (key && idx[key] == null) idx[key] = i;
  });
  if (idx.e_idno == null || idx.d_date == null) {
    throw new Error("필수 컬럼(사용자ID·근무일자)이 없습니다.");
  }

  const records: AdtRawRecord[] = [];
  let totalRows = 0;
  let skipped = 0;
  const get = (row: unknown[], key: string) => (idx[key] != null ? row[idx[key]] : null);

  for (let r = hi + 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!Array.isArray(row)) continue;
    totalRows += 1;
    const eid = str(get(row, "e_idno"));
    const dd = normDate(get(row, "d_date"));
    // 합계행(사용자ID='총합')·빈행·유효하지 않은 날짜 스킵.
    if (!eid || eid === "총합" || !/^\d{8}$/.test(dd)) {
      skipped += 1;
      continue;
    }
    records.push({
      e_idno: eid,
      c_dept: str(get(row, "c_dept")),
      c_pos: str(get(row, "c_pos")),
      e_name: str(get(row, "e_name")),
      d_date: dd,
      n_date: str(get(row, "n_date")),
      in_time: normTime(get(row, "in_time")),
      out_time: normTime(get(row, "out_time")),
      over_time: toMinuteStr(get(row, "over_min")),
      night_time: null, // 조회 엑셀에 심야 컬럼 없음(출퇴근으로 자체 산정)
      total_time: toMinuteStr(get(row, "total_min")),
      allow_time: toMinuteStr(get(row, "allow_min")),
    });
  }

  return { records, sheetName, totalRows, skipped };
}
