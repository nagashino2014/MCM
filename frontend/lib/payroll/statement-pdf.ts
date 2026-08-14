import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { COMPANY_KO, COMPANY_CEO } from "@/lib/letter/types";

/*
 * 급여명세서 PDF (개인 발송용, 블루프린트 §4-1 후속)
 * - 근로기준법 제48조② 필수 기재: 성명·사번, 임금지급일, 구성항목별 금액,
 *   계산방법(초과근무수당 등 산출식), 공제항목별 금액.
 * - 레이아웃은 성과급 명세서(lib/bonus/statement-pdf.ts) 관례 이식:
 *   자간 제목 + 이중선, 라벨 음영 격자표, 하단 회사명·대표이사 + 직인.
 */

export interface PayslipPdfInput {
  payYear: number;
  payMonth: number;
  employeeName: string;
  empNo: string | null;
  deptName: string | null;
  positionName: string | null;
  /** 임금지급일(법정 기재) — 'YYYY-MM-DD' */
  payDate: string;
  payLines: Array<{ name: string; amount: number }>;
  dedLines: Array<{ name: string; amount: number }>;
  payTotal: number;
  deductionTotal: number;
  netPay: number;
  /** 계산방법 설명(법정 기재) — 초과근무수당 산출식 등 */
  notes: string[];
}

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN_X = 56.7;
const TABLE_W = PAGE_W - MARGIN_X * 2;
const HEADER_H = 26;
const ROW_H = 22;
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
    stampCache = null; // 직인이 없어도 명세서 생성은 계속한다
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

function drawCellText(
  page: PDFPage,
  text: string,
  font: PDFFont,
  x: number,
  width: number,
  rowTop: number,
  rowH: number,
  align: "center" | "left" | "right",
  size = FONT_SIZE
) {
  if (!text) return;
  const pad = 6;
  const maxW = width - pad * 2;
  const s = fitSize(text, font, maxW, size, 7);
  const shown = truncate(text, font, s, maxW);
  const w = font.widthOfTextAtSize(shown, s);
  const tx = align === "center" ? x + (width - w) / 2 : align === "right" ? x + width - pad - w : x + pad;
  page.drawText(shown, { x: tx, y: rowTop - rowH / 2 - s * 0.34, size: s, font, color: INK });
}

/** 글자 단위 커스텀 자간 텍스트(중앙 정렬) */
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

function shadeCell(page: PDFPage, x: number, width: number, rowTop: number, rowH: number) {
  page.drawRectangle({ x, y: rowTop - rowH, width, height: rowH, color: SHADE });
}

function drawGrid(page: PDFPage, xs: number[], top: number, bottom: number, hLines: number[]) {
  const left = xs[0];
  const right = xs[xs.length - 1];
  for (const x of xs.slice(1, -1)) {
    page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness: 0.5, color: LINE });
  }
  for (const y of hLines.slice(1, -1)) {
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: LINE });
  }
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

/** 지급일 표기 — 'YYYY-MM-DD' → 'YYYY년 M월 D일' */
function koDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : iso;
}

