// HWPX → PDF. hwpx-doc.ts 가 뽑아낸 좌표(한글이 계산해 둔 줄 배치)를 그대로 옮겨 그린다.
//
// 자체 레이아웃을 다시 계산하지 않는 것이 요점이다 — 제출처가 공공기관·공기업이라 서식이
// 한글 출력물과 어긋나면 안 되고, 좌표를 따르면 표·인감·줄 위치가 원본과 같아진다.
// 글꼴만 원본(함초롬바탕·휴먼명조)을 그대로 쓸 수 없어 한컴바탕으로 대체하므로,
// 줄 시작점은 좌표로 고정하고 줄 안에서만 우리 글꼴 폭으로 배치한다.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  parseHwpx,
  type Cell,
  type CharPr,
  type HwpxDoc,
  type Para,
  type Table,
  type TextRun,
} from "./hwpx-doc";

/** HWPUNIT(1/7200 inch) → pt(1/72 inch) */
const U = 100;
const hu = (v: number): number => v / U;

const DEFAULT_CHAR: CharPr = { height: 1000, bold: false, italic: false, underline: false, color: "#000000", spacing: 0 };

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

function color(hex: string) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex ?? "");
  if (!m) return rgb(0, 0, 0);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** 탭은 우리 쪽 폭 계산이 불가능하므로 공백으로 환산한다(템플릿은 공백 정렬이 기본). */
const plain = (s: string): string => s.replace(/\t/g, "    ").replace(/\n/g, "");

// 한글 문서의 공백은 반각(글자 크기의 절반)으로 앉는다. 본문 글꼴의 space 는 그보다 좁아
// (한컴바탕 0.30em) 그대로 쓰면 줄이 원본보다 짧아지고, 공백으로 들여쓴 서명란이 왼쪽으로 밀린다.
const SPACE_EM = 0.5;

// 줄이 폭을 넘칠 때 줄여 앉히는 하한 — 이보다 더 줄이면 읽기 힘들어지므로 넘치는 채로 둔다.
const MIN_SQUEEZE = 0.75;

function chunkWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    // 글꼴에 없는 문자 — 글자 단위로 폴백
    let w = 0;
    for (const ch of text) {
      try {
        w += font.widthOfTextAtSize(ch, size);
      } catch {
        w += size * SPACE_EM;
      }
    }
    return w;
  }
}

/**
 * 줄 조각을 공백 경계로 나눠 폭을 재고, draw 가 있으면 같은 자리에 그린다.
 * 재는 경로와 그리는 경로가 갈리면 정렬이 어긋나므로 한 함수로 묶는다.
 */
function layout(
  font: PDFFont,
  text: string,
  size: number,
  ls: number,
  draw?: { page: PDFPage; x: number; y: number; col: string }
): number {
  const t = plain(text);
  if (!t) return 0;
  let cx = draw?.x ?? 0;
  const from = cx;
  for (const chunk of t.split(/( +)/)) {
    if (!chunk) continue;
    if (chunk[0] === " ") {
      cx += chunk.length * (size * SPACE_EM + ls);
      continue;
    }
    if (draw) {
      const opts = { size, font, color: color(draw.col) };
      if (ls) {
        for (const ch of chunk) {
          try {
            draw.page.drawText(ch, { x: cx, y: draw.y, ...opts });
          } catch {
            // 글꼴에 없는 문자는 자리만 비운다
          }
          cx += chunkWidth(font, ch, size) + ls;
        }
        continue;
      }
      try {
        draw.page.drawText(chunk, { x: cx, y: draw.y, ...opts });
      } catch {
        // 위와 동일
      }
    }
    cx += chunkWidth(font, chunk, size) + ls * chunk.length;
  }
  return cx - from;
}

/** 문단의 런들을 이어 붙이고, 문자 오프셋으로 줄을 잘라 쓰기 위한 조각 목록. */
interface Piece {
  start: number;
  end: number;
  run: TextRun;
}

function piecesOf(runs: TextRun[]): { pieces: Piece[]; length: number } {
  const pieces: Piece[] = [];
  let at = 0;
  for (const run of runs) {
    const len = run.text.length;
    if (len) pieces.push({ start: at, end: at + len, run });
    at += len;
  }
  return { pieces, length: at };
}

class Renderer {
  constructor(
    private readonly doc: HwpxDoc,
    private readonly pdf: PDFDocument,
    private readonly fonts: Fonts,
    private readonly images: Map<string, PDFImage>
  ) {}

  private char(id: string): CharPr {
    return this.doc.charPr.get(id) ?? DEFAULT_CHAR;
  }

  private font(cp: CharPr): PDFFont {
    return cp.bold ? this.fonts.bold : this.fonts.regular;
  }

