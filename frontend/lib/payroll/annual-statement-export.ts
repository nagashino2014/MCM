import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { COMPANY_KO, COMPANY_CEO } from "@/lib/letter/types";
import { serviceLabel, type AnnualStatement } from "@/lib/payroll/annual-statement";

/*
 * 연간 급여 명세서 내보내기(엑셀·PDF) — 직원별 연간 탭.
 * 구성: 제목 + 인적사항 → 항목×월 표(지급·공제·차인) → 퇴직금 적립 행 → 퇴직금 추계 표 → 산정 근거 → 발급일·회사명·직인.
 * PDF 는 급여명세서(statement-pdf.ts) 관례(자간 제목·이중선·음영 라벨 격자·직인)를 A4 가로 한 장에 맞춘다.
 */

interface TableRow {
  label: string;
  values: Array<number | null>;
  total: number;
  style: "section" | "item" | "subtotal" | "net" | "accrual";
}

const KIND_SECTION = { pay: "지급 내역", deduction: "공제 내역" } as const;

function koDate(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[1]}.${m[2]}.${m[3]}` : iso ?? "-";
}

function todayKst(): { iso: string; ko: string } {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return {
    iso: d.toISOString().slice(0, 10),
    ko: `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`,
  };
}

function won(v: number): string {
  return Math.round(v).toLocaleString("ko-KR");
}

/** 표 본문 행 — 화면 표와 같은 순서(지급 항목 → 지급합계 → 공제 항목 → 공제합계 → 차인지급액 → 퇴직금 적립) */
function tableRows(s: AnnualStatement): TableRow[] {
  const rows: TableRow[] = [];
  for (const kind of ["pay", "deduction"] as const) {
    rows.push({ label: KIND_SECTION[kind], values: [], total: 0, style: "section" });
    for (const i of s.items.filter((x) => x.kind === kind)) {
      rows.push({ label: i.name, values: s.months.map((m) => i.amounts[m] ?? null), total: i.total, style: "item" });
    }
    const key = kind === "pay" ? "pay" : "ded";
    const vals = s.months.map((m) => s.monthTotals[m]?.[key] ?? 0);
    rows.push({ label: kind === "pay" ? "지급합계" : "공제합계", values: vals, total: vals.reduce((a, b) => a + b, 0), style: "subtotal" });
  }
  const net = s.months.map((m) => s.monthTotals[m]?.net ?? 0);
  rows.push({ label: "차인지급액", values: net, total: net.reduce((a, b) => a + b, 0), style: "net" });
  rows.push({ label: "퇴직금 적립", values: [], total: 0, style: "section" });
  rows.push({
    label: "퇴직금 적립액(월 임금 ÷ 12)",
    values: s.months.map((m) => s.severance.accrual[m] ?? 0),
    total: s.severance.accrualTotal,
    style: "accrual",
  });
  return rows;
}

/** 퇴직금 추계 — 라벨/값 4열 격자(3행) */
function severanceGrid(s: AnnualStatement): Array<[string, string, string, string]> {
  const v = s.severance;
  return [
    [`산정 ${v.referenceLabel}`, koDate(v.referenceDate), "평균임금 산정 기간", v.windowLabel ? `${v.windowLabel} (${v.windowDays}일)` : "-"],
    ["3개월 임금총액", `${won(v.wage3m)} 원`, "상여·연차수당 가산(3/12)", `${won(v.bonusAdd + v.leaveAdd)} 원`],
    ["1일 평균임금", `${v.avgDailyWage.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} 원`, "재직일수", serviceLabel(v.serviceDays)],
  ];
}

function severanceNotes(s: AnnualStatement): string[] {
  const v = s.severance;
  const notes = [
    "퇴직금 = 1일 평균임금 × 30일 × 재직일수 ÷ 365 (근로자퇴직급여 보장법 제8조). 계속근로 1년 이상 퇴직 시 지급 대상입니다.",
    "1일 평균임금 = (기준일 이전 3개월 임금총액 + 직전 1년 상여·연차수당 × 3/12) ÷ 3개월 일수. 실비변상(정산 경비·출장수당·출장숙박수당) 제외.",
    "적립액은 매월 임금총액의 1/12 입니다. 급여대장 월 단위 추계이므로 실제 지급액은 퇴사일 기준 일할·통상임금 비교로 확정합니다.",
    ...v.notes,
  ];
  if (v.settled?.amount != null) {
    notes.push(`재무 퇴직 정산 확정 퇴직금: ${won(v.settled.amount)} 원 (${v.settled.status === "confirmed" ? "정산 완료" : "작성 중"}).`);
  }
  return notes;
}

function estimateText(s: AnnualStatement): string {
  const v = s.severance;
  if (v.estimate == null) return "산정 불가";
  return `${won(v.estimate)} 원${v.eligible ? "" : " (1년 미만 — 지급 대상 아님)"}`;
}

export function annualStatementFileName(s: AnnualStatement, ext: "xlsx" | "pdf"): string {
  return encodeURIComponent(`${s.year}년_연간급여명세서_${s.profile.name}.${ext}`);
}

/* ================================================================ XLSX */

export async function buildAnnualStatementXlsx(s: AnnualStatement): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY_KO;
  const ws = wb.addWorksheet("연간 급여 명세서", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false }],
  });
  const nMonths = s.months.length;
  const lastCol = 2 + nMonths; // A=항목, B..=월, 마지막=연간 합계
  const wideCol = Math.max(lastCol, 8); // 제목·인적사항·추계 블록 폭(월이 적은 해에도 칸이 모자라지 않게)
  ws.getColumn(1).width = 26;
  for (let c = 2; c <= wideCol; c++) ws.getColumn(c).width = 12.5;
  ws.getColumn(lastCol).width = 14;

  const thin: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FF8C8C96" } }, left: { style: "thin", color: { argb: "FF8C8C96" } },
    bottom: { style: "thin", color: { argb: "FF8C8C96" } }, right: { style: "thin", color: { argb: "FF8C8C96" } },
  };
  const shade: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F2F6" } };
  const strong: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3E8F8" } };
  const font = (bold = false, size = 10): Partial<ExcelJS.Font> => ({ name: "맑은 고딕", bold, size });

  // 제목 + 이중선
  ws.mergeCells(1, 1, 1, wideCol);
  const title = ws.getCell(1, 1);
  title.value = `${s.year}년 연간 급여 명세서`;
  title.font = font(true, 16);
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.border = { bottom: { style: "double", color: { argb: "FF1A1A1F" } } };
  ws.getRow(1).height = 34;
  for (let c = 2; c <= wideCol; c++) ws.getCell(1, c).border = { bottom: { style: "double", color: { argb: "FF1A1A1F" } } };

  // 인적사항(라벨·값 4쌍 × 2행) — 열이 부족하면 값 셀을 병합해 맞춘다
  const p = s.profile;
  const info: Array<Array<[string, string]>> = [
    [["성명", p.name], ["사번", p.empNo ?? "-"], ["소속", p.deptName ?? "-"], ["직급", p.positionName ?? "-"]],
    [["입사일", koDate(p.hiredAt)], ["퇴사일", p.resignedAt ? koDate(p.resignedAt) : "재직"], ["귀속 연도", `${s.year}년`], ["발급일", koDate(todayKst().iso)]],
  ];
  const span = Math.floor(wideCol / 4); // 쌍당 열 수(2 이상)
  let r = 3;
  for (const row of info) {
    row.forEach(([label, value], i) => {
      const c0 = 1 + i * span;
      const c1 = i === 3 ? wideCol : c0 + span - 1;
      const lc = ws.getCell(r, c0);
      lc.value = label;
      lc.font = font(true);
      lc.fill = shade;
      lc.alignment = { horizontal: "center", vertical: "middle" };
      lc.border = thin;
      if (c1 > c0 + 1) ws.mergeCells(r, c0 + 1, r, c1);
      const vc = ws.getCell(r, c0 + 1);
      vc.value = value;
      vc.font = font();
      vc.alignment = { horizontal: "center", vertical: "middle" };
      for (let c = c0 + 1; c <= c1; c++) ws.getCell(r, c).border = thin;
    });
    ws.getRow(r).height = 20;
    r++;
  }
  r++;

  // 본문 표
  const head = ws.getRow(r);
  head.values = ["항목", ...s.months.map((m) => `${m}월`), "연간 합계"];
  head.height = 22;
  for (let c = 1; c <= lastCol; c++) {
    const cell = ws.getCell(r, c);
    cell.font = font(true);
    cell.fill = shade;
    cell.border = thin;
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }
  r++;
  for (const row of tableRows(s)) {
    if (row.style === "section") {
      ws.mergeCells(r, 1, r, lastCol);
      const cell = ws.getCell(r, 1);
      cell.value = row.label;
      cell.font = font(true, 10);
      cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      for (let c = 1; c <= lastCol; c++) ws.getCell(r, c).border = thin;
      ws.getRow(r).height = 18;
      r++;
      continue;
    }
    const xr = ws.getRow(r);
    xr.values = [row.style === "item" ? `  ${row.label}` : row.label, ...row.values.map((v) => (v ? Math.round(v) : null)), Math.round(row.total)];
    xr.height = 18;
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getCell(r, c);
      cell.border = thin;
      cell.font = font(row.style !== "item" || c === lastCol);
      if (c > 1) {
        cell.numFmt = "#,##0";
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }
      if (row.style === "subtotal" || row.style === "accrual") cell.fill = shade;
      if (row.style === "net") cell.fill = strong;
    }
    r++;
  }
  r++;

  // 퇴직금 추계
  ws.getCell(r, 1).value = "퇴직금 추계";
  ws.getCell(r, 1).font = font(true, 11);
  r++;
  const half = Math.floor(wideCol / 2);
  const gridRows: Array<[string, string, string, string]> = [
    ...severanceGrid(s),
    ["추계 퇴직금", estimateText(s), "올해 적립액 합계", `${won(s.severance.accrualTotal)} 원`],
  ];
  gridRows.forEach((g, gi) => {
    const pairs: Array<[number, number]> = [[1, half], [half + 1, wideCol]];
    pairs.forEach(([c0, c1], pi) => {
      const lc = ws.getCell(r, c0);
      lc.value = g[pi * 2];
      lc.font = font(true);
      lc.fill = shade;
      lc.border = thin;
      lc.alignment = { horizontal: "center", vertical: "middle" };
      if (c1 > c0 + 1) ws.mergeCells(r, c0 + 1, r, c1);
      const vc = ws.getCell(r, c0 + 1);
      vc.value = g[pi * 2 + 1];
      vc.font = font(gi === gridRows.length - 1);
      vc.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
      if (gi === gridRows.length - 1) vc.fill = strong;
      for (let c = c0 + 1; c <= c1; c++) ws.getCell(r, c).border = thin;
    });
    ws.getRow(r).height = 20;
    r++;
  });
  r++;
  for (const n of severanceNotes(s)) {
    ws.mergeCells(r, 1, r, wideCol);
    const cell = ws.getCell(r, 1);
    cell.value = `· ${n}`;
    cell.font = { ...font(false, 9), color: { argb: "FF4A4A52" } };
    cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    ws.getRow(r).height = 16;
    r++;
  }
  r++;
  ws.mergeCells(r, 1, r, wideCol);
  const sig = ws.getCell(r, 1);
  sig.value = `${todayKst().ko}    ${COMPANY_KO}  대표이사  ${COMPANY_CEO}`;
  sig.font = font(true, 11);
  sig.alignment = { horizontal: "right", vertical: "middle" };

  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 0, showGridLines: false }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ================================================================ PDF (A4 가로 한 장) */

const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN_X = 34;
const TABLE_W = PAGE_W - MARGIN_X * 2;
const INK = rgb(0.1, 0.1, 0.12);
const LINE = rgb(0.45, 0.45, 0.5);
const SHADE = rgb(0.945, 0.95, 0.965);
const STRONG = rgb(0.89, 0.91, 0.97);
const FAINT = rgb(0.3, 0.3, 0.34);

let fontCache: { regular: Buffer; bold: Buffer } | null = null;
let stampCache: Buffer | null | undefined;

async function loadFonts() {
  if (fontCache) return fontCache;
  const dir = path.join(process.cwd(), "public", "fonts");
  fontCache = { regular: await readFile(path.join(dir, "malgun.ttf")), bold: await readFile(path.join(dir, "malgunbd.ttf")) };
  return fontCache;
}

async function loadStamp(): Promise<Buffer | null> {
  if (stampCache !== undefined) return stampCache;
  try {
    stampCache = await readFile(path.join(process.cwd(), "public", "letter", "stamp.png"));
  } catch {
    stampCache = null;
  }
  return stampCache;
}

function fitSize(text: string, font: PDFFont, maxWidth: number, base: number, min: number): number {
  let size = base;
  while (size > min && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.25;
  return size;
}

function cellText(page: PDFPage, text: string, font: PDFFont, x: number, w: number, top: number, h: number,
  align: "left" | "center" | "right", size: number) {
  if (!text) return;
  const pad = 4;
  const s = fitSize(text, font, w - pad * 2, size, 5.5);
  const tw = font.widthOfTextAtSize(text, s);
  const tx = align === "center" ? x + (w - tw) / 2 : align === "right" ? x + w - pad - tw : x + pad;
  page.drawText(text, { x: tx, y: top - h / 2 - s * 0.34, size: s, font, color: INK });
}

function box(page: PDFPage, x: number, top: number, w: number, h: number, fill?: ReturnType<typeof rgb>) {
  if (fill) page.drawRectangle({ x, y: top - h, width: w, height: h, color: fill });
  page.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: LINE, borderWidth: 0.5 });
}

function outline(page: PDFPage, x: number, top: number, w: number, h: number) {
  page.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: INK, borderWidth: 1.1 });
}

function spacedTitle(page: PDFPage, text: string, font: PDFFont, size: number, y: number, spacing: number) {
  const chars = [...text];
  const widths = chars.map((c) => font.widthOfTextAtSize(c, size));
  let x = MARGIN_X + (TABLE_W - (widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1))) / 2;
  chars.forEach((c, i) => {
    page.drawText(c, { x, y, size, font, color: INK });
    x += widths[i] + spacing;
  });
}

export async function renderAnnualStatementPdf(s: AnnualStatement): Promise<Uint8Array> {
  const fontBytes = await loadFonts();
  const stampBytes = await loadStamp();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fontBytes.regular, { subset: true });
  const bold = await doc.embedFont(fontBytes.bold, { subset: true });
  let stamp: PDFImage | null = null;
  if (stampBytes) stamp = await doc.embedPng(stampBytes);
  doc.setTitle(`${s.year}년 연간 급여 명세서 — ${s.profile.name}`);
  const page = doc.addPage([PAGE_W, PAGE_H]);

  // ── 제목 + 이중선 ──
  let y = PAGE_H - 46;
  spacedTitle(page, `${s.year}년 연간 급여 명세서`, bold, 17, y, 2);
  y -= 12;
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 1.4, color: INK });
  page.drawLine({ start: { x: MARGIN_X, y: y - 2.6 }, end: { x: PAGE_W - MARGIN_X, y: y - 2.6 }, thickness: 0.5, color: INK });
  y -= 14;

  // ── 인적사항 1행(8칸) ──
  {
    const p = s.profile;
    const cells: Array<[string, string]> = [
      ["성명", p.name], ["사번", p.empNo ?? "-"], ["소속", p.deptName ?? "-"], ["직급", p.positionName ?? "-"],
      ["입사일", koDate(p.hiredAt)], ["퇴사일", p.resignedAt ? koDate(p.resignedAt) : "재직"],
    ];
    const h = 18;
    const lw = 42;
    const vw = (TABLE_W - lw * cells.length) / cells.length;
    let x = MARGIN_X;
    for (const [label, value] of cells) {
      box(page, x, y, lw, h, SHADE);
      cellText(page, label, bold, x, lw, y, h, "center", 8.5);
      box(page, x + lw, y, vw, h);
      cellText(page, value, regular, x + lw, vw, y, h, "center", 8.5);
      x += lw + vw;
    }
    outline(page, MARGIN_X, y, TABLE_W, h);
    y -= h + 8;
  }

  // ── 하단 고정 블록 높이(추계 표 4행 + 근거 + 서명) 예약 후 본문 행 높이 결정 ──
  const notes = severanceNotes(s);
  const SEV_ROW = 15;
  const NOTE_LINE = 10;
  const SIG_H = 30;
  const reserved = 14 + SEV_ROW * 4 + 6 + notes.length * NOTE_LINE + 6 + SIG_H;
  const rows = tableRows(s);
  const HEAD_H = 17;
  const avail = y - 30 - reserved - HEAD_H;
  const rowH = Math.max(9.5, Math.min(15, avail / rows.length));
  const fs = Math.min(8, rowH * 0.58);

  // ── 본문 표 ──
  {
    const labelW = 128;
    const totalW = 70;
    const mw = (TABLE_W - labelW - totalW) / Math.max(1, s.months.length);
    const xs = [MARGIN_X, MARGIN_X + labelW, ...s.months.map((_, i) => MARGIN_X + labelW + mw * (i + 1))];
    xs.push(MARGIN_X + TABLE_W);
    const top = y;
    // 헤더
    const heads = ["항목", ...s.months.map((m) => `${m}월`), "연간 합계"];
    heads.forEach((h, i) => {
      box(page, xs[i], y, xs[i + 1] - xs[i], HEAD_H, SHADE);
      cellText(page, h, bold, xs[i], xs[i + 1] - xs[i], y, HEAD_H, "center", 8.5);
    });
    y -= HEAD_H;
    for (const row of rows) {
      if (row.style === "section") {
        box(page, MARGIN_X, y, TABLE_W, rowH);
        cellText(page, row.label, bold, MARGIN_X, labelW, y, rowH, "left", fs);
        y -= rowH;
        continue;
      }
      const fill = row.style === "net" ? STRONG : row.style === "item" ? undefined : SHADE;
      const f = row.style === "item" ? regular : bold;
      box(page, xs[0], y, xs[1] - xs[0], rowH, fill);
      cellText(page, row.style === "item" ? `  ${row.label}` : row.label, f, xs[0], xs[1] - xs[0], y, rowH, "left", fs);
      row.values.forEach((v, i) => {
        box(page, xs[i + 1], y, xs[i + 2] - xs[i + 1], rowH, fill);
        cellText(page, v ? won(v) : "", f, xs[i + 1], xs[i + 2] - xs[i + 1], y, rowH, "right", fs);
      });
      const li = xs.length - 2;
      box(page, xs[li], y, xs[li + 1] - xs[li], rowH, fill);
      cellText(page, won(row.total), bold, xs[li], xs[li + 1] - xs[li], y, rowH, "right", fs);
      y -= rowH;
    }
    outline(page, MARGIN_X, top, TABLE_W, top - y);
    y -= 12;
  }

  // ── 퇴직금 추계 표 ──
  {
    page.drawText("퇴직금 추계", { x: MARGIN_X, y: y - 8, size: 9.5, font: bold, color: INK });
    y -= 14;
    const grid: Array<[string, string, string, string]> = [
      ...severanceGrid(s),
      ["추계 퇴직금", estimateText(s), "올해 적립액 합계", `${won(s.severance.accrualTotal)} 원`],
    ];
    const lw = 120;
    const vw = TABLE_W / 2 - lw;
    const top = y;
    grid.forEach((g, gi) => {
      const last = gi === grid.length - 1;
      [0, 1].forEach((pi) => {
        const x = MARGIN_X + pi * (lw + vw);
        box(page, x, y, lw, SEV_ROW, SHADE);
        cellText(page, g[pi * 2], bold, x, lw, y, SEV_ROW, "center", 8.5);
        box(page, x + lw, y, vw, SEV_ROW, last ? STRONG : undefined);
        cellText(page, g[pi * 2 + 1], last ? bold : regular, x + lw, vw, y, SEV_ROW, "right", last ? 9.5 : 8.5);
      });
      y -= SEV_ROW;
    });
    outline(page, MARGIN_X, top, TABLE_W, top - y);
    y -= 6;
    for (const n of notes) {
      y -= NOTE_LINE;
      const size = fitSize(`· ${n}`, regular, TABLE_W, 7.5, 5.5);
      page.drawText(`· ${n}`, { x: MARGIN_X, y, size, font: regular, color: FAINT });
    }
  }

  // ── 하단 발급일 + 회사명·대표이사 + 직인(우측) ──
  {
    const sigSize = 12;
    const sigY = Math.max(y - 26, 26);
    const text = `${todayKst().ko}     ${COMPANY_KO}  대표이사  ${COMPANY_CEO.split("").join(" ")}`;
    const w = bold.widthOfTextAtSize(text, sigSize);
    const stampW = 40;
    const x = PAGE_W - MARGIN_X - w - (stamp ? stampW - 4 : 0);
    page.drawText(text, { x, y: sigY, size: sigSize, font: bold, color: INK });
    if (stamp) {
      const stampH = (stamp.height / stamp.width) * stampW;
      page.drawImage(stamp, { x: x + w - 4, y: sigY - stampH * 0.35, width: stampW, height: stampH, opacity: 0.92 });
    }
  }

  return doc.save();
}
