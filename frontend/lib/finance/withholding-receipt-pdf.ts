import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { COMPANY_ADDRESS, COMPANY_BIZ_NO, COMPANY_CEO, COMPANY_KO } from "@/lib/letter/types";
import type { YearendResult } from "@/lib/finance/yearend";

/*
 * 근로소득 원천징수영수증(요약본) PDF — 내 연말정산 화면 열람·출력용.
 * 세무법인 원본(yearend_settlements.pdf_key)이 없을 때 앱 산출 결과(YearendResult)로 만든다.
 * 법정 서식(소득세법 시행규칙 별지 24호)의 전 항목을 재현하지는 않고, 징수의무자·소득자·소득명세·
 * 세액계산(브레이크다운)·차감징수세액을 A4 1장에 담는다. 원본이 등록되면 원본이 우선한다.
 * 레이아웃 관례는 급여명세서(lib/payroll/statement-pdf.ts)와 같다: 자간 제목 + 이중선, 라벨 음영 격자표, 하단 직인.
 */

export interface WithholdingReceiptInput {
  targetYear: number;
  employeeName: string;
  empNo: string | null;
  deptName: string | null;
  positionName: string | null;
  monthCount: number;
  nonTaxablePay: number;
  result: YearendResult;
  status: "draft" | "confirmed";
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 50;
const TABLE_W = PAGE_W - MARGIN_X * 2;
const ROW_H = 19;
const FONT_SIZE = 9.5;
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
    stampCache = null;
  }
  return stampCache;
}

const fmt = (v: number) => Math.round(v).toLocaleString("ko-KR");

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

function cell(page: PDFPage, text: string, font: PDFFont, x: number, width: number, rowTop: number, rowH: number, align: "center" | "left" | "right", size = FONT_SIZE) {
  if (!text) return;
  const pad = 5;
  const maxW = width - pad * 2;
  const s = fitSize(text, font, maxW, size, 6.5);
  const shown = truncate(text, font, s, maxW);
  const w = font.widthOfTextAtSize(shown, s);
  const tx = align === "center" ? x + (width - w) / 2 : align === "right" ? x + width - pad - w : x + pad;
  page.drawText(shown, { x: tx, y: rowTop - rowH / 2 - s * 0.34, size: s, font, color: INK });
}

function shade(page: PDFPage, x: number, width: number, rowTop: number, rowH: number) {
  page.drawRectangle({ x, y: rowTop - rowH, width, height: rowH, color: SHADE });
}

function grid(page: PDFPage, xs: number[], top: number, bottom: number, hLines: number[]) {
  const left = xs[0];
  const right = xs[xs.length - 1];
  for (const x of xs.slice(1, -1)) page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness: 0.5, color: LINE });
  for (const y of hLines.slice(1, -1)) page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: LINE });
  page.drawRectangle({ x: left, y: bottom, width: right - left, height: top - bottom, borderColor: INK, borderWidth: 0.9 });
}

function colXs(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const xs = [MARGIN_X];
  let acc = MARGIN_X;
  for (const w of weights) {
    acc += (w / total) * TABLE_W;
    xs.push(acc);
  }
  return xs;
}

function spacedTitle(page: PDFPage, text: string, font: PDFFont, size: number, y: number, spacing: number) {
  const chars = text.split("");
  const widths = chars.map((c) => font.widthOfTextAtSize(c, size));
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let x = MARGIN_X + (TABLE_W - total) / 2;
  chars.forEach((c, i) => {
    page.drawText(c, { x, y, size, font, color: INK });
    x += widths[i] + spacing;
  });
}

/** 라벨/값 2쌍 격자표(인적사항용) */
function drawPairsTable(page: PDFPage, fonts: { regular: PDFFont; bold: PDFFont }, y: number, rows: Array<Array<[string, string]>>): number {
  const LABEL_W = 78;
  const valueW = (TABLE_W - LABEL_W * 2) / 2;
  const xs = colXs([LABEL_W, valueW, LABEL_W, valueW]);
  const top = y;
  const hLines = [top];
  for (const pairs of rows) {
    const rowTop = y;
    pairs.forEach(([label, value], i) => {
      const lx = xs[i * 2];
      shade(page, lx, xs[i * 2 + 1] - lx, rowTop, ROW_H);
      cell(page, label, fonts.bold, lx, xs[i * 2 + 1] - lx, rowTop, ROW_H, "center");
      cell(page, value, fonts.regular, xs[i * 2 + 1], xs[i * 2 + 2] - xs[i * 2 + 1], rowTop, ROW_H, "left");
    });
    y -= ROW_H;
    hLines.push(y);
  }
  grid(page, xs, top, y, hLines);
  return y;
}