  /**
   * 문단 텍스트를 줄 좌표대로 그린다.
   * originX/originY 는 좌표 기준점(본문 좌상단, 또는 셀 텍스트 영역 좌상단)이고,
   * availW 는 정렬 계산에 쓸 가용 폭이다 — 셀에서는 lineseg.horzsize 대신 실제 셀 폭을 넘겨
   * 표 열이 바뀐 경우(기지급 열 제거)에도 가운데 정렬이 어긋나지 않게 한다.
   */
  private drawPara(page: PDFPage, para: Para, originX: number, originY: number, availW?: number) {
    if (!para.segs.length) return;
    const align = this.doc.paraPr.get(para.paraPrId)?.align ?? "LEFT";
    const { pieces, length } = piecesOf(para.runs);
    const pageH = hu(this.doc.geom.height);

    para.segs.forEach((seg, i) => {
      const from = seg.textpos;
      const to = i + 1 < para.segs.length ? para.segs[i + 1].textpos : length;
      if (to <= from) return;

      // 이 줄에 걸치는 런 조각들
      const parts: { text: string; cp: CharPr }[] = [];
      for (const p of pieces) {
        if (p.end <= from || p.start >= to) continue;
        const text = p.run.text.slice(Math.max(0, from - p.start), Math.min(p.run.text.length, to - p.start));
        if (text) parts.push({ text, cp: this.char(p.run.charPrId) });
      }
      if (!parts.some((p) => p.text.trim())) return;

      const lineW = parts.reduce((acc, p) => {
        const size = hu(p.cp.height);
        return acc + layout(this.font(p.cp), p.text, size, (size * p.cp.spacing) / 100);
      }, 0);

      // 자동 줄바꿈이 없는 좌표 렌더라 값이 길면 줄을 넘어 잘린다(발주처 양식에 긴 계약명·주소가
      // 들어가는 경우). 넘치는 줄만 살짝 줄여 폭 안에 앉힌다 — 한글의 장평 조절과 같은 취지.
      const boxW = availW ?? hu(seg.horzsize);
      const squeeze = lineW > boxW && boxW > 0 ? Math.max(MIN_SQUEEZE, boxW / lineW) : 1;
      const drawnW = lineW * squeeze;

      let x = originX + hu(seg.horzpos);
      if (align === "CENTER") x += (boxW - drawnW) / 2;
      else if (align === "RIGHT") x += boxW - drawnW;

      const baselineY = pageH - (originY + hu(seg.vertpos) + hu(seg.baseline));
      for (const p of parts) {
        const size = hu(p.cp.height) * squeeze;
        const ls = (size * p.cp.spacing) / 100;
        const w = layout(this.font(p.cp), p.text, size, ls, { page, x, y: baselineY, col: p.cp.color });
        if (p.cp.underline && w > 0) {
          const uy = baselineY - size * 0.14;
          page.drawLine({
            start: { x, y: uy },
            end: { x: x + w, y: uy },
            thickness: Math.max(0.5, size * 0.05),
            color: color(p.cp.color),
          });
        }
        x += w;
      }
    });
  }

  /** 표의 열 폭·행 높이 — span 이 1인 셀에서 뽑고, 빠진 칸은 남은 폭으로 메운다. */
  private grid(table: Table): { cols: number[]; rows: number[] } {
    const cols = new Array<number>(table.colCnt).fill(0);
    const rows = new Array<number>(table.rowCnt).fill(0);
    for (const c of table.cells) {
      if (c.colSpan === 1 && c.col < cols.length && !cols[c.col]) cols[c.col] = c.width;
      if (c.rowSpan === 1 && c.row < rows.length && !rows[c.row]) rows[c.row] = c.height;
    }
    const fill = (arr: number[], total: number) => {
      const known = arr.reduce((a, b) => a + b, 0);
      const missing = arr.filter((v) => !v).length;
      if (!missing) return;
      const each = Math.max(0, (total - known) / missing);
      for (let i = 0; i < arr.length; i += 1) if (!arr[i]) arr[i] = each;
    };
    fill(cols, table.width);
    fill(rows, table.height);
    return { cols, rows };
  }

  private drawCell(page: PDFPage, cell: Cell, x: number, y: number, w: number, h: number) {
    const pageH = hu(this.doc.geom.height);
    const bf = this.doc.borderFill.get(cell.borderFillId);
    const left = hu(x);
    const top = hu(y);
    const width = hu(w);
    const height = hu(h);

    if (bf?.fill) {
      page.drawRectangle({ x: left, y: pageH - top - height, width, height, color: color(bf.fill) });
    }
    if (bf) {
      const seg = (s: typeof bf.left, x1: number, y1: number, x2: number, y2: number) => {
        if (!s.visible) return;
        page.drawLine({ start: { x: x1, y: pageH - y1 }, end: { x: x2, y: pageH - y2 }, thickness: s.width, color: color(s.color) });
      };
      seg(bf.top, left, top, left + width, top);
      seg(bf.bottom, left, top + height, left + width, top + height);
      seg(bf.left, left, top, left, top + height);
      seg(bf.right, left + width, top, left + width, top + height);
    }

    // 셀 안 문단 — 세로 정렬만 우리가 계산하고, 줄 위치는 셀 기준 lineseg 를 그대로 쓴다
    const textLeft = x + cell.margin.left;
    const textW = hu(Math.max(0, w - cell.margin.left - cell.margin.right));
    let textTop = y + cell.margin.top;
    if (cell.vertAlign === "CENTER" || cell.vertAlign === "BOTTOM") {
      let contentH = 0;
      for (const p of cell.paragraphs) {
        for (const s of p.segs) contentH = Math.max(contentH, s.vertpos + s.vertsize);
      }
      const areaH = Math.max(0, h - cell.margin.top - cell.margin.bottom);
      const slack = Math.max(0, areaH - contentH);
      textTop += cell.vertAlign === "CENTER" ? slack / 2 : slack;
    }
    for (const p of cell.paragraphs) this.drawPara(page, p, hu(textLeft), hu(textTop), textW);
  }

