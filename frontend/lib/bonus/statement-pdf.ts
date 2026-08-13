import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { COMPANY_KO, COMPANY_CEO } from "@/lib/letter/types";

/*
 * 성과급 지급 명세서 PDF (개인 발송용, 블루프린트 §6 — 2026-08-13 레이아웃 전면 재구축)
 * - 중앙 제목 + 이중 구분선, 인적사항/합계 박스(라벨 음영), 격자 표(헤더·합계 음영 + 볼드),
 *   하단 발급일 + 회사명·대표이사 서명 + 직인(public/letter/stamp.png, 공문 pdf.ts 배치 규칙 이식).
 * - 참여인력: 용역명 + 계산서 발행일 + 용역별 산정액만(참여도·평점 미표시 확정).
 * - 부서장: 본부별 반기 제비용 반영액·본부장 비율·산정 성과급.
 */

export interface StatementPdfInput {
  periodLabel: string; // 예: "2026년 상반기"
  employeeName: string;
  deptName: string | null;
  positionName: string | null;
  totalAmount: number;
  /** 참여인력 용역별 내역 (없으면 섹션 생략) */
  lines: Array<{ title: string; issuedDates: string; amount: number }>;
  /** 부서장 본부별 내역 (없으면 섹션 생략) */
  deptHeadRows: Array<{ deptName: string; gross: number; ratePct: number; amount: number }>;
}

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN_X = 56.7;
const TABLE_W = PAGE_W - MARGIN_X * 2;
const HEADER_H = 28;
const ROW_H = 26;
const FONT_SIZE = 10;
const INK = rgb(0.1, 0.1, 0.12);
const LINE = rgb(0.45, 0.45, 0.5);
const SHADE = rgb(0.945, 0.95, 0.965);

let fontCache: { regular: Buffer; bold: Buffer } | null = null;
let stampCache: Buffer | null | undefined;

async function loadFonts(): Promise<{ regular: Buffer; bold: Buffer }> {
  if (fontCache) return fontCache;
  const dir = path.join(process.cwd(), "public", "fonts");
  fontCache = {
    regular: await readFile(path.join(dir, "malgun.ttf")),
    bold: await readFile(path.join(dir, "malgunbd.ttf")),
  };
  return fontCache;
}

async function loadStamp(): Promise<Buffer | null> {
  if (stampCache !== undefined) return stampCache;
  try {
    stampCache = await readFile(path.join(process.cwd(), "public", "letter", "stamp.png"));
  } catch {
    stampCache = null; // 직인 파일이 없어도 명세서 생성은 계속한다
  }
  return stampCache;
}

function fitSize(text: string, font: PDFFont, maxWidth: number, base: number, min: number): number {
  let size = base;
  while (size > min && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return size;
}

function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

function fmt(v: number): string {
  return Math.round(v).toLocaleString("ko-KR");
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

function drawCellText(
  page: PDFPage,
  text: string,
  font: PDFFont,
  x: number,
  width: number,
  rowTop: number,
  rowH: number,
  align: "center" | "left" | "right",
  size = FONT_SIZE,
  /** 지정 시 자동 축소 없이 이 크기로 고정(열 단위 크기 통일용). */
  fixedSize?: number
) {
  if (!text) return;
  const pad = 6;
  const maxW = width - pad * 2;
  const s = fixedSize ?? fitSize(text, font, maxW, size, 7);
  const shown = truncate(text, font, s, maxW);
  const w = font.widthOfTextAtSize(shown, s);
  const tx = align === "center" ? x + (width - w) / 2 : align === "right" ? x + width - pad - w : x + pad;
  page.drawText(shown, { x: tx, y: rowTop - rowH / 2 - s * 0.34, size: s, font, color: INK });
}

/** 글자 단위 커스텀 자간 텍스트(중앙 정렬) — 공백 문자 자간보다 촘촘하다. */
function drawSpacedTextCentered(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  y: number,
  spacing: number
) {
  const chars = text.split("");
  const widths = chars.map((c) => font.widthOfTextAtSize(c, size));
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let x = MARGIN_X + (TABLE_W - total) / 2;
  chars.forEach((c, i) => {
    page.drawText(c, { x, y, size, font, color: INK });
    x += widths[i] + spacing;
  });
}

/** 셀 배경 음영(테두리보다 먼저 칠한다). */
function shadeCell(page: PDFPage, x: number, width: number, rowTop: number, rowH: number) {
  page.drawRectangle({ x, y: rowTop - rowH, width, height: rowH, color: SHADE });
}

/** 격자: 외곽 굵게 + 내부 얇게. */
function drawGrid(page: PDFPage, xs: number[], top: number, bottom: number, hLines: number[]) {
  const left = xs[0];
  const right = xs[xs.length - 1];
  for (const x of xs.slice(1, -1)) {
    page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness: 0.5, color: LINE });
  }
  for (const y of hLines.slice(1, -1)) {
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: LINE });
  }
  // 외곽
  page.drawRectangle({
    x: left,
    y: bottom,
    width: right - left,
    height: top - bottom,
    borderColor: INK,
    borderWidth: 1.1,
  });
}

