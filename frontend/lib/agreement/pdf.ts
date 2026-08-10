// 계약서 PDF 렌더러 — 갑지(DocBlock, 1페이지) + 조문(다페이지 흐름).
// lib/deliverable/pdf.ts 를 이식하되(폰트 폴백·표 병합·블록 문법 동일), 착수계와 달리
// 조문이 여러 페이지로 흐르므로 줄 단위 페이지 브레이크를 지원한다(조 제목은 고아 방지).
// 갑지는 착수계처럼 1페이지 전제다 — 표준 갑지 실측(A·B형)이 모두 1장 구성이라 fit 은 두지 않는다.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { renderBinding, renderTemplate } from "@/lib/deliverable/format";
import {
  DEFAULT_MARGINS,
  PAGE_H,
  PAGE_W,
  type Align,
  type CellSpec,
  type DeliverableValues,
  type DocBlock,
  type Margins,
} from "@/lib/deliverable/types";
import { buildCoverValues, resolveClauses } from "./compose";
import type { AgreementFieldValues, AgreementSpec } from "./types";

const INK = rgb(0.1, 0.1, 0.12);
const LINE = 0.9;
const BODY_PT = 11;
const TITLE_PT = 20;

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** 폭에 맞춰 줄바꿈(한글은 글자 단위 폴백) — deliverable/pdf.ts wrap 이식 */
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

/** 자간 벌림(제목 "도 급 계 약 서") */
function drawSpaced(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, spacing: number) {
  let cx = x;
  for (const ch of text) {
    page.drawText(ch, { x: cx, y, size, font, color: INK });
    cx += font.widthOfTextAtSize(ch, size) + spacing;
  }
}

interface Flow {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  fonts: Fonts;
  values: DeliverableValues;
  m: Margins;
  contentW: number;
}

function newPage(flow: Flow): void {
  flow.page = flow.doc.addPage([PAGE_W, PAGE_H]);
  flow.y = PAGE_H - flow.m.top;
}

/** 남은 공간이 need 미만이면 페이지를 넘긴다 */
function ensure(flow: Flow, need: number): void {
  if (flow.y - need < flow.m.bottom) newPage(flow);
}

/** table 블록 — colSpan/rowSpan 병합 지원(deliverable/pdf.ts drawTable 이식, flow y 소비) */
function drawTable(flow: Flow, block: Extract<DocBlock, { kind: "table" }>): void {
  const { page, fonts, values } = flow;
  const size = BODY_PT - 0.5;
  const lineH = size * 1.35;
  const pad = 5;
  const x0 = flow.m.left;
  const colX: number[] = [];
  let acc = x0;
  for (const c of block.columns) {
    colX.push(acc);
    acc += flow.contentW * c.widthRatio;
  }
  colX.push(acc);
  const colWidth = (ci: number, span: number) => colX[Math.min(ci + span, block.columns.length)] - colX[ci];

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

  let ry = flow.y;
  block.rows.forEach((row, ri) => {
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
    });
    ry -= rowH[ri];
  });
  flow.y = ry;
}

/** 갑지 블록 1개 렌더 — 계약서 갑지가 쓰는 블록 종류만(table/para/dateLine/title/spacer) */
function drawCoverBlock(flow: Flow, block: DocBlock): void {
  const { page, fonts, values } = flow;
  switch (block.kind) {
    case "title": {
      const size = block.fontPt ?? TITLE_PT;
      const spacing = block.letterSpacingPt ?? 6;
      const text = renderTemplate(block.text, values);
      const w = fonts.bold.widthOfTextAtSize(text, size) + spacing * Math.max(0, text.length - 1);
      drawSpaced(page, text, flow.m.left + (flow.contentW - w) / 2, flow.y - size, fonts.bold, size, spacing);
      flow.y -= size * 1.6;
      return;
    }
    case "table":
      drawTable(flow, block);
      return;
    case "para": {
      const size = BODY_PT;
      const lineH = size * 1.6;
      const x = flow.m.left + (block.indentPt ?? 0);
      const availW = PAGE_W - flow.m.right - x;
      const text = renderTemplate(block.text, values);
      if (!text.trim()) return;
      for (const ln of wrap(text, fonts.regular, size, availW)) {
        const w = fonts.regular.widthOfTextAtSize(ln, size);
        page.drawText(ln, { x: alignX(block.align, x, availW, w), y: flow.y - size, size, font: fonts.regular, color: INK });
        flow.y -= lineH;
      }
      return;
    }
    case "dateLine": {
      const size = BODY_PT;
      const text = renderBinding(block.binding, values, block.format);
      const w = fonts.regular.widthOfTextAtSize(text, size);
      page.drawText(text, {
        x: alignX(block.align ?? "center", flow.m.left, flow.contentW, w),
        y: flow.y - size,
        size,
        font: fonts.regular,
        color: INK,
      });
      flow.y -= size * 1.8;
      return;
    }
    case "spacer":
      flow.y -= block.heightPt;
      return;
    default:
      return;
  }
}

