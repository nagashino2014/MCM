import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  cellAmount,
  cellAutoAmount,
  paymentSplit,
  rateCardGroupNames,
  rateCardGroupTotal,
  rateCardTotal,
  roundTotal,
  validPayments,
  type RateCardData,
} from "@/lib/contracts/rate-card";

/*
 * 단가 계약 내역서 PDF(2026-10-16 사용자 요청) — 변경계약 입력의 '단가 계약' 탭 내용을 그대로 출력한다.
 *   ① 단가 기준표  ② 차수표(항목×차수 수량·금액, 차수 소계·항목 합계)  ③ 차수별 소계·지급 단위 분해(또는 구분별 소계)
 * A4 가로. 차수가 많으면 차수 열을 여러 쪽으로 나누고(항목 열은 매 쪽 반복), 행이 넘치면 머리글을 반복한다.
 * 화면에 보이는 그대로(저장 전 변경 포함) 그리며, 저장 전이면 머리글에 표시한다.
 * 글꼴·격자 규칙은 성과급 명세서(lib/bonus/statement-pdf.ts)와 같다.
 */

export interface RateCardPdfInput {
  contractTitle: string;
  counterpartyName: string;
  contractDate: string | null;
  printedAt: string;
  /** 저장 전 변경이 섞여 있으면 true — 머리글에 표시 */
  unsaved: boolean;
  card: RateCardData;
}

const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
const MARGIN_X = 36;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 40;
const TABLE_W = PAGE_W - MARGIN_X * 2;
const ROW_H = 18;
const FONT_SIZE = 8.5;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.47);
const LINE = rgb(0.55, 0.55, 0.6);
const SHADE = rgb(0.945, 0.95, 0.965);
const WARN = rgb(0.75, 0.33, 0.05);

let fontCache: { regular: Buffer; bold: Buffer } | null = null;

async function loadFonts(): Promise<{ regular: Buffer; bold: Buffer }> {
  if (fontCache) return fontCache;
  const dir = path.join(process.cwd(), "public", "fonts");
  fontCache = {
    regular: await readFile(path.join(dir, "malgun.ttf")),
    bold: await readFile(path.join(dir, "malgunbd.ttf")),
  };
  return fontCache;
}

const won = (v: number) => (v ? Math.round(v).toLocaleString("ko-KR") : "");
const digits = (v: unknown) => String(v ?? "").replace(/[^0-9]/g, "");
const priceText = (v: string) => (digits(v) ? Number(digits(v)).toLocaleString("ko-KR") : "");
const qtyText = (v: string | undefined) => {
  const s = String(v ?? "").trim();
  return s && Number(s) !== 0 ? s : "";
};

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

type Align = "left" | "center" | "right";

interface Col {
  width: number;
  align: Align;
}

interface Cell {
  text: string;
  /** 머리글 셀이 차지하는 열 수(기본 1) */
  span?: number;
  align?: Align;
  color?: ReturnType<typeof rgb>;
}

interface BodyRow {
  cells: Cell[];
  shade?: boolean;
  bold?: boolean;
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - MARGIN_TOP;
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN_BOTTOM) newPage(ctx);
}

function drawCell(ctx: Ctx, x: number, width: number, top: number, cell: Cell, font: PDFFont, shade: boolean, fallback: Align) {
  const { page } = ctx;
  if (shade) page.drawRectangle({ x, y: top - ROW_H, width, height: ROW_H, color: SHADE });
  page.drawRectangle({ x, y: top - ROW_H, width, height: ROW_H, borderColor: LINE, borderWidth: 0.5 });
  if (!cell.text) return;
  const pad = 4;
  const maxW = width - pad * 2;
  const size = fitSize(cell.text, font, maxW, FONT_SIZE, 6.5);
  const shown = truncate(cell.text, font, size, maxW);
  const w = font.widthOfTextAtSize(shown, size);
  const align = cell.align ?? fallback;
  const tx = align === "center" ? x + (width - w) / 2 : align === "right" ? x + width - pad - w : x + pad;
  page.drawText(shown, { x: tx, y: top - ROW_H / 2 - size * 0.34, size, font, color: cell.color ?? INK });
}

