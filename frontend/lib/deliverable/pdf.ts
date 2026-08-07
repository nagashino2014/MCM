// 착수계·준공계 PDF 렌더러 — DeliverableSpec(블록) → A4 페이지. 서식 1종 = 1페이지.
// lib/letter/pdf.ts 의 폰트 embed(맑은 고딕)·줄바꿈·인감(public/letter/stamp.png) 패턴을 이식하되,
// 공문의 고정 프레임(헤더·하단 고정부·1장 강제)은 없다 — 블록을 위에서부터 흘려 배치한다.
// 기본양식(catalog.ts 상수)과 발주처 자체양식(deliverable_templates.spec)이 같은 경로로 렌더된다.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { numberPrefix, renderBinding, renderSlot, renderTemplate, spreadName } from "./format";
import {
  DEFAULT_BODY_PT,
  DEFAULT_MARGINS,
  DEFAULT_TITLE_PT,
  PAGE_H,
  PAGE_W,
  type Align,
  type CellSpec,
  type DeliverableSpec,
  type DeliverableValues,
  type DocBlock,
  type FieldRow,
  type Margins,
} from "./types";

const INK = rgb(0.1, 0.1, 0.12);
const LINE = 0.9;

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** 폭에 맞춰 줄바꿈(한글은 글자 단위 폴백) — letter/pdf.ts wrapPlain 이식. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of String(text ?? "").split(/\r?\n/)) {
    let cur = "";
    for (const word of para.split(/\s+/)) {
      const cand = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(cand, size) <= maxWidth) {
        cur = cand;
        continue;
      }
      if (cur) lines.push(cur);
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = "";
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        cur = chunk;
      } else {
        cur = word;
      }
    }
    lines.push(cur);
  }
  return lines.length ? lines : [""];
}

function alignX(align: Align | undefined, x: number, availW: number, textW: number): number {
  if (align === "center") return x + (availW - textW) / 2;
  if (align === "right") return x + availW - textW;
  return x;
}

/** 자간을 벌려 그린다(제목 "착 수 계"의 넓은 자간 재현). */
function drawSpaced(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, spacing: number) {
  let cx = x;
  for (const ch of text) {
    page.drawText(ch, { x: cx, y, size, font, color: INK });
    cx += font.widthOfTextAtSize(ch, size) + spacing;
  }
}

function spacedWidth(text: string, font: PDFFont, size: number, spacing: number): number {
  if (!text) return 0;
  return font.widthOfTextAtSize(text, size) + spacing * Math.max(0, text.length - 1);
}

async function loadStamp(doc: PDFDocument): Promise<PDFImage | null> {
  try {
    return await doc.embedPng(await readFile(path.join(process.cwd(), "public", "letter", "stamp.png")));
  } catch {
    return null;
  }
}

interface Ctx {
  page: PDFPage;
  fonts: Fonts;
  values: DeliverableValues;
  stamp: PDFImage | null;
  m: Margins;
  bodyPt: number;
  contentW: number;
}

/** fields 블록 — 라벨 열 정렬 + 값(필요 시 둘째 행). */
function drawFields(
  ctx: Ctx,
  block: Extract<DocBlock, { kind: "fields" }>,
  y: number
): number {
  const { page, fonts, values } = ctx;
  const size = ctx.bodyPt;
  const lineH = size * 1.5;
  const gap = block.rowGapPt ?? 8;
  const indent = block.indentPt ?? 0;
  const x0 = ctx.m.left + indent;

  // 라벨 열 폭 = (번호접두 + 최장 라벨) 실측
  const labelTexts = block.rows.map((r, i) => numberPrefix(block.numbering, i) + r.label);
  const labelW = block.labelWidthPt ?? Math.max(...labelTexts.map((t) => fonts.regular.widthOfTextAtSize(t, size)));
  const sep = " : ";
  const sepW = fonts.regular.widthOfTextAtSize(sep, size);
  const valueX = x0 + labelW + sepW;
  const valueW = PAGE_W - ctx.m.right - valueX;

  block.rows.forEach((row: FieldRow, i) => {
    page.drawText(labelTexts[i], { x: x0, y: y - size, size, font: fonts.regular, color: INK });
    page.drawText(":", { x: x0 + labelW + sepW / 2 - 2, y: y - size, size, font: fonts.regular, color: INK });
    const value = renderSlot(row, values);
    const lines = wrap(value, fonts.regular, size, valueW);
    lines.forEach((ln, li) => {
      page.drawText(ln, { x: valueX, y: y - size, size, font: fonts.regular, color: INK });
      if (li < lines.length - 1) y -= lineH;
    });
    if (row.secondLine) {
      y -= lineH;
      const second = renderSlot(row.secondLine, values);
      for (const ln of wrap(second, fonts.regular, size, valueW)) {
        page.drawText(ln, { x: valueX, y: y - size, size, font: fonts.regular, color: INK });
      }
    }
    y -= lineH + gap;
  });
  return y;
}