/** 항목/금액 2열 격자표(세액계산용) — bold 행은 소계·합계 */
function drawAmountTable(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  y: number,
  title: string,
  rows: Array<{ label: string; amount: number | null; bold?: boolean; note?: string }>
): number {
  const xs = colXs([58, 22, 20]);
  const top = y;
  const hLines = [top];
  shade(page, xs[0], xs[3] - xs[0], top, ROW_H);
  cell(page, title, fonts.bold, xs[0], xs[1] - xs[0], top, ROW_H, "left");
  cell(page, "금액(원)", fonts.bold, xs[1], xs[2] - xs[1], top, ROW_H, "center");
  cell(page, "비고", fonts.bold, xs[2], xs[3] - xs[2], top, ROW_H, "center");
  y -= ROW_H;
  hLines.push(y);
  for (const r of rows) {
    const rowTop = y;
    if (r.bold) shade(page, xs[0], xs[3] - xs[0], rowTop, ROW_H);
    cell(page, r.label, r.bold ? fonts.bold : fonts.regular, xs[0], xs[1] - xs[0], rowTop, ROW_H, "left");
    cell(page, r.amount == null ? "" : fmt(r.amount), r.bold ? fonts.bold : fonts.regular, xs[1], xs[2] - xs[1], rowTop, ROW_H, "right");
    cell(page, r.note ?? "", fonts.regular, xs[2], xs[3] - xs[2], rowTop, ROW_H, "left", 8);
    y -= ROW_H;
    hLines.push(y);
  }
  grid(page, xs, top, y, hLines);
  return y;
}