export async function renderPayslipPdf(input: PayslipPdfInput): Promise<Uint8Array> {
  const fontBytes = await loadFonts();
  const stampBytes = await loadStamp();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = {
    regular: await doc.embedFont(fontBytes.regular, { subset: true }),
    bold: await doc.embedFont(fontBytes.bold, { subset: true }),
  };
  let stamp: PDFImage | null = null;
  if (stampBytes) stamp = await doc.embedPng(stampBytes);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 78;

  // ── 제목 + 이중 구분선 ──
  drawSpacedTextCentered(page, `${input.payYear}년 ${input.payMonth}월분 급여명세서`, fonts.bold, 19, y, 2.2);
  y -= 18;
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 1.6, color: INK });
  page.drawLine({ start: { x: MARGIN_X, y: y - 3 }, end: { x: PAGE_W - MARGIN_X, y: y - 3 }, thickness: 0.6, color: INK });
  y -= 26;

  // ── 인적사항 2행 (성명·소속·직급 / 사번·지급일·지급방법) ──
  {
    const LABEL_W = 58;
    const valueW = (TABLE_W - LABEL_W * 3) / 3;
    const xs = colXs([LABEL_W, valueW, LABEL_W, valueW, LABEL_W, valueW]);
    const rows: Array<Array<{ t: string; label: boolean }>> = [
      [
        { t: "성명", label: true }, { t: input.employeeName, label: false },
        { t: "소속", label: true }, { t: input.deptName ?? "-", label: false },
        { t: "직급", label: true }, { t: input.positionName ?? "-", label: false },
      ],
      [
        { t: "사번", label: true }, { t: input.empNo ?? "-", label: false },
        { t: "지급일", label: true }, { t: koDate(input.payDate), label: false },
        { t: "지급방법", label: true }, { t: "계좌이체", label: false },
      ],
    ];
    const top = y;
    const hLines = [top];
    for (const cells of rows) {
      const rowTop = y;
      cells.forEach((c, i) => {
        if (c.label) shadeCell(page, xs[i], xs[i + 1] - xs[i], rowTop, ROW_H);
      });
      cells.forEach((c, i) =>
        drawCellText(page, c.t, c.label ? fonts.bold : fonts.regular, xs[i], xs[i + 1] - xs[i], rowTop, ROW_H, "center")
      );
      y -= ROW_H;
      hLines.push(y);
    }
    drawGrid(page, xs, top, y, hLines);
    y -= 18;
  }

  // ── 지급·공제 내역 (좌: 지급 / 우: 공제) ──
  {
    const xs = colXs([30, 20, 30, 20]);
    const top = y;
    const hLines = [top];

    // 헤더
    shadeCell(page, xs[0], xs[4] - xs[0], top, HEADER_H);
    ["지급 항목", "지급액(원)", "공제 항목", "공제액(원)"].forEach((h, i) =>
      drawCellText(page, h, fonts.bold, xs[i], xs[i + 1] - xs[i], top, HEADER_H, "center")
    );
    y -= HEADER_H;
    hLines.push(y);

    const rowCount = Math.max(input.payLines.length, input.dedLines.length);
    for (let i = 0; i < rowCount; i++) {
      const p = input.payLines[i];
      const d = input.dedLines[i];
      const rowTop = y;
      drawCellText(page, p?.name ?? "", fonts.regular, xs[0], xs[1] - xs[0], rowTop, ROW_H, "left");
      drawCellText(page, p ? fmt(p.amount) : "", fonts.regular, xs[1], xs[2] - xs[1], rowTop, ROW_H, "right");
      drawCellText(page, d?.name ?? "", fonts.regular, xs[2], xs[3] - xs[2], rowTop, ROW_H, "left");
      drawCellText(page, d ? fmt(d.amount) : "", fonts.regular, xs[3], xs[4] - xs[3], rowTop, ROW_H, "right");
      y -= ROW_H;
      hLines.push(y);
    }

    // 합계 행
    {
      const rowTop = y;
      shadeCell(page, xs[0], xs[4] - xs[0], rowTop, ROW_H);
      drawCellText(page, "지급액 계", fonts.bold, xs[0], xs[1] - xs[0], rowTop, ROW_H, "left");
      drawCellText(page, fmt(input.payTotal), fonts.bold, xs[1], xs[2] - xs[1], rowTop, ROW_H, "right");
      drawCellText(page, "공제액 계", fonts.bold, xs[2], xs[3] - xs[2], rowTop, ROW_H, "left");
      drawCellText(page, fmt(input.deductionTotal), fonts.bold, xs[3], xs[4] - xs[3], rowTop, ROW_H, "right");
      y -= ROW_H;
      hLines.push(y);
    }
    drawGrid(page, xs, top, y, hLines);
    y -= 14;
  }

  // ── 실지급액 박스 ──
  {
    const LABEL_W = 150;
    const xs = [MARGIN_X, MARGIN_X + LABEL_W, MARGIN_X + TABLE_W];
    const h = 32;
    const rowTop = y;
    shadeCell(page, xs[0], LABEL_W, rowTop, h);
    drawCellText(page, "실 지급액", fonts.bold, xs[0], LABEL_W, rowTop, h, "center", 11);
    drawCellText(page, `${fmt(input.netPay)} 원`, fonts.bold, xs[1], xs[2] - xs[1], rowTop, h, "right", 13);
    drawGrid(page, xs, rowTop, rowTop - h, [rowTop, rowTop - h]);
    y -= h + 18;
  }

  // ── 계산 방법(법정 기재) ──
  if (input.notes.length) {
    page.drawText("임금 계산 방법", { x: MARGIN_X, y, size: 10.5, font: fonts.bold, color: INK });
    y -= 13;
    const top = y;
    const boxH = 14 * input.notes.length + 12;
    page.drawRectangle({
      x: MARGIN_X, y: top - boxH, width: TABLE_W, height: boxH,
      borderColor: LINE, borderWidth: 0.6,
    });
    let ty = top - 16;
    for (const n of input.notes) {
      const shown = truncate(`· ${n}`, fonts.regular, 9, TABLE_W - 20);
      page.drawText(shown, { x: MARGIN_X + 10, y: ty, size: 9, font: fonts.regular, color: INK });
      ty -= 14;
    }
    y = top - boxH - 20;
  }

  // ── 하단 발급일 + 회사명·대표이사 + 직인 ──
  {
    const today = new Date(Date.now() + 9 * 3600 * 1000);
    const dateText = `${today.getUTCFullYear()}년 ${today.getUTCMonth() + 1}월 ${today.getUTCDate()}일`;
    const dateY = Math.max(y - 10, 118);
    page.drawText(dateText, {
      x: MARGIN_X + (TABLE_W - fonts.regular.widthOfTextAtSize(dateText, 11)) / 2,
      y: dateY, size: 11, font: fonts.regular, color: INK,
    });
    const sigY = dateY - 36;
    const sigSize = 15;
    const text = `${COMPANY_KO}  대표이사  ${COMPANY_CEO.split("").join(" ")}`;
    const sigW = fonts.bold.widthOfTextAtSize(text, sigSize);
    const sigX = (PAGE_W - sigW) / 2 - sigSize;
    page.drawText(text, { x: sigX, y: sigY, size: sigSize, font: fonts.bold, color: INK });
    if (stamp) {
      const stampW = 52;
      const stampH = (stamp.height / stamp.width) * stampW;
      page.drawImage(stamp, { x: sigX + sigW, y: sigY - stampH * 0.35, width: stampW, height: stampH, opacity: 0.92 });
    }
  }

  return doc.save();
}