/** 머리글(여러 줄·열 병합) + 본문 — 쪽이 넘치면 머리글을 반복한다. */
function drawTable(ctx: Ctx, cols: Col[], headerRows: Cell[][], body: BodyRow[]) {
  const xs = [MARGIN_X];
  for (const c of cols) xs.push(xs[xs.length - 1] + c.width);

  const drawHeader = () => {
    for (const row of headerRows) {
      let ci = 0;
      for (const cell of row) {
        const span = cell.span ?? 1;
        drawCell(ctx, xs[ci], xs[ci + span] - xs[ci], ctx.y, { ...cell, align: cell.align ?? "center" }, ctx.bold, true, "center");
        ci += span;
      }
      ctx.y -= ROW_H;
    }
  };

  ensureSpace(ctx, ROW_H * (headerRows.length + 1));
  drawHeader();
  for (const row of body) {
    if (ctx.y - ROW_H < MARGIN_BOTTOM) {
      newPage(ctx);
      drawHeader();
    }
    row.cells.forEach((cell, i) => {
      drawCell(ctx, xs[i], cols[i].width, ctx.y, cell, row.bold ? ctx.bold : ctx.regular, !!row.shade, cols[i].align);
    });
    ctx.y -= ROW_H;
  }
}

/**
 * 소제목. keepRows 를 주면 그 행 수(머리글 포함)가 한 쪽에 들어가는 작은 표일 때 제목과 함께 통째로 다음 쪽으로 넘긴다
 * — 두세 행만 쪽 끝에 걸리고 나머지가 넘어가는 것을 막는다.
 */
function sectionTitle(ctx: Ctx, text: string, note?: string, keepRows = 2) {
  const need = 26 + ROW_H * keepRows;
  const usable = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM;
  ensureSpace(ctx, need <= usable ? need : 26 + ROW_H * 2);
  ctx.y -= 6;
  ctx.page.drawText(text, { x: MARGIN_X, y: ctx.y - 11, size: 11, font: ctx.bold, color: INK });
  if (note) {
    const w = ctx.bold.widthOfTextAtSize(text, 11);
    ctx.page.drawText(note, { x: MARGIN_X + w + 8, y: ctx.y - 11, size: 8, font: ctx.regular, color: MUTED });
  }
  ctx.y -= 20;
}

/** 열 너비를 비율로 나눠 TABLE_W 를 채운다(고정 폭 열은 그대로). */
function spread(fixed: number[], flexIndex: number): number[] {
  const used = fixed.reduce((a, b, i) => (i === flexIndex ? a : a + b), 0);
  return fixed.map((w, i) => (i === flexIndex ? Math.max(60, TABLE_W - used) : w));
}

