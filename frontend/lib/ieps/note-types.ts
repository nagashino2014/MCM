// 어음 발행/만기 총괄 현황 — 클라이언트 공용 타입·기간 계산·필터.
// DB 조회는 note-status.ts(서버 전용)에 있다(수금 현황의 collections-types/-filter/-status 분리와 동일 구조).

export interface ContractNoteRow {
  contractId: string;
  milestoneId: string;
  contractTitle: string;
  counterpartyName: string;
  stageLabel: string;
  contractDate: string | null;
  paymentMethod: string | null;
  /** 청구(발행) 금액 — 공급가액. 어음 액면은 통상 VAT 포함이라 표시부에서 ×1.1 병기한다. */
  amount: number;
  invoiceIssuedAt: string | null;
  collected: boolean;
  collectedAt: string | null;
  collectedAmount: number;
  noteKind: string | null;
  noteBank: string | null;
  noteIssuedDate: string | null;
  noteMaturityDate: string | null;
  noteFee: number | null;
  noteLoanInterestAmount: number | null;
  noteLoanExecutedDate: string | null;
}

export interface ContractNoteStatus {
  rows: ContractNoteRow[];
}

/** 어음 발행일 기준일 — 미입력 건은 계산서 발행일로 폴백한다(화면·엑셀에 폴백 규칙 명시). */
export const noteIssuedBasisDate = (row: ContractNoteRow): string | null =>
  row.noteIssuedDate ?? row.invoiceIssuedAt;

export type NotePeriodUnit = "year" | "half" | "quarter" | "month";

export const NOTE_PERIOD_UNITS: Array<{ unit: NotePeriodUnit; label: string }> = [
  { unit: "year", label: "연간" },
  { unit: "half", label: "반기" },
  { unit: "quarter", label: "분기" },
  { unit: "month", label: "월" },
];

/** 단위별 세부 기간 선택지 — seq 는 1부터(반기 1~2, 분기 1~4, 월 1~12, 연간 1 고정). */
export function notePeriodOptions(unit: NotePeriodUnit): Array<{ seq: number; label: string }> {
  if (unit === "year") return [{ seq: 1, label: "1년 전체" }];
  if (unit === "half") return [{ seq: 1, label: "상반기" }, { seq: 2, label: "하반기" }];
  if (unit === "quarter") return [1, 2, 3, 4].map((q) => ({ seq: q, label: `${q}분기` }));
  return Array.from({ length: 12 }, (_, i) => ({ seq: i + 1, label: `${i + 1}월` }));
}

/** (연도, 단위, 세부기간) → [from, to] (YYYY-MM-DD, 양끝 포함) + 라벨. 잘못된 입력은 연간으로 접는다. */
export function notePeriodRange(
  year: number,
  unit: NotePeriodUnit,
  seq: number
): { from: string; to: string; label: string } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v) || lo));
  const y = clamp(year, 2000, 2100);
  const lastDay = (m: number) => new Date(y, m, 0).getDate(); // m: 1~12
  const fmt = (m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (unit === "half") {
    const h = clamp(seq, 1, 2);
    const fromM = h === 1 ? 1 : 7;
    const toM = h === 1 ? 6 : 12;
    return { from: fmt(fromM, 1), to: fmt(toM, lastDay(toM)), label: `${y}년 ${h === 1 ? "상반기" : "하반기"}` };
  }
  if (unit === "quarter") {
    const q = clamp(seq, 1, 4);
    const fromM = (q - 1) * 3 + 1;
    const toM = q * 3;
    return { from: fmt(fromM, 1), to: fmt(toM, lastDay(toM)), label: `${y}년 ${q}분기` };
  }
  if (unit === "month") {
    const m = clamp(seq, 1, 12);
    return { from: fmt(m, 1), to: fmt(m, lastDay(m)), label: `${y}년 ${m}월` };
  }
  return { from: fmt(1, 1), to: fmt(12, 31), label: `${y}년` };
}

export type NoteBasis = "issued" | "maturity";

/** 기간 필터 — basis=issued 는 어음 발행일(미입력 시 계산서 발행일), maturity 는 만기일 기준. */
export function filterNoteRows(
  rows: ContractNoteRow[],
  basis: NoteBasis,
  from: string,
  to: string
): ContractNoteRow[] {
  return rows.filter((row) => {
    const date = basis === "issued" ? noteIssuedBasisDate(row) : row.noteMaturityDate;
    return Boolean(date && date >= from && date <= to);
  });
}