export async function renderWithholdingReceiptPdf(input: WithholdingReceiptInput): Promise<Uint8Array> {
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

  const r = input.result;
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 64;

  spacedTitle(page, `${input.targetYear}년 귀속 근로소득 원천징수영수증`, fonts.bold, 17, y, 2);
  y -= 15;
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 1.5, color: INK });
  page.drawLine({ start: { x: MARGIN_X, y: y - 3 }, end: { x: PAGE_W - MARGIN_X, y: y - 3 }, thickness: 0.6, color: INK });
  y -= 14;
  const sub = input.status === "confirmed"
    ? "앱 산출 요약본 — 확정 정산 결과 기준. 세무대리인 제출 원본은 관리자 등록 시 그 파일이 우선 표시됩니다."
    : "앱 산출 요약본(정산 미확정) — 참고용이며 확정 후 금액이 달라질 수 있습니다.";
  page.drawText(sub, { x: MARGIN_X, y, size: 8, font: fonts.regular, color: LINE });
  y -= 16;

  // ── 징수의무자 ──
  page.drawText("① 징수의무자", { x: MARGIN_X, y, size: 10, font: fonts.bold, color: INK });
  y -= 6;
  y = drawPairsTable(page, fonts, y, [
    [["법인명(상호)", COMPANY_KO], ["대표자", COMPANY_CEO]],
    [["사업자등록번호", COMPANY_BIZ_NO], ["소재지", COMPANY_ADDRESS]],
  ]);
  y -= 14;

  // ── 소득자 ──
  page.drawText("② 소득자", { x: MARGIN_X, y, size: 10, font: fonts.bold, color: INK });
  y -= 6;
  y = drawPairsTable(page, fonts, y, [
    [["성명", input.employeeName], ["사번", input.empNo ?? "-"]],
    [["소속", input.deptName ?? "-"], ["직급", input.positionName ?? "-"]],
  ]);
  y -= 14;

  // ── 근무처별 소득명세 ──
  page.drawText("③ 근무처별 소득명세", { x: MARGIN_X, y, size: 10, font: fonts.bold, color: INK });
  y -= 6;
  y = drawAmountTable(page, fonts, y, "구분", [
    { label: "근무기간", amount: null, note: `${input.targetYear}년 확정 급여대장 ${input.monthCount}개월` },
    { label: "급여(과세) 총액", amount: r.grossPay - (r.deemedBonus ?? 0) },
    { label: "인정상여", amount: r.deemedBonus ?? 0 },
    { label: "비과세 소득", amount: input.nonTaxablePay, note: "식대·차량유지비·육아수당 등" },
    { label: "총급여", amount: r.grossPay, bold: true },
  ]);
  y -= 14;

  // ── 세액 계산 ──
  page.drawText("④ 세액 계산", { x: MARGIN_X, y, size: 10, font: fonts.bold, color: INK });
  y -= 6;
  const calcRows: Array<{ label: string; amount: number | null; bold?: boolean; note?: string }> = [
    { label: "총급여", amount: r.grossPay },
    { label: "근로소득공제", amount: r.earnedIncomeDeduction },
    { label: "근로소득금액", amount: r.earnedIncome, bold: true },
    ...r.incomeDeductions.map((l) => ({ label: `  소득공제 · ${l.label}`, amount: l.amount, note: l.note })),
    { label: "소득공제 계", amount: r.incomeDeductionTotal, bold: true },
    { label: "과세표준", amount: r.taxBase, bold: true },
    { label: "산출세액", amount: r.calculatedTax, bold: true },
    ...r.taxCredits.map((l) => ({ label: `  세액공제 · ${l.label}`, amount: l.amount, note: l.note })),
    { label: "세액공제 계", amount: r.taxCreditTotal, bold: true, note: r.usedStandardCredit ? "표준세액공제 적용" : undefined },
    { label: "결정세액(소득세)", amount: r.determinedTax, bold: true },
    { label: "기납부세액(원천징수 소득세)", amount: r.prepaidTax },
    { label: r.balance < 0 ? "차감징수세액 — 환급(소득세)" : "차감징수세액 — 추가 납부(소득세)", amount: Math.abs(r.balance), bold: true },
    { label: r.localTax < 0 ? "지방소득세 환급" : "지방소득세 추가 납부", amount: Math.abs(r.localTax), note: "소득세의 10%" },
  ];
  // 행이 많으면 2페이지로 넘긴다(세액 계산 표를 통째로 다음 장에).
  const needed = ROW_H * (calcRows.length + 1) + 150;
  if (y - needed < 60) {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - 64;
    page.drawText("④ 세액 계산 (계속)", { x: MARGIN_X, y, size: 10, font: fonts.bold, color: INK });
    y -= 6;
  }
  y = drawAmountTable(page, fonts, y, "구분", calcRows);
  y -= 18;

  // ── 하단: 발급일 + 회사명·대표이사 + 직인 ──
  {
    const today = new Date(Date.now() + 9 * 3600 * 1000);
    const dateText = `${today.getUTCFullYear()}년 ${today.getUTCMonth() + 1}월 ${today.getUTCDate()}일`;
    const dateY = Math.max(y - 6, 100);
    page.drawText("위의 원천징수액(근로소득)을 영수(지급)합니다.", {
      x: MARGIN_X + (TABLE_W - fonts.regular.widthOfTextAtSize("위의 원천징수액(근로소득)을 영수(지급)합니다.", 10)) / 2,
      y: dateY + 16, size: 10, font: fonts.regular, color: INK,
    });
    page.drawText(dateText, { x: MARGIN_X + (TABLE_W - fonts.regular.widthOfTextAtSize(dateText, 10.5)) / 2, y: dateY, size: 10.5, font: fonts.regular, color: INK });
    const sigY = dateY - 32;
    const sigSize = 13.5;
    const text = `징수의무자  ${COMPANY_KO}  대표이사  ${COMPANY_CEO.split("").join(" ")}`;
    const sigW = fonts.bold.widthOfTextAtSize(text, sigSize);
    const sigX = (PAGE_W - sigW) / 2 - sigSize;
    page.drawText(text, { x: sigX, y: sigY, size: sigSize, font: fonts.bold, color: INK });
    if (stamp) {
      const stampW = 48;
      const stampH = (stamp.height / stamp.width) * stampW;
      page.drawImage(stamp, { x: sigX + sigW, y: sigY - stampH * 0.35, width: stampW, height: stampH, opacity: 0.92 });
    }
  }

  return doc.save();
}