export async function renderRateCardPdf(input: RateCardPdfInput): Promise<Uint8Array> {
  const fontBytes = await loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fontBytes.regular, { subset: true });
  const bold = await doc.embedFont(fontBytes.bold, { subset: true });
  const ctx: Ctx = { doc, page: doc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN_TOP, regular, bold };

  const { card } = input;
  const dual = card.dualPrice;

  // ── 제목 + 이중 구분선 ──
  const title = "단가 계약 내역서";
  const tw = bold.widthOfTextAtSize(title, 17);
  ctx.page.drawText(title, { x: (PAGE_W - tw) / 2, y: ctx.y - 14, size: 17, font: bold, color: INK });
  ctx.y -= 24;
  ctx.page.drawLine({ start: { x: MARGIN_X, y: ctx.y }, end: { x: PAGE_W - MARGIN_X, y: ctx.y }, thickness: 1.4, color: INK });
  ctx.page.drawLine({ start: { x: MARGIN_X, y: ctx.y - 3 }, end: { x: PAGE_W - MARGIN_X, y: ctx.y - 3 }, thickness: 0.5, color: INK });
  ctx.y -= 14;

  // ── 계약 정보 ──
  {
    const label = 56;
    const cols = spread([label, 0, label, 170, label, 80, label, 80], 1).map((width, i) => ({
      width,
      align: (i % 2 === 0 ? "center" : "left") as Align,
    }));
    drawTable(ctx, cols, [], [
      {
        cells: [
          { text: "계약명", align: "center" },
          { text: input.contractTitle },
          { text: "업체", align: "center" },
          { text: input.counterpartyName || "-" },
          { text: "계약일", align: "center" },
          { text: input.contractDate || "-" },
          { text: "출력일", align: "center" },
          { text: input.printedAt },
        ],
      },
    ]);
    if (input.unsaved) {
      ctx.page.drawText("※ 저장 전 내용 포함 — 변경계약 입력 화면에서 아직 저장하지 않은 단가·수량이 반영되어 있습니다.", {
        x: MARGIN_X,
        y: ctx.y - 11,
        size: 8,
        font: bold,
        color: WARN,
      });
      ctx.y -= 16;
    }
  }

  // ── ① 단가 기준표 ──
  sectionTitle(ctx, "① 단가 기준표", dual ? "허가/신고 단가 구분" : undefined, card.items.length + 1);
  if (card.items.length === 0) {
    ctx.page.drawText("단가 기준표에 항목이 없습니다.", { x: MARGIN_X, y: ctx.y - 10, size: 9, font: regular, color: MUTED });
    ctx.y -= 18;
  } else {
    const widths = dual ? [110, 0, 50, 90, 90, 150] : [110, 0, 50, 100, 170];
    const cols = spread(widths, 1).map((width, i) => ({
      width,
      align: (dual ? [3, 4] : [3]).includes(i) ? ("right" as Align) : i === 2 ? ("center" as Align) : ("left" as Align),
    }));
    const header: Cell[] = dual
      ? [{ text: "구분" }, { text: "항목 (세부내용)" }, { text: "단위" }, { text: "허가 단가" }, { text: "신고 단가" }, { text: "비고" }]
      : [{ text: "구분" }, { text: "항목 (세부내용)" }, { text: "단위" }, { text: "단가" }, { text: "비고" }];
    drawTable(
      ctx,
      cols,
      [header],
      card.items.map((it) => ({
        cells: dual
          ? [{ text: it.groupName }, { text: it.name }, { text: it.unit }, { text: priceText(it.unitPrice) }, { text: priceText(it.unitPrice2) }, { text: it.note }]
          : [{ text: it.groupName }, { text: it.name }, { text: it.unit }, { text: priceText(it.unitPrice) }, { text: it.note }],
      }))
    );
  }

  // ── ② 차수표 — 차수 열을 쪽 너비에 맞게 나눈다 ──
  let hasOverride = false;
  if (card.rounds.length > 0 && card.items.length > 0) {
    // 수량·금액 열은 좁게 두고 남는 폭은 항목 열에 준다 — 이중 단가 차수 4개 정도가 한 표에 들어간다.
    const minItemW = 150;
    const totalW = 74;
    const qtyW = dual ? 34 : 40;
    const amtW = 68;
    const roundW = dual ? qtyW * 2 + amtW : qtyW + amtW;
    const perPage = Math.max(1, Math.floor((TABLE_W - minItemW - totalW) / roundW));
    const chunks: (typeof card.rounds)[] = [];
    for (let i = 0; i < card.rounds.length; i += perPage) chunks.push(card.rounds.slice(i, i + perPage));

    chunks.forEach((rounds, chunkIndex) => {
      const last = chunkIndex === chunks.length - 1;
      const note = chunks.length > 1 ? `차수 ${chunkIndex * perPage + 1}~${chunkIndex * perPage + rounds.length} / 전체 ${card.rounds.length}개` : undefined;
      const qtyNote = dual ? "수량은 허가 / 신고" : undefined;
      sectionTitle(
        ctx,
        chunkIndex === 0 ? "② 차수표" : "② 차수표 (계속)",
        [note, qtyNote].filter(Boolean).join(" · ") || undefined,
        card.items.length + 3
      );

      const itemW = TABLE_W - rounds.length * roundW - (last ? totalW : 0);
      const cols: Col[] = [{ width: itemW, align: "left" }];
      const head1: Cell[] = [{ text: "항목", span: 1 }];
      const head2: Cell[] = [{ text: "구분 · 항목 (단위)" }];
      for (const r of rounds) {
        head1.push({ text: r.date ? `${r.label || "차수"} (${r.date})` : r.label || "차수", span: dual ? 3 : 2 });
        if (dual) {
          cols.push({ width: qtyW, align: "right" }, { width: qtyW, align: "right" }, { width: amtW, align: "right" });
          head2.push({ text: "허가" }, { text: "신고" }, { text: "금액" });
        } else {
          cols.push({ width: qtyW, align: "right" }, { width: amtW, align: "right" });
          head2.push({ text: "수량" }, { text: "금액" });
        }
      }
      if (last) {
        cols.push({ width: totalW, align: "right" });
        head1.push({ text: "전 차수", span: 1 });
        head2.push({ text: "항목 합계" });
      }

      const body: BodyRow[] = card.items.map((it) => {
        const label = [it.groupName, it.name].filter(Boolean).join(" · ") + (it.unit ? ` (${it.unit})` : "");
        const cells: Cell[] = [{ text: label }];
        for (const r of rounds) {
          const cell = r.cells[it.id];
          const amount = cellAmount(it, cell);
          const overridden = cell?.amount != null && cell.amount !== "" && amount !== cellAutoAmount(it, cell);
          if (overridden) hasOverride = true;
          if (dual) cells.push({ text: qtyText(cell?.qty) }, { text: qtyText(cell?.qty2) });
          else cells.push({ text: qtyText(cell?.qty) });
          cells.push({ text: amount ? won(amount) + (overridden ? " *" : "") : "", color: overridden ? WARN : undefined });
        }
        if (last) {
          const rowTotal = card.rounds.reduce((acc, r) => acc + cellAmount(it, r.cells[it.id]), 0);
          cells.push({ text: won(rowTotal) });
        }
        return { cells };
      });
      const totalCells: Cell[] = [{ text: "차수 소계", align: "center" }];
      for (const r of rounds) {
        if (dual) totalCells.push({ text: "" }, { text: "" });
        else totalCells.push({ text: "" });
        totalCells.push({ text: won(roundTotal(card, r)) });
      }
      if (last) totalCells.push({ text: won(rateCardTotal(card)) });
      body.push({ cells: totalCells, shade: true, bold: true });

      drawTable(ctx, cols, [head1, head2], body);
    });
    if (hasOverride) {
      ensureSpace(ctx, 14);
      ctx.page.drawText("* 단가×수량 자동 계산값을 직접 고친(수동 보정) 금액", { x: MARGIN_X, y: ctx.y - 10, size: 7.5, font: regular, color: WARN });
      ctx.y -= 14;
    }
  }

  // ── ③ 요약 — 구분 소계 모드(차수 1개·지급 단위 없음) / 차수별 소계·지급 단위 분해 ──
  const groupMode = card.rounds.length === 1 && validPayments(card.rounds[0]).length === 0;
  if (groupMode) {
    const groups = rateCardGroupNames(card);
    if (groups.length > 0) {
      sectionTitle(ctx, "③ 구분별 소계", "청구 단계 금액", groups.length + 2);
      const cols = spread([0, 160], 0).map((width, i) => ({ width, align: (i === 1 ? "right" : "left") as Align }));
      drawTable(ctx, cols, [[{ text: "구분" }, { text: "소계" }]], [
        ...groups.map((g) => ({ cells: [{ text: g }, { text: won(rateCardGroupTotal(card, g)) }] })),
        { cells: [{ text: "총계", align: "center" as Align }, { text: won(rateCardTotal(card)) }], shade: true, bold: true },
      ]);
    }
  } else if (card.rounds.length > 0) {
    sectionTitle(ctx, "③ 차수별 소계 · 지급 단위 분해", undefined, card.rounds.length + 2);
    const cols = spread([150, 80, 110, 0], 3).map((width, i) => ({
      width,
      align: (i === 2 ? "right" : i === 1 ? "center" : "left") as Align,
    }));
    const rows: BodyRow[] = card.rounds.map((r) => {
      const total = roundTotal(card, r);
      const split = total > 0 ? paymentSplit(total, r.payments) : [];
      return {
        cells: [
          { text: r.label || "차수" },
          { text: r.date || "" },
          { text: won(total) },
          { text: split.map((s) => `${s.label} ${s.ratePct}% ${won(s.amount)}`).join("  /  ") },
        ],
      };
    });
    rows.push({ cells: [{ text: "총계", align: "center" }, { text: "" }, { text: won(rateCardTotal(card)) }, { text: "" }], shade: true, bold: true });
    drawTable(ctx, cols, [[{ text: "차수" }, { text: "기준일" }, { text: "소계" }, { text: "지급 단위 (비율 · 금액)" }]], rows);
  }

  // ── 쪽 번호 ──
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const text = `${input.contractTitle} — 단가 계약 내역서   ${i + 1} / ${pages.length}`;
    const size = 7.5;
    const shown = truncate(text, regular, size, TABLE_W);
    const w = regular.widthOfTextAtSize(shown, size);
    p.drawText(shown, { x: (PAGE_W - w) / 2, y: 20, size, font: regular, color: MUTED });
  });

  return doc.save();
}