/** 문단을 줄 단위 페이지 브레이크로 흘려 그린다(조문 본문용) */
function flowPara(
  flow: Flow,
  text: string,
  opts: { size?: number; lineHeight?: number; indentPt?: number; bold?: boolean; align?: Align } = {}
): void {
  const size = opts.size ?? BODY_PT;
  const lineH = size * (opts.lineHeight ?? 1.6);
  const x = flow.m.left + (opts.indentPt ?? 0);
  const availW = PAGE_W - flow.m.right - x;
  const font = opts.bold ? flow.fonts.bold : flow.fonts.regular;
  for (const ln of wrap(text, font, size, availW)) {
    ensure(flow, lineH);
    const w = font.widthOfTextAtSize(ln, size);
    flow.page.drawText(ln, { x: alignX(opts.align, x, availW, w), y: flow.y - size, size, font, color: INK });
    flow.y -= lineH;
  }
}

export async function renderAgreementPdf(spec: AgreementSpec, fv: AgreementFieldValues): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // 글꼴은 착수계·준공계(명조 계열)와 결을 맞춘다 — 계약 서류 일습이 같은 인상이어야 한다.
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const pick = async (names: string[]) => {
    for (const n of names) {
      try {
        return await readFile(path.join(fontsDir, n));
      } catch {
        // 다음 후보
      }
    }
    throw new Error("본문 글꼴을 찾을 수 없습니다(public/fonts).");
  };
  const fonts: Fonts = {
    regular: await doc.embedFont(await pick(["HANBatang.ttf", "kopub-batang-md.ttf", "malgun.ttf"]), { subset: true }),
    bold: await doc.embedFont(await pick(["HANBatangB.ttf", "kopub-batang-bd.ttf", "malgunbd.ttf"]), { subset: true }),
  };

  const values = buildCoverValues(fv);
  const m: Margins = { ...DEFAULT_MARGINS };
  const flow: Flow = {
    doc,
    page: doc.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - m.top,
    fonts,
    values,
    m,
    contentW: PAGE_W - m.left - m.right,
  };

  // ── 갑지 (1페이지 전제 — 넘치면 그대로 흘러넘치지 않고 잘리므로 표준 갑지는 1장 구성 유지) ──
  for (const block of spec.coverBlocks) drawCoverBlock(flow, block);

  // ── 별지 조문 (있을 때만 — B형은 갑지로 끝) ──
  if (fv.hasClausePage && spec.clausePage && fv.clauses.length) {
    newPage(flow);
    const cp = spec.clausePage;

    // 별지 제목
    {
      const size = 16;
      const spacing = 4;
      const w = fonts.bold.widthOfTextAtSize(cp.title, size) + spacing * Math.max(0, cp.title.length - 1);
      drawSpaced(flow.page, cp.title, m.left + (flow.contentW - w) / 2, flow.y - size, fonts.bold, size, spacing);
      flow.y -= size * 2.2;
    }

    if (cp.preamble) {
      flowPara(flow, cp.preamble.replace(/\{\{([\w.]+)\}\}/g, (_, k: string) => String(values[k] ?? "")));
      flow.y -= BODY_PT;
    }

    const resolved = resolveClauses(fv.clauses, { terms: spec.terms, clausePage: cp }, fv, values);
    for (const c of resolved) {
      // 고아 방지: 조 제목 + 본문 첫 줄이 함께 들어갈 공간이 없으면 페이지를 넘긴다
      ensure(flow, BODY_PT * 1.6 * 2 + 6);
      flowPara(flow, c.heading, { bold: true });
      if (c.body.trim()) flowPara(flow, c.body, { indentPt: 8 });
      flow.y -= BODY_PT * 0.8;
    }

    if (cp.closing) {
      flow.y -= BODY_PT * 0.5;
      flowPara(flow, cp.closing);
    }
    if (cp.signAfterClosing) {
      flow.y -= BODY_PT * 1.5;
      ensure(flow, BODY_PT * 1.8 * 6 + 40);
      flowPara(flow, renderBinding("issue.date", values, "dateKorean"), { align: "center" });
      flow.y -= BODY_PT;
      // 양측 서명 — 갑지 날인 표와 동일 텍스트를 좌우 병기
      const signTable: Extract<DocBlock, { kind: "table" }> = {
        kind: "table",
        columns: [
          { widthRatio: 0.15, align: "center" },
          { widthRatio: 0.35 },
          { widthRatio: 0.15, align: "center" },
          { widthRatio: 0.35 },
        ],
        rows: [
          [
            { text: `(${spec.terms.orderer})`, bold: true },
            { binding: "orderer.signText", format: "multiline" },
            { text: `(${spec.terms.contractor})`, bold: true },
            { binding: "company.signText", format: "multiline" },
          ],
        ],
      };
      drawTable(flow, signTable);
    }
  }

  return await doc.save();
}
