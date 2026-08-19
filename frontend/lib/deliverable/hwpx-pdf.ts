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

// 줄이 폭을 살짝 넘칠 때만 줄여 앉힌다(글꼴 차이로 생기는 몇 %). 그 이상은 한글처럼 다음 줄로
// 흘린다 — 계약명 같은 본문 값을 작게 만드는 건 제출 문서로 곤란하다는 사용자 판단.
const SQUEEZE_TOLERANCE = 1.03;
// 표 칸은 줄을 늘릴 수 없어 줄여 앉히는 수밖에 없다 — 읽을 수 있는 선까지만.
const MIN_SQUEEZE = 0.6;

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

/**
 * 폭을 넘는 텍스트를 여러 줄로 나눈다 — 첫 줄은 남은 폭(firstW), 이후는 전체 폭(fullW).
 * 공백 경계를 우선하고, 한 덩어리가 통째로 넘치면(한글은 공백이 드물다) 글자 단위로 자른다.
 */
function wrapToWidth(font: PDFFont, text: string, size: number, ls: number, firstW: number, fullW: number): string[] {
  const t = plain(text);
  if (!t) return [text];
  const lines: string[] = [];
  let cur = "";
  let limit = Math.max(0, firstW);
  const widthOf = (s: string) => layout(font, s, size, ls);
  const push = () => {
    lines.push(cur);
    cur = "";
    limit = fullW;
  };
  for (const token of t.split(/(?<= )/)) {
    if (cur && widthOf(cur + token) > limit) push();
    if (widthOf(token) > limit) {
      for (const ch of token) {
        if (cur && widthOf(cur + ch) > limit) push();
        cur += ch;
      }
      continue;
    }
    cur += token;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [t];
}

const isBlank = (p: Para): boolean =>
  !p.tables.length && !p.pics.length && p.runs.every((r) => !r.text.trim());

/**
 * 늘어난 줄만큼 흡수할 여백 줄을 고른다.
 * 값이 길어져 줄이 늘면 그 아래가 통째로 밀려 마지막 줄(수신처)이 다음 장으로 넘어간다.
 * 그래서 **연속된 빈 줄이 가장 많은 구간**에서 한 줄씩 덜어낸다(사용자 확정 방식) —
 * 여백이 고르게 줄어 문서 인상이 덜 흐트러진다. 같은 길이면 아래쪽 구간을 먼저 줄인다.
 */
export function planDrops(paras: Para[], wrapped: number[]): Set<number> {
  const need = wrapped.reduce((a, b) => a + b, 0);
  const drops = new Set<number>();
  if (need <= 0) return drops;

  // 줄이 늘어난 지점 아래의 빈 줄만 후보다 — 위쪽을 줄이면 제목·본문 간격이 흐트러진다
  const firstOverflow = wrapped.findIndex((w) => w > 0);
  const runs: number[][] = [];
  let cur: number[] = [];
  paras.forEach((p, i) => {
    if (i > firstOverflow && isBlank(p)) {
      cur.push(i);
      return;
    }
    if (cur.length) runs.push(cur);
    cur = [];
  });
  if (cur.length) runs.push(cur);

  // 마지막 줄(수신처 "○○ 귀하") 바로 앞 여백은 한 줄 이상 남긴다 — 서명란에 딱 붙으면 안 된다
  let lastText = -1;
  paras.forEach((p, i) => {
    if (!isBlank(p)) lastText = i;
  });
  const floorOf = (run: number[]) => (run.length && run[run.length - 1] === lastText - 1 ? 1 : 0);

  for (let n = 0; n < need; n += 1) {
    let best = -1;
    for (let r = 0; r < runs.length; r += 1) {
      if (runs[r].length <= floorOf(runs[r])) continue;
      // 같은 길이면 뒤쪽(문서 하단) 우선 — 본문 흐름에 영향이 적다
      if (best < 0 || runs[r].length >= runs[best].length) best = r;
    }
    if (best < 0) break;
    drops.add(runs[best].pop() as number);
  }
  return drops;
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
  /** page 가 null 이면 그리지 않고 늘어난 줄 수만 잰다(배치 계획용). */
  private drawPara(
    page: PDFPage | null,
    para: Para,
    originX: number,
    originY: number,
    availW?: number,
    opts: { lineStep?: number; extraTop?: number } = {}
  ): number {
    if (!para.segs.length) return 0;
    const lineStep = opts.lineStep ?? hu(para.segs[0].vertsize) * 1.4;
    const extraTop = opts.extraTop ?? 0;
    let wrapped = 0;
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

      // 값이 원본보다 길어 줄을 넘칠 때(긴 계약명 등):
      // 아주 조금 넘치면 눈에 띄지 않게 줄여 앉히고, 그 이상이면 한글처럼 다음 줄로 흘린다.
      // 계약명을 작게 만드는 건 제출 문서로 곤란하다는 사용자 판단에 따른 것 —
      // 대신 늘어난 줄만큼 여백 줄을 흡수해 페이지가 밀리지 않게 한다(render()).
      // 표 칸(availW 가 넘어온 경우)은 행 높이가 고정이라 줄을 늘릴 수 없다 → 줄바꿈 대신 줄여 앉힌다.
      // 본문 문단만 한글처럼 다음 줄로 흘린다.
      const inCell = availW !== undefined;
      const boxW = availW ?? hu(seg.horzsize);
      const needWrap = !inCell && boxW > 0 && lineW > boxW * SQUEEZE_TOLERANCE;
      const squeeze = !needWrap && lineW > boxW && boxW > 0 ? Math.max(MIN_SQUEEZE, boxW / lineW) : 1;
      const drawnW = lineW * squeeze;

      const lineLeft = originX + hu(seg.horzpos);
      let x = lineLeft;
      if (!needWrap) {
        if (align === "CENTER") x += (boxW - drawnW) / 2;
        else if (align === "RIGHT") x += boxW - drawnW;
      }

      let baselineY = pageH - (originY + hu(seg.vertpos) + hu(seg.baseline) + extraTop);
      for (const p of parts) {
        const size = hu(p.cp.height) * squeeze;
        const ls = (size * p.cp.spacing) / 100;
        const font = this.font(p.cp);

        // 넘치는 줄은 공백 경계(없으면 글자 단위)로 잘라 다음 줄로 내린다
        const chunks = needWrap ? wrapToWidth(font, p.text, size, ls, lineLeft + boxW - x, boxW) : [p.text];
        chunks.forEach((chunk, ci) => {
          if (ci > 0) {
            x = lineLeft;
            baselineY -= lineStep;
            wrapped += 1;
          }
          const w = layout(font, chunk, size, ls, page ? { page, x, y: baselineY, col: p.cp.color } : undefined);
          if (page && p.cp.underline && w > 0) {
            const uy = baselineY - size * 0.14;
            page.drawLine({
              start: { x, y: uy },
              end: { x: x + w, y: uy },
              thickness: Math.max(0.5, size * 0.05),
              color: color(p.cp.color),
            });
          }
          x += w;
        });
      }
    });
    return wrapped;
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

  /** 문단 사이 간격(pt) — 다음 문단과의 좌표 차이가 곧 그 문단이 차지한 높이다. */
  private stepOf(paras: Para[], i: number): number {
    const cur = paras[i]?.segs[0];
    const next = paras[i + 1]?.segs[0];
    if (cur && next && next.vertpos > cur.vertpos) return hu(next.vertpos - cur.vertpos);
    const last = paras[i]?.segs[paras[i].segs.length - 1];
    return hu((last?.vertsize ?? 1500) * 1.4);
  }

  /** 그린 뒤, 흡수한 여백 줄의 문단 번호(문서 전체 연번)를 돌려준다 — HWPX 쪽도 같이 지워야 한다. */
  render(): number[] {
    const { geom } = this.doc;
    const bodyLeft = geom.left;
    const bodyTop = geom.top + geom.header;
    const dropped: number[] = [];
    let paraBase = 0;

    for (const paras of this.doc.pages) {
      const page = this.pdf.addPage([hu(geom.width), hu(geom.height)]);

      // 1) 값이 길어 늘어난 줄 수를 먼저 잰다(그리지 않고 측정만)
      const wrapped = paras.map((p, i) =>
        p.segs.length ? this.drawPara(null, p, hu(bodyLeft), hu(bodyTop), undefined, { lineStep: this.stepOf(paras, i) }) : 0
      );
      const drops = planDrops(paras, wrapped);

      // 2) 늘어난 만큼 아래로 밀되, 흡수하기로 한 여백 줄에서 되돌린다
      let delta = 0;
      paras.forEach((para, i) => {
        const step = this.stepOf(paras, i);
        if (drops.has(i)) {
          delta = Math.max(0, delta - step);
          return; // 빈 줄이므로 그릴 것도 없다
        }
        const first = para.segs[0];
        const paraTop = (first ? bodyTop + first.vertpos : bodyTop) + delta * U;
        this.drawPara(page, para, hu(bodyLeft), hu(bodyTop), undefined, { lineStep: step, extraTop: delta });
        for (const table of para.tables) {
          // 종이 절대 배치 표(서명부 인감 정렬, 2026-08-19) — 문단 흐름과 무관하게 고정 좌표에 그린다
          if (table.pos?.vertRelTo === "PAPER") {
            this.drawTable(page, table, table.pos.horzOffset, table.pos.vertOffset);
            continue;
          }
          // 표는 문단의 한 글자처럼 앉는다 — 줄 상단 + 바깥 여백이 표 상단이다
          const align = this.doc.paraPr.get(para.paraPrId)?.align ?? "LEFT";
          const avail = first ? first.horzsize : geom.width - geom.left - geom.right;
          let x = bodyLeft + (first ? first.horzpos : 0) + table.outMargin.left;
          if (align === "CENTER") x += Math.max(0, (avail - table.width) / 2);
          else if (align === "RIGHT") x += Math.max(0, avail - table.width);
          this.drawTable(page, table, x, paraTop + table.outMargin.top);
        }
        // 인감은 종이 절대 좌표라 밀지 않는다 — HWPX 를 한글로 열었을 때와 같은 거동이다
        for (const pic of para.pics) this.drawPicture(page, pic, paraTop, bodyLeft);
        delta += wrapped[i] * step;
      });
      for (const i of drops) dropped.push(paraBase + i);
      paraBase += paras.length;
    }
    return dropped.sort((a, b) => a - b);
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

/**
 * HWPX 바이트 → PDF 바이트. 산출물 두 벌이 같은 파일에서 나오므로 서식이 어긋나지 않는다.
 * drops 는 값이 길어져 늘어난 줄을 흡수하려고 없앤 여백 줄의 문단 번호다 —
 * 배포용 HWPX 도 같은 줄을 지워야 한글로 열었을 때 같은 배치가 된다(generate.ts).
 */
export async function renderHwpxToPdf(hwpxBytes: Uint8Array): Promise<{ pdf: Uint8Array; drops: number[] }> {
  const doc = await parseHwpx(hwpxBytes);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts = await loadFonts(pdf);
  const images = await embedImages(pdf, doc);
  const drops = new Renderer(doc, pdf, fonts, images).render();
  return { pdf: await pdf.save(), drops };
}
