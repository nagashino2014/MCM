// 흐름형 문서 PDF 렌더러(2026-09-22) — FlowBlock(types.ts)을 A4 여러 쪽으로 흘려 그린다.
// 줄바꿈·표 배치는 공문 렌더러(lib/letter/pdf.ts) 헬퍼를 그대로 쓰고, 쪽 넘김·표 행 나눔·음영 머리칸·
// 서명줄(직인)만 여기서 더한다. HWPX 작성기(hwpx.ts)와 같은 블록을 입력으로 받는다.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { drawTable, layoutTable, loadImage, segsWidth, wrapRuns, type Fonts, type StyledSeg } from "@/lib/letter/pdf";
import { CONTENT_W, MARGIN_L, PAGE_H, PAGE_W } from "@/lib/letter/types";
import type { FlowBlock, FlowTable } from "./types";

const INK = rgb(0.1, 0.1, 0.12);
const SHADE = rgb(0.93, 0.93, 0.93);
const DEFAULT_PT = 11;
const LINE_FACTOR = 1.6;
const TOP_Y = PAGE_H - 56;
const BOTTOM_Y = 64;

/** 표를 쪽 경계에서 나눌 수 있는 행 묶음 — 세로 병합이 경계를 넘지 않게 끊는다(내부고시 렌더러와 같은 규칙). */
function rowGroups(t: FlowTable): number[][] {
  const groups: number[][] = [];
  let cur: number[] = [];
  let maxEnd = -1;
  t.rows.forEach((row, ri) => {
    cur.push(ri);
    row.forEach((cell) => {
      if (!cell.covered) maxEnd = Math.max(maxEnd, ri + (cell.rowSpan ?? 1) - 1);
    });
    if (maxEnd <= ri) {
      groups.push(cur);
      cur = [];
    }
  });
  if (cur.length) groups.push(cur);
  return groups;
}