/** table 블록 — colSpan/rowSpan 병합 지원. 행 높이는 셀 줄 수 최대값 기준. */
function drawTable(ctx: Ctx, block: Extract<DocBlock, { kind: "table" }>, y: number): number {
  const { page, fonts, values } = ctx;
  const size = ctx.bodyPt - 1.5;
  const lineH = size * 1.35;
  const pad = 4;
  const x0 = ctx.m.left;
  const totalW = ctx.contentW;
  const colX: number[] = [];
  let acc = x0;
  for (const c of block.columns) {
    colX.push(acc);
    acc += totalW * c.widthRatio;
  }
  colX.push(acc);
  const colWidth = (ci: number, span: number) => colX[Math.min(ci + span, block.columns.length)] - colX[ci];

  if (block.caption) {
    page.drawText(renderTemplate(block.caption, values), {
      x: x0,
      y: y - ctx.bodyPt,
      size: ctx.bodyPt,
      font: fonts.regular,
      color: INK,
    });
    y -= ctx.bodyPt * 1.9;
  }

  // 1) 셀 텍스트·행 높이 산출
  const cellLines: string[][][] = block.rows.map((row) =>
    row.map((cell, ci) => {
      if (cell.merged) return [];
      const text = cell.binding ? renderBinding(cell.binding, values, cell.format) : renderTemplate(cell.text ?? "", values);
      return wrap(text, cell.bold ? fonts.bold : fonts.regular, size, colWidth(ci, cell.colSpan ?? 1) - pad * 2);
    })
  );
  const rowH = block.rows.map((row, ri) =>
    Math.max(
      lineH + pad * 2,
      ...row.map((cell, ci) => ((cell.rowSpan ?? 1) > 1 ? 0 : cellLines[ri][ci].length * lineH + pad * 2))
    )
  );

  // 2) 그리기
  let ry = y;
  block.rows.forEach((row, ri) => {
    let cx = 0;
    row.forEach((cell: CellSpec, ci) => {
      if (cell.merged) return;
      const span = cell.colSpan ?? 1;
      const rspan = cell.rowSpan ?? 1;
      const w = colWidth(ci, span);
      const h = rowH.slice(ri, ri + rspan).reduce((a, b) => a + b, 0);
      page.drawRectangle({ x: colX[ci], y: ry - h, width: w, height: h, borderColor: INK, borderWidth: LINE });
      const font = cell.bold ? fonts.bold : fonts.regular;
      const lines = cellLines[ri][ci];
      const textH = lines.length * lineH;
      let ty = ry - (h - textH) / 2 - size;
      for (const ln of lines) {
        const tw = font.widthOfTextAtSize(ln, size);
        const align = cell.align ?? block.columns[ci]?.align ?? "left";
        page.drawText(ln, { x: alignX(align, colX[ci] + pad, w - pad * 2, tw), y: ty, size, font, color: INK });
        ty -= lineH;
      }
      cx += 1;
    });
    ry -= rowH[ri];
  });
  return ry;
}