function colXs(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const xs = [MARGIN_X];
  for (const w of weights) xs.push(xs[xs.length - 1] + (w / sum) * TABLE_W);
  return xs;
}

export async function renderStatementPdf(input: StatementPdfInput): Promise<Uint8Array> {
  const fontBytes = await loadFonts();
  const stampBytes = await loadStamp();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts: Fonts = {
    regular: await doc.embedFont(fontBytes.regular, { subset: true }),
    bold: await doc.embedFont(fontBytes.bold, { subset: true }),
  };
  let stamp: PDFImage | null = null;
  if (stampBytes) stamp = await doc.embedPng(stampBytes);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 78;
  const bottomLimit = 150; // 하단 서명부 공간 확보

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - 70;
  };

  // ── 제목(커스텀 자간) + 이중 구분선 ──
  const title = `${input.periodLabel} 성과급 지급 명세서`;
  drawSpacedTextCentered(page, title, fonts.bold, 19, y, 2.2);
  y -= 18;
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 1.6, color: INK });
  page.drawLine({ start: { x: MARGIN_X, y: y - 3 }, end: { x: PAGE_W - MARGIN_X, y: y - 3 }, thickness: 0.6, color: INK });
  y -= 26;

  // ── 인적사항 표 (성명|소속|직급) ──
  {
    const LABEL_W = 64;
    const valueW = (TABLE_W - LABEL_W * 3) / 3;
    const weights = [LABEL_W, valueW, LABEL_W, valueW, LABEL_W, valueW];
    const xs = colXs(weights);
    const rowTop = y;
    const cells = [
      { t: "성명", label: true },
      { t: input.employeeName, label: false },
      { t: "소속", label: true },
      { t: input.deptName ?? "-", label: false },
      { t: "직급", label: true },
      { t: input.positionName ?? "-", label: false },
    ];
    cells.forEach((c, i) => {
      if (c.label) shadeCell(page, xs[i], xs[i + 1] - xs[i], rowTop, ROW_H);
    });
    cells.forEach((c, i) =>
      drawCellText(page, c.t, c.label ? fonts.bold : fonts.regular, xs[i], xs[i + 1] - xs[i], rowTop, ROW_H, "center")
    );
    drawGrid(page, xs, rowTop, rowTop - ROW_H, [rowTop, rowTop - ROW_H]);
    y -= ROW_H + 8;
  }

  // ── 지급 합계 박스 ──
  {
    const LABEL_W = 150;
    const xs = [MARGIN_X, MARGIN_X + LABEL_W, MARGIN_X + TABLE_W];
    const h = 32;
    const rowTop = y;
    shadeCell(page, xs[0], LABEL_W, rowTop, h);
    drawCellText(page, "지급 성과급 합계", fonts.bold, xs[0], LABEL_W, rowTop, h, "center", 11);
    drawCellText(page, `${fmt(input.totalAmount)} 원`, fonts.bold, xs[1], xs[2] - xs[1], rowTop, h, "right", 13);
    drawGrid(page, xs, rowTop, rowTop - h, [rowTop, rowTop - h]);
    y -= h + 22;
  }

  // ── 표 섹션들 ──
  interface TableSpec {
    label: string;
    weights: number[];
    headers: string[];
    aligns: Array<"center" | "left" | "right">;
    rows: string[][];
    totalRow: string[];
  }
  const tables: TableSpec[] = [];
  if (input.lines.length) {
    tables.push({
      label: "용역별 성과급 산정 내역",
      weights: [7, 55, 19, 19],
      headers: ["연번", "용역명", "계산서 발행일", "성과급 산정액(원)"],
      aligns: ["center", "left", "center", "right"],
      rows: input.lines.map((l, i) => [String(i + 1), l.title, l.issuedDates, fmt(l.amount)]),
      totalRow: ["", "합계", "", fmt(input.lines.reduce((a, b) => a + b.amount, 0))],
    });
  }
  if (input.deptHeadRows.length) {
    tables.push({
      label: "본부장 성과급 산정 내역",
      weights: [26, 30, 18, 26],
      headers: ["본부", "반기 제비용 반영액(원)", "본부장 비율", "산정 성과급(원)"],
      aligns: ["center", "right", "center", "right"],
      rows: input.deptHeadRows.map((d) => [d.deptName, fmt(d.gross), `${d.ratePct}%`, fmt(d.amount)]),
      totalRow: ["합계", "", "", fmt(input.deptHeadRows.reduce((a, b) => a + b.amount, 0))],
    });
  }

  for (const spec of tables) {
    if (y - (HEADER_H + ROW_H * 2 + 26) < bottomLimit) newPage();
    page.drawText(spec.label, { x: MARGIN_X, y, size: 11, font: fonts.bold, color: INK });
    y -= 12;
    const xs = colXs(spec.weights);
    // 좌측 정렬 텍스트 열(용역명 등)은 가장 긴 행 기준 크기로 통일한다(행마다 들쭉날쭉 방지)
    const uniformSizes: Array<number | undefined> = spec.aligns.map((align, i) => {
      if (align !== "left") return undefined;
      const colW = xs[i + 1] - xs[i] - 12;
      return spec.rows.reduce(
        (acc, row) => Math.min(acc, fitSize(row[i], fonts.regular, colW, FONT_SIZE, 7)),
        FONT_SIZE
      );
    });
    const drawHeader = () => {
      const rowTop = y;
      shadeCell(page, xs[0], xs[xs.length - 1] - xs[0], rowTop, HEADER_H);
      spec.headers.forEach((h, i) =>
        drawCellText(page, h, fonts.bold, xs[i], xs[i + 1] - xs[i], rowTop, HEADER_H, "center")
      );
      y = rowTop - HEADER_H;
      return rowTop;
    };
    let tableTop = drawHeader();
    let hLines: number[] = [tableTop, y];
    const allRows = spec.rows.map((r) => ({ cells: r, total: false }));
    allRows.push({ cells: spec.totalRow, total: true });
    for (const row of allRows) {
      if (y - ROW_H < bottomLimit) {
        drawGrid(page, xs, tableTop, y, hLines);
        newPage();
        tableTop = drawHeader();
        hLines = [tableTop, y];
      }
      const rowTop = y;
      if (row.total) shadeCell(page, xs[0], xs[xs.length - 1] - xs[0], rowTop, ROW_H);
      row.cells.forEach((cell, i) =>
        drawCellText(
          page,
          cell,
          row.total ? fonts.bold : fonts.regular,
          xs[i],
          xs[i + 1] - xs[i],
          rowTop,
          ROW_H,
          spec.aligns[i],
          FONT_SIZE,
          row.total ? undefined : uniformSizes[i]
        )
      );
      y -= ROW_H;
      hLines.push(y);
    }
    drawGrid(page, xs, tableTop, y, hLines);
    y -= 26;
  }

  // ── 하단 서명부 (발급일 + 회사명·대표이사 + 직인) ──
  {
    if (y < bottomLimit) newPage();
    const today = new Date(Date.now() + 9 * 3600 * 1000);
    const dateText = `${today.getUTCFullYear()}년 ${today.getUTCMonth() + 1}월 ${today.getUTCDate()}일`;
    const dateY = Math.max(y - 18, 118);
    page.drawText(dateText, {
      x: MARGIN_X + (TABLE_W - fonts.regular.widthOfTextAtSize(dateText, 11)) / 2,
      y: dateY,
      size: 11,
      font: fonts.regular,
      color: INK,
    });

    const sigY = dateY - 36;
    const sigSize = 15;
    const text = `${COMPANY_KO}  대표이사  ${COMPANY_CEO.split("").join(" ")}`;
    const sigW = fonts.bold.widthOfTextAtSize(text, sigSize);
    // 공문(pdf.ts)과 동일 규칙 — 완전 중앙보다 1글자 왼쪽, 직인 왼쪽 가장자리 = 성명 오른쪽 끝
    const sigX = (PAGE_W - sigW) / 2 - sigSize;
    page.drawText(text, { x: sigX, y: sigY, size: sigSize, font: fonts.bold, color: INK });
    if (stamp) {
      const stampW = 52;
      const stampH = (stamp.height / stamp.width) * stampW;
      page.drawImage(stamp, {
        x: sigX + sigW,
        y: sigY - stampH * 0.35,
        width: stampW,
        height: stampH,
        opacity: 0.92,
      });
    }
  }

  return doc.save();
}