export async function renderFlowPdf(blocks: FlowBlock[], opts: { pageNumbers?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const fonts: Fonts = {
    regular: await doc.embedFont(await readFile(path.join(fontsDir, "malgun.ttf")), { subset: true }),
    bold: await doc.embedFont(await readFile(path.join(fontsDir, "malgunbd.ttf")), { subset: true }),
  };
  const needsStamp = blocks.some((b) => b.kind === "seal" && b.stamp);
  const stamp = needsStamp ? await loadImage(doc, "letter/stamp.png") : null;

  const pages: PDFPage[] = [];
  let page = doc.addPage([PAGE_W, PAGE_H]);
  pages.push(page);
  let y = TOP_Y;
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = TOP_Y;
  };
  const ensure = (h: number) => {
    if (y - h < BOTTOM_Y && y < TOP_Y) newPage();
  };

  const drawSegs = (segs: StyledSeg[], x: number, size: number, forceBold: boolean) => {
    let cx = x;
    for (const s of segs) {
      const font = s.bold || forceBold ? fonts.bold : fonts.regular;
      page.drawText(s.text, { x: cx, y: y - size, size, font, color: INK });
      const w = font.widthOfTextAtSize(s.text, size);
      if (s.underline) {
        page.drawLine({ start: { x: cx, y: y - size - 1.5 }, end: { x: cx + w, y: y - size - 1.5 }, thickness: 0.5, color: INK });
      }
      cx += w;
    }
  };

  for (const b of blocks) {
    if (b.kind === "p") {
      const size = b.sizePt ?? DEFAULT_PT;
      const lineH = size * LINE_FACTOR;
      if (b.spaceBeforePt && y < TOP_Y) y -= b.spaceBeforePt;
      const runs = b.bold ? b.runs.map((r) => ({ ...r, bold: true })) : b.runs;
      const left = MARGIN_L + (b.leftPt ?? 0);
      const firstX = left + (b.indentPt ?? 0);
      const right = MARGIN_L + CONTENT_W;
      const lines = b.align && b.align !== "left"
        ? wrapRuns(runs, fonts, size, right - left, right - left)
        : wrapRuns(runs, fonts, size, right - firstX, right - left);
      lines.forEach((segs, i) => {
        ensure(lineH);
        let x = i === 0 ? firstX : left;
        if (b.align === "center" || b.align === "right") {
          const w = segsWidth(segs, fonts, size);
          x = b.align === "center" ? left + (right - left - w) / 2 : right - w;
        }
        drawSegs(segs, x, size, false);
        y -= lineH;
      });
      y -= 2;
    } else if (b.kind === "rule") {
      if (b.spaceBeforePt) y -= b.spaceBeforePt;
      ensure(10);
      page.drawLine({ start: { x: MARGIN_L, y }, end: { x: MARGIN_L + CONTENT_W, y }, thickness: 2.2, color: INK });
      y -= 16;
    } else if (b.kind === "table") {
      const size = b.sizePt ?? DEFAULT_PT;
      const shade = new Set(b.shadeCols ?? []);
      for (const g of rowGroups(b.table)) {
        const sub: FlowTable = { ...b.table, rows: g.map((ri) => b.table.rows[ri]), rowRatios: undefined };
        const lay = layoutTable(sub, fonts, size);
        const h = lay.rowHs.reduce((a, c) => a + c, 0);
        ensure(h);
        if (shade.size) {
          // 머리칸 음영 — drawTable 과 같은 좌표 규칙으로 먼저 칠하고 그 위에 표를 그린다
          const tableW = lay.widths.reduce((a, c) => a + c, 0);
          const x0 = MARGIN_L + 1 + Math.max(0, (CONTENT_W - 2 - tableW) / 2);
          let ry = y;
          sub.rows.forEach((row, ri) => {
            let cx = x0;
            row.forEach((cell, ci) => {
              const cw = lay.widths.slice(ci, ci + (cell.colSpan ?? 1)).reduce((a, c) => a + c, 0);
              const ch = lay.rowHs.slice(ri, ri + (cell.rowSpan ?? 1)).reduce((a, c) => a + c, 0);
              if (!cell.covered && shade.has(ci)) page.drawRectangle({ x: cx, y: ry - ch, width: cw, height: ch, color: SHADE });
              cx += lay.widths[ci];
            });
            ry -= lay.rowHs[ri];
          });
        }
        y = drawTable(page, sub, fonts, size, y);
      }
      y -= 8;
    } else if (b.kind === "seal") {
      const size = b.sizePt;
      if (b.spaceBeforePt) y -= b.spaceBeforePt;
      ensure(size * 2.4);
      const gap = size * 1.6;
      const headW = fonts.bold.widthOfTextAtSize(b.text, size);
      const sealW = fonts.bold.widthOfTextAtSize(b.sealText, size);
      const x = (PAGE_W - (headW + gap + sealW)) / 2;
      page.drawText(b.text, { x, y: y - size, size, font: fonts.bold, color: INK });
      const sealX = x + headW + gap;
      page.drawText(b.sealText, { x: sealX, y: y - size, size, font: fonts.bold, color: INK });
      if (b.stamp && stamp) {
        const stampW = 52;
        const stampH = (stamp.height / stamp.width) * stampW;
        page.drawImage(stamp, { x: sealX + sealW / 2 - stampW / 2, y: y - size / 2 - stampH / 2 - 2, width: stampW, height: stampH, opacity: 0.92 });
      }
      y -= size * LINE_FACTOR;
    }
  }

  if (opts.pageNumbers && pages.length > 1) {
    pages.forEach((p, i) => {
      const t = `- ${i + 1} -`;
      const w = fonts.regular.widthOfTextAtSize(t, 9);
      p.drawText(t, { x: (PAGE_W - w) / 2, y: 30, size: 9, font: fonts.regular, color: INK });
    });
  }
  return await doc.save();
}
