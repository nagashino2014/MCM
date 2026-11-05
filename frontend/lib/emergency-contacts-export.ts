/**
 * 비상 연락망 내보내기 — 회사에서 쓰던 '사내 비상연락망' 엑셀 양식(소속 칸 병합·회색 머리글·총 인원 행, A4 세로 한 장 폭)에 맞춘다.
 * 소속 칸 병합과 전체 격자가 필요해 범용 표 내보내기(lib/export/table-document)를 쓰지 않는다.
 */
import { promises as fs } from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { emergencyHeadcount, groupEmergencyRows, type EmergencyContactRow } from "@/lib/emergency-contacts-rules";

const HEADERS = ["소속", "이름", "직책", "직급", "연락처", "직통번호", "이메일"];
const COL_CHARS = [19.5, 13.66, 15, 15, 18.66, 18.66, 25.5];
const FILL_HEADER = "FFD0CECE"; // 원본 머리글(테마 밝은 회색 -10%)
const BLANK = "-";

const cellValues = (r: EmergencyContactRow) => [
  r.name,
  r.title,
  r.positionName,
  r.mobilePhone || BLANK,
  r.directPhone || BLANK,
  r.email || BLANK,
];
const totalText = (n: number) => `${n}명`;

/** 파일 이름 — 원본 파일 관례 그대로 `사내 비상연락망(YY.MM.DD).확장자` (한국 시간). */
export function emergencyContactsFileName(format: "xlsx" | "pdf", now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000).toISOString();
  return `사내 비상연락망(${kst.slice(2, 4)}.${kst.slice(5, 7)}.${kst.slice(8, 10)}).${format}`;
}

export async function createEmergencyContactsWorkbook(rows: EmergencyContactRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MCM";
  const ws = wb.addWorksheet("비상연락망", {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    },
  });
  ws.columns = COL_CHARS.map((width) => ({ width }));
  // 긴 메일 주소가 잘리지 않게 이메일 열만 늘린다(인쇄는 페이지 폭 맞춤이 줄여 준다).
  ws.getColumn(7).width = Math.min(60, Math.max(COL_CHARS[6], ...rows.map((r) => r.email.length + 2)));

  const thin = { style: "thin", color: { argb: "FF000000" } } as const;
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const body = (cell: ExcelJS.Cell, horizontal: "center" | "left") => {
    cell.font = { name: "맑은 고딕", size: 11 };
    cell.alignment = { horizontal, vertical: "middle", wrapText: true };
    cell.border = border;
  };

  // 원본처럼 1행을 비우고 2행부터 표를 시작한다.
  const headerRow = ws.getRow(2);
  headerRow.height = 21.65;
  HEADERS.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = label;
    cell.font = { name: "맑은 고딕", size: 12, bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_HEADER } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = border;
  });

  let at = 3;
  for (const group of groupEmergencyRows(rows)) {
    const start = at;
    for (const r of group.rows) {
      const row = ws.getRow(at);
      row.height = 17;
      body(row.getCell(1), "center");
      cellValues(r).forEach((value, i) => {
        const cell = row.getCell(i + 2);
        cell.value = value;
        body(cell, i === 5 ? "left" : "center");
      });
      at += 1;
    }
    ws.getCell(start, 1).value = group.label;
    if (at - 1 > start) ws.mergeCells(start, 1, at - 1, 1);
  }

  const totalRow = ws.getRow(at);
  totalRow.height = 17;
  totalRow.getCell(1).value = "총 인원";
  body(totalRow.getCell(1), "center");
  for (let c = 2; c <= HEADERS.length; c++) body(totalRow.getCell(c), "left");
  totalRow.getCell(2).value = totalText(emergencyHeadcount(rows));
  ws.mergeCells(at, 2, at, HEADERS.length);

  ws.pageSetup.printArea = `A2:G${at}`;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ============================== PDF ============================== */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 18; // 원본 인쇄 여백 0.25in
const MARGIN_Y = 54; // 원본 인쇄 여백 0.75in
const HEADER_H = 22;
const ROW_H = 17;
const FONT_BODY = 9.5;
const FONT_HEAD = 10.5;
const FONT_MIN = 6;
const PAD_X = 3;
const LINE = 0.5;

