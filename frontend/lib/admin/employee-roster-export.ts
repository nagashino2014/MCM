/**
 * 직원 일람표 엑셀 — 회사 원본 '직원별 학력사항 및 자격증 보유 현황.xlsx'처럼 1명 1행, 경력·보유자격증은 2단 머리글로 묶는다.
 * 2단 머리글 병합이 필요해 범용 표 내보내기(lib/export/table-document)를 쓰지 않는다.
 */
import ExcelJS from "exceljs";
import { formatMonths } from "@/lib/admin/employee-roster-rules";
import type { EmployeeRoster, EmployeeRosterRow } from "@/lib/admin/employee-roster";

const TITLE = "직원별 학력사항 및 자격증 보유 현황";
const FILL_HEADER = "FFD9E1F2";
const FONT = "맑은 고딕";

interface Column {
  group?: string;
  label: string;
  width: number;
  align: "center" | "left" | "right";
  value: (r: EmployeeRosterRow, i: number) => string | number | null;
  numFmt?: string;
}

/** 파일 이름 — `직원 일람표(YY.MM.DD).xlsx` */
export function rosterFileName(asOf: string): string {
  return `직원 일람표(${asOf.slice(2, 4)}.${asOf.slice(5, 7)}.${asOf.slice(8, 10)}).xlsx`;
}

function columnsOf(roster: EmployeeRoster): Column[] {
  const hasResigned = roster.rows.some((r) => r.status === "inactive");
  const cols: Column[] = [
    { label: "연번", width: 6, align: "center", value: (_, i) => i + 1 },
    { label: "성명", width: 10, align: "center", value: (r) => r.name },
    { label: "소속", width: 18, align: "center", value: (r) => r.deptName },
    { label: "직위", width: 12, align: "center", value: (r) => r.positionName },
    { label: "생년월일", width: 12, align: "center", value: (r) => r.birthDate },
    { label: "연령", width: 7, align: "center", value: (r) => (r.age == null ? null : `${r.age}세`) },
    { label: "입사일", width: 12, align: "center", value: (r) => r.hiredAt },
    {
      label: "최종학력",
      width: 34,
      align: "left",
      value: (r) => (r.education ? [r.education.schoolName, r.education.major, r.education.degree].filter(Boolean).join(" ") : null),
    },
    { label: "졸업연도", width: 9, align: "center", value: (r) => r.education?.graduationYear ?? null },
    { group: "경력", label: "당사", width: 12, align: "center", value: (r) => formatMonths(r.careerCompanyMonths) },
    { group: "경력", label: "이전", width: 12, align: "center", value: (r) => formatMonths(r.careerPriorMonths) },
    { group: "경력", label: "합계", width: 12, align: "center", value: (r) => formatMonths(r.careerTotalMonths) },
    { label: "기술 등급", width: 9, align: "center", value: (r) => r.engGrade },
    { label: "대행 등급", width: 13, align: "center", value: (r) => r.envGrade },
    ...roster.certificationNames.map<Column>((name) => ({
      group: "보유 자격증",
      label: name,
      width: Math.max(11, name.length * 1.6),
      align: "center",
      value: (r) => (name in r.certifications ? r.certifications[name] || "보유" : null),
    })),
  ];
  if (roster.salaryVisible) {
    cols.push({ label: "연봉", width: 14, align: "right", value: (r) => r.annualSalary, numFmt: "#,##0" });
  }
  if (hasResigned) {
    cols.push({ label: "구분", width: 7, align: "center", value: (r) => (r.status === "inactive" ? "퇴사" : "재직") });
    cols.push({ label: "퇴사일", width: 12, align: "center", value: (r) => r.resignedAt });
  }
  return cols;
}

export async function createRosterWorkbook(roster: EmployeeRoster): Promise<Buffer> {
  const cols = columnsOf(roster);
  const wb = new ExcelJS.Workbook();
  wb.creator = "MCM";
  const ws = wb.addWorksheet("직원 일람표", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = cols.map((c) => ({ width: c.width }));

  const thin = { style: "thin", color: { argb: "FF000000" } } as const;
  const border = { top: thin, left: thin, bottom: thin, right: thin };

  // 1행 제목, 2행 기준일, 3·4행 머리글(묶음 없는 열은 위아래 병합).
  ws.mergeCells(1, 1, 1, cols.length);
  const title = ws.getCell(1, 1);
  title.value = TITLE;
  title.font = { name: FONT, size: 16, bold: true };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, cols.length);
  const asOf = ws.getCell(2, 1);
  asOf.value = `${roster.asOf.replace(/-/g, ".")}. 현재`;
  asOf.font = { name: FONT, size: 9 };
  asOf.alignment = { horizontal: "right" };

  const head = (cell: ExcelJS.Cell, value: string) => {
    cell.value = value;
    cell.font = { name: FONT, size: 10, bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_HEADER } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = border;
  };
  let c = 0;
  while (c < cols.length) {
    const group = cols[c].group;
    if (!group) {
      head(ws.getCell(3, c + 1), cols[c].label);
      head(ws.getCell(4, c + 1), cols[c].label);
      ws.mergeCells(3, c + 1, 4, c + 1);
      c += 1;
      continue;
    }
    let end = c;
    while (end + 1 < cols.length && cols[end + 1].group === group) end += 1;
    for (let k = c; k <= end; k++) {
      head(ws.getCell(3, k + 1), group);
      head(ws.getCell(4, k + 1), cols[k].label);
    }
    if (end > c) ws.mergeCells(3, c + 1, 3, end + 1);
    c = end + 1;
  }
  ws.getRow(4).height = 30;

  roster.rows.forEach((r, i) => {
    const row = ws.getRow(5 + i);
    cols.forEach((col, k) => {
      const cell = row.getCell(k + 1);
      const v = col.value(r, i);
      cell.value = v === "" ? null : v;
      cell.font = { name: FONT, size: 10 };
      cell.alignment = { horizontal: col.align, vertical: "middle", wrapText: col.align === "left" };
      cell.border = border;
      if (col.numFmt) cell.numFmt = col.numFmt;
    });
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