/** signature 블록 — 우측 정렬 라벨:값. 마지막 행 옆에 인감을 겹쳐 찍는다. */
function drawSignature(ctx: Ctx, block: Extract<DocBlock, { kind: "signature" }>, y: number): number {
  const { page, fonts, values } = ctx;
  const size = ctx.bodyPt;
  const lineH = size * 1.7;
  const labelW = Math.max(...block.rows.map((r) => fonts.regular.widthOfTextAtSize(r.label, size)));
  const sepW = fonts.regular.widthOfTextAtSize(" : ", size);
  // 값 중 최장 폭 기준으로 블록 좌표를 잡고 우측 여백에서 띄운다.
  // 대표자 성명은 실물처럼 벌려 쓴다("이 유 억") — HWPX 렌더러와 동일 규칙.
  const valueTexts = block.rows.map((r) =>
    r.binding === "company.ceo" ? renderSlot({ ...r, binding: undefined, text: spreadName(renderBinding("company.ceo", values)) }, values) : renderSlot(r, values)
  );
  const valueW = Math.max(...valueTexts.map((t) => fonts.regular.widthOfTextAtSize(t, size)));
  const blockW = labelW + sepW + valueW;
  const rightPad = 40; // 인감 여유
  const x0 =
    block.align === "left" ? ctx.m.left : Math.max(ctx.m.left, PAGE_W - ctx.m.right - blockW - rightPad);
  const valueX = x0 + labelW + sepW;

  const valueMaxW = PAGE_W - ctx.m.right - valueX;
  block.rows.forEach((row, i) => {
    page.drawText(row.label, { x: x0, y: y - size, size, font: fonts.regular, color: INK });
    page.drawText(":", { x: x0 + labelW + sepW / 2 - 2, y: y - size, size, font: fonts.regular, color: INK });
    const text = valueTexts[i];
    // 주소처럼 긴 값은 접되, 둘째 줄부터 값 시작 위치에 맞춰 들여쓴다(HWPX 와 동일 규칙)
    const lines = fonts.regular.widthOfTextAtSize(text, size) > valueMaxW ? wrap(text, fonts.regular, size, valueMaxW) : [text];
    lines.forEach((ln, li) => {
      page.drawText(ln, { x: valueX, y: y - size - li * lineH, size, font: fonts.regular, color: INK });
    });
    const extra = (lines.length - 1) * lineH;
    // 인감: 대표자 행(마지막 행)의 값 오른쪽 끝에 겹치게
    if (block.stamp && ctx.stamp && i === block.rows.length - 1) {
      const tw = fonts.regular.widthOfTextAtSize(text, size);
      const stampW = 44;
      const stampH = (ctx.stamp.height / ctx.stamp.width) * stampW;
      // 실물 규칙: 인감 중심이 말미 "(인)" 위에 오고 세로는 성명 줄에 걸친다
      page.drawImage(ctx.stamp, {
        x: valueX + tw - stampW * 0.62,
        y: y - size - stampH * 0.4,
        width: stampW,
        height: stampH,
        opacity: 0.92,
      });
    }
    y -= lineH + extra; // 접힌 줄 수만큼 아래로
  });
  return y;
}