export async function createEmergencyContactsPdf(rows: EmergencyContactRow[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const regular = await doc.embedFont(await fs.readFile(path.join(fontsDir, "malgun.ttf")), { subset: true });
  const bold = await doc.embedFont(await fs.readFile(path.join(fontsDir, "malgunbd.ttf")), { subset: true });
  const black = rgb(0, 0, 0);
  const headerFill = rgb(0.816, 0.808, 0.808);

  const tableW = PAGE_W - 2 * MARGIN_X;
  const unit = tableW / COL_CHARS.reduce((a, b) => a + b, 0);
  const widths = COL_CHARS.map((c) => c * unit);
  const xs: number[] = [];
  widths.reduce((x, w, i) => ((xs[i] = x), x + w), MARGIN_X);

  /** 칸 폭을 넘으면 글자 크기를 줄여 한 줄에 맞춘다(원본 셀 맞춤과 같은 효과). */
  const fitted = (text: string, font: PDFFont, size: number, width: number) => {
    let s = size;
    const room = width - 2 * PAD_X;
    while (s > FONT_MIN && font.widthOfTextAtSize(text, s) > room) s -= 0.25;
    return s;
  };
  const draw = (
    page: PDFPage,
    text: string,
    x: number,
    w: number,
    top: number,
    h: number,
    font: PDFFont,
    size: number,
    align: "center" | "left"
  ) => {
    if (!text) return;
    const s = fitted(text, font, size, w);
    const room = w - 2 * PAD_X;
    if (font.widthOfTextAtSize(text, s) > room) {
      // 가장 작은 글자로도 넘치면(아주 긴 메일 주소) 잘라 버리지 않고 두 줄로 적는다.
      let cut = text.length;
      while (cut > 1 && font.widthOfTextAtSize(text.slice(0, cut), s) > room) cut -= 1;
      [text.slice(0, cut), text.slice(cut)].forEach((line, i) => {
        page.drawText(line, { x: x + PAD_X, y: top - h / 2 + s * 0.2 - i * (s + 1), size: s, font, color: black, maxWidth: room });
      });
      return;
    }
    const tw = font.widthOfTextAtSize(text, s);
    page.drawText(text, {
      x: align === "center" ? x + (w - tw) / 2 : x + PAD_X,
      y: top - h / 2 - s * 0.36,
      size: s,
      font,
      color: black,
    });
  };
  const box = (page: PDFPage, x: number, top: number, w: number, h: number, fill?: typeof headerFill) => {
    page.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: black, borderWidth: LINE, color: fill });
  };

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN_Y;
  const drawHeader = () => {
    HEADERS.forEach((label, i) => {
      box(page, xs[i], y, widths[i], HEADER_H, headerFill);
      draw(page, label, xs[i], widths[i], y, HEADER_H, bold, FONT_HEAD, "center");
    });
    y -= HEADER_H;
  };
  const roomFor = () => Math.floor((y - MARGIN_Y) / ROW_H);
  drawHeader();

  for (const group of groupEmergencyRows(rows)) {
    let rest = group.rows;
    while (rest.length) {
      if (roomFor() < 1) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN_Y;
        drawHeader();
      }
      // 한 페이지에 들어가는 만큼 소속 칸을 병합하고, 넘치면 다음 페이지에서 소속을 다시 적는다.
      const chunk = rest.slice(0, roomFor());
      rest = rest.slice(chunk.length);
      const h = chunk.length * ROW_H;
      box(page, xs[0], y, widths[0], h);
      draw(page, group.label, xs[0], widths[0], y, h, regular, FONT_BODY, "center");
      for (const r of chunk) {
        cellValues(r).forEach((value, i) => {
          const col = i + 1;
          box(page, xs[col], y, widths[col], ROW_H);
          draw(page, value, xs[col], widths[col], y, ROW_H, regular, FONT_BODY, col === 6 ? "left" : "center");
        });
        y -= ROW_H;
      }
    }
  }

  if (roomFor() < 1) {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN_Y;
  }
  box(page, xs[0], y, widths[0], ROW_H);
  draw(page, "총 인원", xs[0], widths[0], y, ROW_H, regular, FONT_BODY, "center");
  box(page, xs[1], y, tableW - widths[0], ROW_H);
  draw(page, totalText(emergencyHeadcount(rows)), xs[1], tableW - widths[0], y, ROW_H, regular, FONT_BODY, "left");

  return doc.save();
}
