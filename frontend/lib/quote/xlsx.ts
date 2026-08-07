// 견적서 xlsx 생성 — exceljs (2026-08-05 확정). 실물 양식 구조 재현(2차 피드백 반영):
// [갑지]=로고+주소 헤더 박스+첨부 목록+서명·인감, [총괄](사업장 4개↑), 사업장별 [견적서]=공급자
// 블록 표+브랜드 블루 강조, [별첨 1(,2)]=색상 강화+총계(직접인건비) 등급열 병합 중앙.
// xlsx 는 내부 보관·다운로드 전용(외부 발송은 PDF만 — 확정 사항 2).

import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { COMPANY_KO, COMPANY_CEO, COMPANY_ADDRESS, COMPANY_BIZ_NO, COMPANY_PHONE } from "@/lib/letter/types";
import {
  COMPANY_FAX,
  COMPANY_HOMEPAGE,
  DEFAULT_MD_GRADES,
  SUMMARY_SHEET_MIN_SITES,
  QUOTE_VALIDITY_TEXT,
  type QuoteFieldValues,
  type QuoteSite,
} from "./types";
import { gradeTotals, leafRows, laborCostOf, mdVectorTotal } from "./rates";
import { toHangulAmount } from "./hangul-amount";

const FONT = "맑은 고딕";
// 차분한 남색 계열(2026-08-05 사용자 확정 — 인쇄물 적합 딥 네이비 #1F3864 톤)
const BRAND = "FF1F3864";
const BRAND_DARK = "FF1F3864";
const HEAD_BG_HEX = "FFECF0F6"; // 연회청
const SOFT_BG_HEX = "FFF5F7FA";
const WHITE = "FFFFFFFF";

const THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

function fill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function f(size = 10, bold = false, colorArgb?: string): Partial<ExcelJS.Font> {
  return { name: FONT, size, bold, ...(colorArgb ? { color: { argb: colorArgb } } : {}) };
}

function setCell(
  ws: ExcelJS.Worksheet,
  addr: string,
  value: ExcelJS.CellValue,
  opts: {
    size?: number;
    bold?: boolean;
    align?: "left" | "center" | "right";
    border?: boolean;
    fill?: string; // argb
    color?: string; // argb
    numFmt?: string;
    wrap?: boolean;
  } = {}
): void {
  const c = ws.getCell(addr);
  c.value = value;
  c.font = f(opts.size ?? 10, opts.bold ?? false, opts.color);
  c.alignment = { vertical: "middle", horizontal: opts.align ?? "left", wrapText: opts.wrap ?? false };
  if (opts.border) c.border = THIN;
  if (opts.fill) c.fill = fill(opts.fill);
  if (opts.numFmt) c.numFmt = opts.numFmt;
}

function borderRange(ws: ExcelJS.Worksheet, top: number, left: number, bottom: number, right: number): void {
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      ws.getRow(r).getCell(c).border = THIN;
    }
  }
}

export interface QuoteXlsxInput {
  values: QuoteFieldValues;
  quoteNo: string;
  drafterName: string;
  issueDate: string; // YYYY-MM-DD
}

async function loadImageId(wb: ExcelJS.Workbook, rel: string): Promise<number | null> {
  try {
    const buffer = await readFile(path.join(process.cwd(), "public", rel));
    return wb.addImage({ buffer: buffer as unknown as ExcelJS.Buffer, extension: "png" });
  } catch {
    return null;
  }
}

/** 견적서 통합 xlsx 생성 → 바이트 */
export async function renderQuoteXlsx(input: QuoteXlsxInput): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY_KO;
  const sites = input.values.sites ?? [];
  const multi = sites.length > 1;
  // 로고 — 한글 표기 전용(quote/logo.png) 우선, 없으면 공문 로고 폴백(갑지에서 회사명 텍스트 보강)
  const quoteLogoId = await loadImageId(wb, "quote/logo.png");
  const letterLogoId = quoteLogoId == null ? await loadImageId(wb, "letter/logo.png") : null;
  const stampId = await loadImageId(wb, "letter/stamp.png");

  addCoverSheet(wb, input, quoteLogoId, letterLogoId, stampId);
  if (sites.length >= SUMMARY_SHEET_MIN_SITES) addSummarySheet(wb, input, stampId);
  for (const site of sites) {
    const quoteName = multi ? sheetName(site.siteLabel) : "견적서";
    const annexName = multi ? sheetName(`${site.siteLabel} 별첨 1`) : "별첨 1,2";
    addQuoteSheet(wb, quoteName, input, site, stampId);
    addAnnexSheet(wb, annexName, site);
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

function sheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "시트";
}