function drawBlock(ctx: Ctx, block: DocBlock, y: number): number {
  const { page, fonts, values } = ctx;
  switch (block.kind) {
    case "note": {
      const size = ctx.bodyPt - 1;
      const text = renderTemplate(block.text, values);
      const w = fonts.regular.widthOfTextAtSize(text, size);
      page.drawText(text, {
        x: alignX(block.align ?? "left", ctx.m.left, ctx.contentW, w),
        y: y - size,
        size,
        font: fonts.regular,
        color: INK,
      });
      return y - size * 2.2;
    }
    case "title": {
      const size = block.fontPt ?? DEFAULT_TITLE_PT;
      const spacing = block.letterSpacingPt ?? 0;
      const text = renderTemplate(block.text, values);
      const w = spacedWidth(text, fonts.bold, size, spacing);
      const x = ctx.m.left + (ctx.contentW - w) / 2;
      drawSpaced(page, text, x, y - size, fonts.bold, size, spacing);
      if (block.underline) {
        page.drawLine({ start: { x, y: y - size - 4 }, end: { x: x + w, y: y - size - 4 }, thickness: 1, color: INK });
      }
      return y - size * 1.5;
    }
    case "fields":
      return drawFields(ctx, block, y);
    case "table":
      return drawTable(ctx, block, y);
    case "para": {
      const size = ctx.bodyPt;
      const lineH = size * ((block.lineHeightPct ?? 160) / 100);
      const indent = block.indentPt ?? 0;
      const x = ctx.m.left + indent;
      const availW = PAGE_W - ctx.m.right - x;
      for (const ln of wrap(renderTemplate(block.text, values), fonts.regular, size, availW)) {
        const w = fonts.regular.widthOfTextAtSize(ln, size);
        page.drawText(ln, { x: alignX(block.align ?? "left", x, availW, w), y: y - size, size, font: fonts.regular, color: INK });
        y -= lineH;
      }
      return y;
    }
    case "dateLine": {
      const size = ctx.bodyPt;
      const text = renderBinding(block.binding, values, block.format);
      const w = fonts.regular.widthOfTextAtSize(text, size);
      page.drawText(text, {
        x: alignX(block.align ?? "center", ctx.m.left, ctx.contentW, w),
        y: y - size,
        size,
        font: fonts.regular,
        color: INK,
      });
      return y - size * 1.8;
    }
    case "signature":
      return drawSignature(ctx, block, y);
    case "receiver": {
      const size = block.fontPt ?? ctx.bodyPt + 3;
      const font = block.bold === false ? fonts.regular : fonts.bold;
      const text = `${renderBinding(block.binding, values)} ${block.suffix}`.trim();
      const w = font.widthOfTextAtSize(text, size);
      page.drawText(text, {
        x: alignX(block.align ?? "left", ctx.m.left, ctx.contentW, w),
        y: y - size,
        size,
        font,
        color: INK,
      });
      return y - size * 1.8;
    }
    case "stampBox": {
      const size = ctx.bodyPt - 2;
      const w = block.widthPt ?? 96;
      const h = block.heightPt ?? 46;
      const x = PAGE_W - ctx.m.right - w;
      page.drawRectangle({ x, y: y - h, width: w, height: h, borderColor: INK, borderWidth: LINE });
      page.drawLine({ start: { x, y: y - size * 1.7 }, end: { x: x + w, y: y - size * 1.7 }, thickness: LINE, color: INK });
      const label = renderTemplate(block.label, ctx.values);
      const lw = fonts.regular.widthOfTextAtSize(label, size);
      page.drawText(label, { x: x + (w - lw) / 2, y: y - size * 1.35, size, font: fonts.regular, color: INK });
      return y - h - 6;
    }
    case "spacer":
      return y - block.heightPt;
    default:
      return y;
  }
}

/** 서식 여러 종을 순서대로 이어 붙여 1개 PDF 로 생성한다. */
export async function renderDeliverablePdf(specs: DeliverableSpec[], values: DeliverableValues): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const fonts: Fonts = {
    regular: await doc.embedFont(await readFile(path.join(fontsDir, "malgun.ttf")), { subset: true }),
    bold: await doc.embedFont(await readFile(path.join(fontsDir, "malgunbd.ttf")), { subset: true }),
  };
  const stamp = await loadStamp(doc);

  for (const spec of specs) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const m: Margins = { ...DEFAULT_MARGINS, ...(spec.page?.margins ?? {}) };
    const ctx: Ctx = {
      page,
      fonts,
      values,
      stamp,
      m,
      bodyPt: spec.page?.bodyPt ?? DEFAULT_BODY_PT,
      contentW: PAGE_W - m.left - m.right,
    };
    let y = PAGE_H - m.top;
    // stampBox 는 문서 우상단 고정 — 먼저 그리고 본문 y 는 유지한다
    for (const block of spec.blocks) {
      if (block.kind === "stampBox") {
        drawBlock(ctx, block, y);
        continue;
      }
      y = drawBlock(ctx, block, y);
    }
  }

  return await doc.save();
}
