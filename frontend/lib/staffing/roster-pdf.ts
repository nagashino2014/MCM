import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ContractRoster, RosterRow } from "./roster";

/*
 * 용역수행 기술인력 명단 PDF — 원본 한글(hwpx) 양식을 그대로 재현한다.
 * (사업장/수주·수금 내보내기의 createTablePdf 와는 별개의 전용 렌더러.)
 * A4 세로, 전체 격자 테두리, 제목 좌상단, 헤더 + 최소 6행(빈 행 패딩), 날짜/합계 없음.
 */

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN_X = 56.7; // 20mm (hwpx 좌우 여백과 동일)
const TABLE_W = PAGE_W - MARGIN_X * 2;

const HEADERS = ["연번", "성명", "생년월일", "기술등급", "전문분야", "담당업무", "수행기간"];
// hwpx 셀 너비 비율 (연번/성명/생년월일/기술등급/전문분야/담당업무/수행기간)
const COL_WEIGHTS = [3973, 6803, 8218, 6237, 6237, 7935, 8218];

const HEADER_H = 34;
const ROW_H = 33;
const MIN_ROWS = 6; // 원본 양식의 고정 6행
const FONT_SIZE = 11;
const TITLE_SIZE = 15;
const BLACK = rgb(0, 0, 0);

let fontCache: Buffer | null = null;

async function loadFont(): Promise<Buffer> {
  if (fontCache) return fontCache;
  const dir = path.join(process.cwd(), "public", "fonts");
  fontCache = await readFile(path.join(dir, "malgun.ttf"));
  return fontCache;
}

/** maxWidth 에 맞는 폰트 크기(최소 minSize 까지 축소). */
function fitSize(text: string, font: PDFFont, maxWidth: number, base: number, min: number): number {
  let size = base;
  while (size > min && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return size;
}

/** 셀 폭을 넘으면 말줄임. */
function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

function colXs(): number[] {
  const sum = COL_WEIGHTS.reduce((a, b) => a + b, 0);
  const xs = [MARGIN_X];
  for (const w of COL_WEIGHTS) xs.push(xs[xs.length - 1] + (w / sum) * TABLE_W);
  return xs;
}

/**
 * 수행기간 표시 줄 분리.
 * - 실제 종료일이 있으면 'YYYY.MM.DD ~' / 종료일 2줄로 분리.
 * - 종료일이 '진행중'(또는 분리자 없음)이면 줄바꿈 없이 1줄.
 */
function periodLines(text: string): string[] {
  const idx = text.indexOf(" ~ ");
  if (idx < 0) return [text];
  const end = text.slice(idx + 3);
  if (end === "진행중") return [text];
  return [`${text.slice(0, idx)} ~`, end];
}

/** 셀 안에 여러 줄 텍스트를 수평 중앙 + 수직 중앙(블록)으로 그린다. */
function drawCell(
  page: PDFPage,
  lines: string[],
  font: PDFFont,
  x: number,
  width: number,
  rowTop: number,
  rowH: number,
  align: "center" | "left"
) {
  const texts = lines.filter((t) => t !== "");
  if (!texts.length) return;
  const pad = 4;
  const maxW = width - pad * 2;
  // 모든 줄에 동일 크기 적용(가장 긴 줄 기준으로 한 번만 축소)
  let size = FONT_SIZE;
  for (const t of texts) size = Math.min(size, fitSize(t, font, maxW, FONT_SIZE, 7));
  const step = size * 1.2;
  const centerY = rowTop - rowH / 2;
  texts.forEach((t, i) => {
    const shown = truncate(t, font, size, maxW);
    const w = font.widthOfTextAtSize(shown, size);
    const tx = align === "center" ? x + (width - w) / 2 : x + pad;
    const ty = centerY + ((texts.length - 1) / 2 - i) * step - size * 0.34;
    page.drawText(shown, { x: tx, y: ty, size, font, color: BLACK });
  });
}

function drawRow(
  page: PDFPage,
  font: PDFFont,
  xs: number[],
  rowTop: number,
  cells: string[]
) {
  for (let i = 0; i < cells.length; i++) {
    const lines = i === 6 ? periodLines(cells[i]) : [cells[i]];
    drawCell(page, lines, font, xs[i], xs[i + 1] - xs[i], rowTop, ROW_H, "center");
  }
}

/** 표 격자(세로선 전부 + 가로선 전부 + 외곽). */
function drawGrid(page: PDFPage, xs: number[], top: number, bottom: number, hLines: number[]) {
  const right = xs[xs.length - 1];
  for (const x of xs) {
    page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness: 0.8, color: BLACK });
  }
  for (const y of hLines) {
    page.drawLine({ start: { x: MARGIN_X, y }, end: { x: right, y }, thickness: 0.8, color: BLACK });
  }
}

export async function renderRosterPdf(roster: ContractRoster): Promise<Uint8Array> {
  const regBytes = await loadFont();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(regBytes, { subset: true });

  const xs = colXs();
  const title = `용역수행 기술인력 명단(${roster.serviceName})`;

  // 최소 6행 유지, 데이터가 더 많으면 그만큼 확장
  const dataRows: string[][] = roster.rows.map((r: RosterRow) => [
    String(r.seq),
    r.name,
    r.birth,
    r.engGrade,
    r.specialty,
    r.task,
    r.period,
  ]);
  const totalRows = Math.max(MIN_ROWS, dataRows.length);
  for (let i = dataRows.length; i < totalRows; i++) {
    dataRows.push([String(i + 1), "", "", "", "", "", ""]);
  }

  const tableTopFirst = PAGE_H - 96;
  const bottomLimit = 60;
  const rowsPerPage = Math.max(1, Math.floor((tableTopFirst - bottomLimit - HEADER_H) / ROW_H));
  const pageCount = Math.max(1, Math.ceil(dataRows.length / rowsPerPage));

  for (let p = 0; p < pageCount; p++) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    let tableTop = tableTopFirst;
    if (p === 0) {
      const tSize = fitSize(title, regular, TABLE_W, TITLE_SIZE, 9);
      page.drawText(title, { x: MARGIN_X, y: PAGE_H - 66, size: tSize, font: regular, color: BLACK });
    }
    const hLines: number[] = [tableTop];
    // 헤더 (원본 양식과 동일하게 일반 굵기)
    let y = tableTop - HEADER_H;
    drawRow(page, regular, xs, tableTop, HEADERS);
    hLines.push(y);
    // 데이터
    const pageRows = dataRows.slice(p * rowsPerPage, (p + 1) * rowsPerPage);
    for (const row of pageRows) {
      const rowTop = y;
      drawRow(page, regular, xs, rowTop, row);
      y -= ROW_H;
      hLines.push(y);
    }
    drawGrid(page, xs, tableTop, y, hLines);
  }

  return doc.save();
}