function fmtDateKo(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}년 ${m}월 ${d}일`;
}

// ── 갑지 ──
function addCoverSheet(wb: ExcelJS.Workbook, input: QuoteXlsxInput, quoteLogoId: number | null, letterLogoId: number | null, stampId: number | null): void {
  const ws = wb.addWorksheet("갑지", { pageSetup: { paperSize: 9, orientation: "portrait" }, views: [{ showGridLines: false }] });
  ws.columns = [{ width: 7 }, { width: 12 }, { width: 58 }, { width: 12 }, { width: 7 }]; // 좌우 여백 +30%(사용자 확정)
  const v = input.values;
  const sites = v.sites ?? [];
  const recipient = v.recipients[0];

  // 로고(중앙 상단) — 한글 표기 원본 로고(quote/logo.png)를 구 로고+회사명 영역 합 크기로
  const logoId = quoteLogoId ?? letterLogoId;
  if (logoId != null) {
    const size = quoteLogoId != null ? { width: 300, height: 140 } : { width: 210, height: 95 };
    ws.addImage(logoId, { tl: { col: 2.05, row: 0.3 }, ext: size, editAs: "absolute" });
  }
  for (let r = 1; r <= 6; r++) ws.getRow(r).height = 20;
  if (quoteLogoId == null) {
    setCell(ws, "C7", "(주)한국환경안전연구원", { size: 14, bold: true, align: "center" });
  }

  // 주소/전화/팩스 헤더 — 위아래 브랜드 라인(굵은 테두리)
  ws.mergeCells("A9:E9");
  setCell(ws, "A9", `${COMPANY_ADDRESS.replace(" (가산동, 에이스골드타워)", "")}, 에이스골드타워 12층 / Tel.${COMPANY_PHONE} / Fax:${COMPANY_FAX}`, {
    size: 9.5, // 좌우 여백 확대에 맞춰 축소 — 줄바뀜 방지(사용자 확정)
    bold: true,
    align: "center",
  });
  ws.getRow(9).height = 26;
  for (let c = 1; c <= 5; c++) {
    ws.getRow(9).getCell(c).border = {
      top: { style: "medium", color: { argb: BRAND } },
      bottom: { style: "medium", color: { argb: BRAND } },
    };
  }

  // 일자 위 구분선(용역명 하단과 동일 스타일 — 사용자 확정)
  for (let c = 1; c <= 5; c++) ws.getRow(11).getCell(c).border = { bottom: { style: "thin", color: { argb: "FFB8BFCC" } } };
  const recipientText = recipient ? [recipient.facilityName ?? recipient.name, recipient.deptName, recipient.title].filter(Boolean).join(" ") : "";
  setCell(ws, "C12", `일      자 : ${fmtDateKo(input.issueDate)}`, { size: 12 });
  setCell(ws, "C13", `수      신 : ${recipientText}`, { size: 12 });
  setCell(ws, "C14", `문서번호 : ${input.quoteNo}`, { size: 12 });
  setCell(ws, "C15", `용 역 명 : ${v.subject}`, { size: 12, bold: true });
  for (let c = 1; c <= 5; c++) ws.getRow(16).getCell(c).border = { bottom: { style: "thin", color: { argb: "FFB8BFCC" } } };
  setCell(ws, "C18", "1. 귀 사의 무궁한 발전을 기원합니다.", { size: 12 });
  setCell(ws, "C20", "2. 상기 제목과 관련하여 견적서를 첨부와 같이 제출합니다.", { size: 12 });

  // 첨부 목록 — 본문과의 간격 2배(사용자 확정: 행 23 → 26)
  let row = 26;
  if (sites.length > 1) {
    setCell(ws, `C${row}`, "첨부", { size: 11.5, bold: true });
    row++;
    const items: string[] = [];
    if (sites.length >= SUMMARY_SHEET_MIN_SITES) items.push(`${v.subject} 견적서(총괄)`);
    for (const s of sites) items.push(`${s.subjectLine} 견적서`);
    items.forEach((label, i) => {
      setCell(ws, `C${row}`, `  ${i + 1}. ${label} ${"-".repeat(Math.max(4, 56 - label.length * 2))} 1부`, { size: 11 });
      row++;
    });
    setCell(ws, `C${row}`, `별도첨부 : 직접인건비 산출기준, 인건비 및 제경비 등 단가 ${"-".repeat(14)} 1부 .  끝 .`, { size: 11 });
  } else {
    setCell(ws, `C${row}`, `첨부 : ${v.subject} 견적서 ${"-".repeat(Math.max(4, 48 - v.subject.length * 2))} 1부`, { size: 11 });
    setCell(ws, `C${row + 1}`, `별도첨부 : 직접인건비 산출기준, 인건비 및 제경비 등 단가 ${"-".repeat(14)} 1부 .  끝 .`, { size: 11 });
  }

  // 하단 서명 + 인감 — 회사명 붙여쓰기·-2pt, 대표이사 줄과 시작·끝 정렬(사용자 확정).
  // 엑셀은 자간 분배가 없어 균등 분할 정렬(distributed)로 두 줄 폭을 맞춘다.
  ws.mergeCells("C40:C40");
  const nameCell = ws.getCell("C40");
  nameCell.value = "㈜한국환경안전연구원";
  nameCell.font = f(14, true);
  nameCell.alignment = { vertical: "middle", horizontal: "distributed" };
  const ceoCell = ws.getCell("C41");
  ceoCell.value = `대 표 이 사        ${COMPANY_CEO.split("").join("   ")}`;
  ceoCell.font = f(12, true);
  ceoCell.alignment = { vertical: "middle", horizontal: "distributed" };
  ws.getRow(40).height = 24;
  ws.getRow(41).height = 24;
  if (stampId != null) {
    ws.addImage(stampId, { tl: { col: 3.1, row: 39.6 }, ext: { width: 58, height: 58 }, editAs: "absolute" });
  }
}

// ── 견적서 공통 골격(제목·수신·공급자 블록·견적조건·견적금액) ──
function addQuoteHead(
  ws: ExcelJS.Worksheet,
  input: QuoteXlsxInput,
  subjectLine: string,
  amount: number,
  recipientName: string,
  stampId: number | null
): number {
  const v = input.values;
  ws.columns = [
    { width: 5 }, { width: 20 }, { width: 14 }, { width: 12 }, { width: 11 },
    { width: 11 }, { width: 13 }, { width: 18 }, { width: 12 }, { width: 15 },
  ];
  ws.mergeCells("A1:J1");
  setCell(ws, "A1", "견   적   서", { size: 22, bold: true, align: "center" });
  ws.getRow(1).height = 36;
  ws.getRow(1).getCell(1).border = { bottom: { style: "medium", color: { argb: BRAND } } };
  for (let c = 2; c <= 10; c++) ws.getRow(1).getCell(c).border = { bottom: { style: "medium", color: { argb: BRAND } } };

  // 좌: 수신 블록 표(실물 양식 — 회사명/담당자 귀하/TEL/E-mail/아래와 같이 견적합니다/날짜, 행 라인)
  const contact = v.cc_refs?.[0];
  const recipient0 = v.recipients?.[0];
  const leftRows: { value: string; label?: string; bold?: boolean; underline?: boolean; size?: number }[] = [
    { value: recipientName, bold: true, underline: true, size: 12.5 },
    { value: contact ? `${[contact.name, contact.title].filter(Boolean).join(" ")} 귀하` : "귀하", size: 11 },
    { value: (recipient0?.phone ?? contact?.phone ?? "") || "-", label: "T E L :", size: 10 },
    { value: contact?.email ?? "-", label: "E·mail :", size: 10 },
    { value: "아래와 같이 견적합니다.", size: 10.5 },
    { value: fmtDateKo(input.issueDate), size: 10.5 },
  ];
  leftRows.forEach((lr, i) => {
    const rIdx = 3 + i;
    if (lr.label) {
      setCell(ws, `A${rIdx}`, lr.label, { size: 9, bold: true, align: "center" });
      ws.mergeCells(`B${rIdx}:E${rIdx}`);
      setCell(ws, `B${rIdx}`, lr.value, { size: lr.size, align: "center" });
    } else {
      ws.mergeCells(`A${rIdx}:E${rIdx}`);
      setCell(ws, `A${rIdx}`, lr.value, { size: lr.size, bold: lr.bold, align: "center" });
      if (lr.underline) ws.getCell(`A${rIdx}`).font = { ...f(lr.size ?? 11, true), underline: true };
    }
    for (let c = 1; c <= 5; c++) ws.getRow(rIdx).getCell(c).border = { bottom: { style: "thin", color: { argb: "FFB8BFCC" } } };
  });

  // 공급자 블록 F3:J8 — F열 세로 라벨
  ws.mergeCells("F3:F8");
  setCell(ws, "F3", "공\n급\n자", { size: 9, bold: true, align: "center", border: true, fill: HEAD_BG_HEX, color: BRAND_DARK, wrap: true });
  setCell(ws, "G3", "상    호", { size: 8.5, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK });
  ws.mergeCells("H3:J3");
  setCell(ws, "H3", COMPANY_KO, { size: 11, bold: true, border: true });
  setCell(ws, "G4", "소 재 지", { size: 8.5, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK });
  ws.mergeCells("H4:J4");
  setCell(ws, "H4", COMPANY_ADDRESS.replace(" (가산동, 에이스골드타워)", ", 에이스골드타워"), { size: 8.5, border: true, wrap: true });
  setCell(ws, "G5", "등록번호", { size: 8.5, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK });
  setCell(ws, "H5", COMPANY_BIZ_NO, { size: 9.5, border: true });
  setCell(ws, "I5", "대표이사", { size: 8.5, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK });
  setCell(ws, "J5", COMPANY_CEO.split("").join("  "), { size: 9.5, border: true, align: "center" });
  setCell(ws, "G6", "대표전화", { size: 8.5, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK });
  setCell(ws, "H6", COMPANY_PHONE, { size: 9.5, border: true });
  setCell(ws, "I6", "팩    스", { size: 8.5, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK });
  setCell(ws, "J6", COMPANY_FAX, { size: 9.5, border: true });
  setCell(ws, "G7", "담 당 자", { size: 8.5, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK });
  setCell(ws, "H7", input.drafterName, { size: 9.5, border: true });
  setCell(ws, "I7", "Mobile", { size: 8.5, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK });
  setCell(ws, "J7", v.contact_mobile ?? "", { size: 9.5, border: true });
  setCell(ws, "G8", "E-mail", { size: 8.5, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK });
  setCell(ws, "H8", v.contact_email ?? "", { size: 9, border: true });
  setCell(ws, "I8", "홈페이지", { size: 8.5, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK });
  setCell(ws, "J8", COMPANY_HOMEPAGE, { size: 9, border: true });
  borderRange(ws, 3, 6, 8, 10);
  // 공급자 블록 — 전 행 동일 높이(약간 여유) + 라벨 가운데 정렬(사용자 확정)
  for (let r = 3; r <= 8; r++) ws.getRow(r).height = 22;
  for (const addr of ["G3", "G4", "G5", "I5", "G6", "I6", "G7", "I7", "G8", "I8"]) {
    ws.getCell(addr).alignment = { vertical: "middle", horizontal: "center" };
  }
  // 인감 — 대표이사 셀 우측 오버레이(+20% 확대: 46→55)
  if (stampId != null) {
    ws.addImage(stampId, { tl: { col: 9.5, row: 3.9 }, ext: { width: 55, height: 55 }, editAs: "absolute" });
  }

  ws.mergeCells("A12:J12");
  setCell(ws, "A12", `건    명 : ${subjectLine}`, { size: 12.5, bold: true });

  // 견적 조건 — 타이틀 행 + 2행
  ws.mergeCells("A14:J14");
  setCell(ws, "A14", "견  적  조  건", { size: 10, bold: true, align: "center", border: true, fill: HEAD_BG_HEX, color: BRAND_DARK });
  setCell(ws, "A15", "결재조건", { size: 9, bold: true, border: true, fill: SOFT_BG_HEX, align: "center" });
  ws.mergeCells("B15:D15");
  setCell(ws, "B15", "계약조건에 따름", { size: 10, border: true, align: "center" });
  setCell(ws, "F15", "납품기한", { size: 9, bold: true, border: true, fill: SOFT_BG_HEX, align: "center" });
  ws.mergeCells("G15:J15");
  setCell(ws, "G15", "계약조건에 따름", { size: 10, border: true, align: "center" });
  setCell(ws, "A16", "납품장소", { size: 9, bold: true, border: true, fill: SOFT_BG_HEX, align: "center" });
  ws.mergeCells("B16:D16");
  setCell(ws, "B16", "-", { size: 10, border: true, align: "center" });
  setCell(ws, "F16", "유효기간", { size: 9, bold: true, border: true, fill: SOFT_BG_HEX, align: "center" });
  ws.mergeCells("G16:J16");
  setCell(ws, "G16", QUOTE_VALIDITY_TEXT, { size: 10, border: true, align: "center" });
  borderRange(ws, 14, 1, 16, 10);

  // 견적금액
  ws.mergeCells("A18:B18");
  setCell(ws, "A18", "견 적 금 액", { size: 12, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK, align: "center" });
  ws.mergeCells("C18:F18");
  setCell(ws, "C18", `一金 ${toHangulAmount(amount)} 원정`, { size: 12, bold: true, border: true, align: "center" });
  ws.mergeCells("G18:I18");
  setCell(ws, "G18", amount, { size: 12, bold: true, border: true, align: "right", numFmt: '"₩"#,##0' });
  setCell(ws, "J18", "(V.A.T별도)", { size: 9, border: true, align: "center" });
  borderRange(ws, 18, 1, 18, 10);
  ws.getRow(18).height = 26;
  return 20; // 다음 행
}

/** 품목표(공용) — items + 합계 + 최종견적금액(브랜드 강조) */
function addItemTable(
  ws: ExcelJS.Worksheet,
  startRow: number,
  items: { label: string; amount: number; note: string }[],
  finalAmount: number,
  finalNote: string
): number {
  let row = startRow;
  setCell(ws, `A${row}`, "NO", { size: 9, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK, align: "center" });
  ws.mergeCells(row, 2, row, 6);
  setCell(ws, `B${row}`, "품 명  및  내 용", { size: 9, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK, align: "center" });
  ws.mergeCells(row, 7, row, 9);
  setCell(ws, `G${row}`, "금   액(원)", { size: 9, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK, align: "center" });
  setCell(ws, `J${row}`, "비  고 (산정기준)", { size: 9, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK, align: "center" });
  borderRange(ws, row, 1, row, 10);
  row++;
  const firstItemRow = row;
  items.forEach((it, i) => {
    setCell(ws, `A${row}`, i + 1, { size: 10, border: true, align: "center" });
    ws.mergeCells(row, 2, row, 6);
    setCell(ws, `B${row}`, it.label, { size: 10, border: true, align: "center" });
    ws.mergeCells(row, 7, row, 9);
    setCell(ws, `G${row}`, it.amount, { size: 10, border: true, align: "right", numFmt: "#,##0" });
    setCell(ws, `J${row}`, it.note, { size: 8.5, border: true, align: "center", wrap: true });
    borderRange(ws, row, 1, row, 10);
    ws.getRow(row).height = 25;
    row++;
  });
  ws.mergeCells(row, 1, row, 6);
  setCell(ws, `A${row}`, "합 계 금 액", { size: 10.5, bold: true, border: true, fill: SOFT_BG_HEX, align: "center" });
  ws.mergeCells(row, 7, row, 9);
  setCell(ws, `G${row}`, { formula: `SUM(G${firstItemRow}:G${row - 1})` }, { size: 10.5, bold: true, border: true, fill: SOFT_BG_HEX, align: "right", numFmt: "#,##0" });
  setCell(ws, `J${row}`, "", { border: true, fill: SOFT_BG_HEX });
  borderRange(ws, row, 1, row, 10);
  ws.getRow(row).height = 24;
  row++;
  ws.mergeCells(row, 1, row, 6);
  setCell(ws, `A${row}`, "최 종 견 적 금 액", { size: 11.5, bold: true, border: true, fill: BRAND, color: WHITE, align: "center" });
  ws.mergeCells(row, 7, row, 9);
  setCell(ws, `G${row}`, finalAmount, { size: 11.5, bold: true, border: true, fill: BRAND, color: WHITE, align: "right", numFmt: "#,##0" });
  setCell(ws, `J${row}`, finalNote, { size: 9, border: true, fill: BRAND, color: WHITE, align: "center" });
  borderRange(ws, row, 1, row, 10);
  ws.getRow(row).height = 26;
  return row + 2;
}

function addRemarks(ws: ExcelJS.Worksheet, row: number, remarks: string): void {
  setCell(ws, `A${row}`, "<특이사항>", { size: 10, bold: true });
  const lines = (remarks ?? "").split(/\r?\n/).filter((l) => l.trim());
  ws.mergeCells(row + 1, 1, row + Math.max(1, lines.length), 10);
  setCell(ws, `A${row + 1}`, lines.join("\n"), { size: 9.5, wrap: true });
}

// ── 총괄 견적서 (사업장 4개 이상) ──
function addSummarySheet(wb: ExcelJS.Workbook, input: QuoteXlsxInput, stampId: number | null): void {
  const ws = wb.addWorksheet("총괄", { pageSetup: { paperSize: 9, orientation: "portrait" }, views: [{ showGridLines: false }] });
  const v = input.values;
  const total = v.sites.reduce((a, s) => a + (s.amounts.final || 0), 0);
  const recipient = v.recipients[0];
  const row = addQuoteHead(ws, input, v.subject, total, recipient?.facilityName ?? recipient?.name ?? "", stampId);
  const next = addItemTable(
    ws,
    row,
    v.sites.map((s, i) => ({ label: s.siteLabel, amount: s.amounts.final, note: `[첨 부 ${i + 1}]` })),
    total,
    ""
  );
  addRemarks(ws, next, v.sites[0]?.remarks ?? "");
}

// ── 사업장별 견적서 시트 ──
function addQuoteSheet(wb: ExcelJS.Workbook, name: string, input: QuoteXlsxInput, site: QuoteSite, stampId: number | null): void {
  const ws = wb.addWorksheet(name, { pageSetup: { paperSize: 9, orientation: "portrait" }, views: [{ showGridLines: false }] });
  const v = input.values;
  const recipient = v.recipients[0];
  const a = site.amounts;
  const row = addQuoteHead(ws, input, site.subjectLine, a.final, recipient?.facilityName ?? recipient?.name ?? "", stampId);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const items = site.freeItems?.length
    ? site.freeItems.map((it) => ({ label: it.label, amount: it.amount, note: it.note ?? "" }))
    : [
        { label: "직접인건비", amount: Math.round(a.laborCost), note: "[별첨 1] [별첨 2]" },
        { label: "제   경   비", amount: Math.round(a.overhead), note: `(직접인건비) × ${pct(site.rates.overheadRate)}` },
        { label: "기   술   료", amount: Math.round(a.techFee), note: `[직접인건비+제경비] × ${pct(site.rates.techFeeRate)}` },
        ...(a.directExpense > 0
          ? [{ label: "직 접 경 비", amount: Math.round(a.directExpense), note: `(직접인건비) × ${pct(site.rates.directExpenseRate)}` }]
          : []),
      ];
  const next = addItemTable(ws, row, items, a.final, "");
  addRemarks(ws, next, site.remarks);
}

// ── 별첨1(MD 산정) + 별첨2(단가표) 시트 ──
function addAnnexSheet(wb: ExcelJS.Workbook, name: string, site: QuoteSite): void {
  const ws = wb.addWorksheet(name, { pageSetup: { paperSize: 9, orientation: "portrait" }, views: [{ showGridLines: false }] });
  ws.columns = [
    { width: 44 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 10 },
  ];
  const rows = site.mdMatrix ?? [];
  const rates = site.rates;
  let row = 1;
  setCell(ws, `A${row}`, `[별첨 1] ${site.subjectLine} 직접인건비 산출기준`, { size: 12, bold: true });
  // 제목 밑줄 — 제목 길이보다 약간 길게(A~C 열, 사용자 확정)
  for (let c = 1; c <= 3; c++) ws.getRow(row).getCell(c).border = { bottom: { style: "medium", color: { argb: BRAND } } };
  row += 2;
  // 헤더
  const head = (addr: string, text: string) =>
    setCell(ws, addr, text, { size: 8.5, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK, align: "center", wrap: true });
  // 등급 축은 산정 당시 세트 스냅샷(가변, 143) — 등급 수에 따라 열 개수·비고 열 위치가 움직인다
  const grades = rates.grades?.length ? rates.grades : DEFAULT_MD_GRADES;
  const gcol = (i: number) => String.fromCharCode(66 + i); // B, C, D, ...
  const noteCol = String.fromCharCode(66 + grades.length);
  head(`A${row}`, "항   목");
  grades.forEach((g, i) => head(`${gcol(i)}${row}`, i === 0 && g === "특급" ? "기술사(MD) or\n특급기술자(MD)" : `${g}기술자(MD)`));
  head(`${noteCol}${row}`, "비고");
  ws.getRow(row).height = 26;
  row++;
  const parentIds = new Set(rows.map((r) => r.parentId).filter(Boolean));
  for (const r of rows) {
    const isParent = parentIds.has(r.itemId);
    const bg = isParent ? SOFT_BG_HEX : undefined;
    setCell(ws, `A${row}`, (r.parentId ? "  " : "") + r.label, { size: 9.5, bold: isParent, border: true, fill: bg });
    grades.forEach((g, gi) => {
      setCell(ws, `${gcol(gi)}${row}`, r.md[g] ?? 0, { size: 9.5, bold: isParent, border: true, fill: bg, align: "center", numFmt: "0.###" });
    });
    setCell(ws, `${noteCol}${row}`, "-", { size: 9, border: true, fill: bg, align: "center" });
    row++;
  }
  // 총계(MD) — 비고열은 합계 수치만('계' 제거, 사용자 확정)
  const totals = gradeTotals(rows);
  setCell(ws, `A${row}`, "총   계(MD)", { size: 10, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK, align: "center" });
  grades.forEach((g, gi) => {
    setCell(ws, `${gcol(gi)}${row}`, totals[g] ?? 0, { size: 10, bold: true, border: true, fill: HEAD_BG_HEX, align: "center", numFmt: "0.###" });
  });
  setCell(ws, `${noteCol}${row}`, mdVectorTotal(totals), { size: 9.5, bold: true, border: true, fill: HEAD_BG_HEX, color: BRAND_DARK, align: "center", numFmt: "0.###" });
  row++;
  // 소계(직접인건비)
  setCell(ws, `A${row}`, "소   계(직접인건비)", { size: 10, bold: true, border: true, align: "center" });
  grades.forEach((g, gi) => {
    setCell(ws, `${gcol(gi)}${row}`, Math.round((totals[g] ?? 0) * (rates.laborRates[g] ?? 0)), { size: 9.5, border: true, align: "right", numFmt: "#,##0" });
  });
  setCell(ws, `${noteCol}${row}`, "-", { size: 9, border: true, align: "center" });
  row++;
  // 총계(직접인건비) — 등급 4개 열 병합·가운데(사용자 확정) + 브랜드 강조
  const totalLabor = leafRows(rows).reduce((acc, r) => acc + laborCostOf(r.md, rates.laborRates), 0);
  setCell(ws, `A${row}`, "총   계(직접인건비)", { size: 10.5, bold: true, border: true, fill: BRAND, color: WHITE, align: "center" });
  ws.mergeCells(row, 2, row, 1 + grades.length); // 등급 열 전체 병합(개수 가변)
  setCell(ws, `B${row}`, Math.round(totalLabor), { size: 10.5, bold: true, border: true, fill: BRAND, color: WHITE, align: "center", numFmt: '#,##0 "원"' });
  setCell(ws, `${noteCol}${row}`, "-", { size: 9, border: true, fill: BRAND, color: WHITE, align: "center" });
  ws.getRow(row).height = 24;
  row += 3;

  // 별첨 2 — 인건비 및 제경비 등 단가
  setCell(ws, `A${row}`, "[별첨 2] 인건비 및 제경비 등 단가", { size: 12, bold: true });
  ws.getRow(row).getCell(1).border = { bottom: { style: "medium", color: { argb: BRAND } } }; // 제목보다 약간 긴 A열 폭
  row += 2;
  head(`A${row}`, "분야");
  head(`B${row}`, "구분");
  head(`C${row}`, "단위 및 규격");
  head(`D${row}`, "금액");
  ws.mergeCells(row, 5, row, 6);
  head(`E${row}`, "비고");
  borderRange(ws, row, 1, row, 6);
  row++;

  // 그룹 렌더 — 분야(A)·비고(E:F)는 그룹 세로 병합(사용자 확정 — 실물 셀 병합 재현)
  const renderGroup = (groupLabel: string, note: string, body: { c1: string; c2: string; c3: string | number; numFmt?: string; align?: "right" | "center" }[]) => {
    const start = row;
    for (const b of body) {
      setCell(ws, `B${row}`, b.c1, { size: 9.5, border: true, align: "center" });
      setCell(ws, `C${row}`, b.c2, { size: 9, border: true, align: "center" });
      setCell(ws, `D${row}`, b.c3, { size: 9.5, border: true, align: b.align ?? "right", numFmt: b.numFmt });
      borderRange(ws, row, 1, row, 6);
      row++;
    }
    ws.mergeCells(start, 1, row - 1, 1);
    setCell(ws, `A${start}`, groupLabel, { size: 9, bold: true, border: true, fill: SOFT_BG_HEX, color: BRAND_DARK, align: "center", wrap: true });
    ws.mergeCells(start, 5, row - 1, 6);
    setCell(ws, `E${start}`, note, { size: 8.5, border: true, wrap: true });
    borderRange(ws, start, 1, row - 1, 6);
  };

  const laborGrades: { grade: string; label: string }[] = [
    { grade: "기술사", label: "기술사" },
    { grade: "특급", label: "특급기술자" },
    { grade: "고급", label: "고급기술자" },
    { grade: "중급", label: "중급기술자" },
    { grade: "초급", label: "초급기술자" },
  ];
  renderGroup(
    "엔지니어링\n기술자\n노임단가",
    `엔지니어링 노임단가 환경부문 적용\n[적용일 : ${rates.laborYear}. 1. 1부터]`,
    laborGrades
      .filter(({ grade }) => rates.laborRates[grade] != null)
      .map(({ grade, label }) => ({ c1: label, c2: "원/일", c3: rates.laborRates[grade], numFmt: "#,##0" }))
  );
  renderGroup(
    rates.directExpenseRate > 0 ? "직접경비,\n제경비\n및 기술료" : "제경비\n및 기술료",
    "엔지니어링 사업대가의 기준\n[산업통상자원부 고시]",
    [
      ...(rates.directExpenseRate > 0
        ? [{ c1: "직접경비", c2: "상주 인원 인건비 대비", c3: `${Math.round(rates.directExpenseRate * 100)}% 적용`, align: "center" as const }]
        : []),
      { c1: "제경비", c2: "인건비의 110~120%", c3: `${Math.round(rates.overheadRate * 100)}% 적용`, align: "center" as const },
      { c1: "기술료", c2: "인건비+제경비의 20~40%", c3: `${Math.round(rates.techFeeRate * 100)}% 적용`, align: "center" as const },
    ]
  );
}