  private drawTable(page: PDFPage, table: Table, x: number, y: number) {
    const { cols, rows } = this.grid(table);
    const at = (arr: number[], from: number, span: number) => arr.slice(from, from + span).reduce((a, b) => a + b, 0);
    for (const cell of table.cells) {
      const cx = x + at(cols, 0, cell.col);
      const cy = y + at(rows, 0, cell.row);
      const cw = at(cols, cell.col, cell.colSpan) || cell.width;
      const ch = at(rows, cell.row, cell.rowSpan) || cell.height;
      this.drawCell(page, cell, cx, cy, cw, ch);
    }
  }

  private drawPicture(page: PDFPage, pic: Para["pics"][number], paraTop: number, bodyLeft: number) {
    const img = this.images.get(pic.binId);
    if (!img) return;
    const pageH = hu(this.doc.geom.height);
    // 인감은 대개 종이 절대 좌표(vertRelTo="PAPER")로 박혀 있다 — 그 값을 그대로 쓴다.
    const top = pic.vertRelTo === "PAPER" ? pic.vertOffset : paraTop + pic.vertOffset;
    const left = pic.horzRelTo === "PAPER" ? pic.horzOffset : bodyLeft + pic.horzOffset;
    const w = hu(pic.width);
    const h = hu(pic.height);
    page.drawImage(img, { x: hu(left), y: pageH - hu(top) - h, width: w, height: h });
  }

  render(): void {
    const { geom } = this.doc;
    const bodyLeft = geom.left;
    const bodyTop = geom.top + geom.header;

    for (const paras of this.doc.pages) {
      const page = this.pdf.addPage([hu(geom.width), hu(geom.height)]);
      for (const para of paras) {
        const first = para.segs[0];
        const paraTop = first ? bodyTop + first.vertpos : bodyTop;
        this.drawPara(page, para, hu(bodyLeft), hu(bodyTop));
        for (const table of para.tables) {
          // 표는 문단의 한 글자처럼 앉는다 — 줄 상단 + 바깥 여백이 표 상단이다
          const align = this.doc.paraPr.get(para.paraPrId)?.align ?? "LEFT";
          const avail = first ? first.horzsize : geom.width - geom.left - geom.right;
          let x = bodyLeft + (first ? first.horzpos : 0) + table.outMargin.left;
          if (align === "CENTER") x += Math.max(0, (avail - table.width) / 2);
          else if (align === "RIGHT") x += Math.max(0, avail - table.width);
          this.drawTable(page, table, x, paraTop + table.outMargin.top);
        }
        for (const pic of para.pics) this.drawPicture(page, pic, paraTop, bodyLeft);
      }
    }
  }
}

async function loadFonts(pdf: PDFDocument): Promise<Fonts> {
  const dir = path.join(process.cwd(), "public", "fonts");
  const pick = async (names: string[]) => {
    for (const n of names) {
      try {
        return await readFile(path.join(dir, n));
      } catch {
        // 다음 후보
      }
    }
    throw new Error("본문 글꼴을 찾을 수 없습니다(public/fonts).");
  };
  return {
    regular: await pdf.embedFont(await pick(["HANBatang.ttf", "kopub-batang-md.ttf", "malgun.ttf"]), { subset: true }),
    bold: await pdf.embedFont(await pick(["HANBatangB.ttf", "kopub-batang-bd.ttf", "malgunbd.ttf"]), { subset: true }),
  };
}

async function embedImages(pdf: PDFDocument, doc: HwpxDoc): Promise<Map<string, PDFImage>> {
  const out = new Map<string, PDFImage>();
  for (const [id, bytes] of doc.images) {
    try {
      const png = bytes[0] === 0x89 && bytes[1] === 0x50;
      out.set(id, png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes));
    } catch {
      // 지원하지 않는 형식(BMP 등)은 건너뛴다 — 문서 나머지는 정상 출력한다
    }
  }
  return out;
}

/** HWPX 바이트 → PDF 바이트. 산출물 두 벌이 같은 파일에서 나오므로 서식이 어긋나지 않는다. */
export async function renderHwpxToPdf(hwpxBytes: Uint8Array): Promise<Uint8Array> {
  const doc = await parseHwpx(hwpxBytes);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts = await loadFonts(pdf);
  const images = await embedImages(pdf, doc);
  new Renderer(doc, pdf, fonts, images).render();
  return pdf.save();
}
