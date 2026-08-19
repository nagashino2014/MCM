// HWPX(OWPML) → 렌더 모델. hwpx-pdf.ts 가 이 모델을 그대로 PDF 로 옮겨 그린다.
//
// 이 경로를 쓰는 이유: 한글이 저장할 때 각 줄의 실제 배치를 <hp:lineseg> 에 계산해 넣어 둔다
// (vertpos·horzpos·baseline, 단위 HWPUNIT = 1/7200 inch). 즉 "어디에 무엇을 그릴지"가 파일 안에
// 이미 다 들어 있으므로, 레이아웃을 다시 짜지 말고 그 좌표를 그대로 따르면 한글 출력과 같아진다.
// (HWPUNIT / 100 = pt — 용지 59528×84186 이 정확히 A4 595.28×841.86pt 다.)

import JSZip from "jszip";

/** 미니 XML 노드 — 외부 파서 없이 HWPX 정도의 정형 XML 만 다룬다. */
export interface XNode {
  tag: string;
  attrs: Record<string, string>;
  kids: XNode[];
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (all, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITY[ent] ?? all;
  });
}

/** 텍스트 노드는 #text 태그로 담는다(hp:t 안에서만 의미가 있다). */
export function parseXml(xml: string): XNode {
  const root: XNode = { tag: "#root", attrs: {}, kids: [] };
  const stack: XNode[] = [root];
  const re = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const text = xml.slice(last, m.index);
    if (text) stack[stack.length - 1].kids.push({ tag: "#text", attrs: { v: decode(text) }, kids: [] });
    last = re.lastIndex;
    if (m[2] === undefined) continue; // 선언·주석
    const [, close, tag, rawAttrs, selfClose] = m;
    if (close) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    const ar = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(rawAttrs ?? ""))) attrs[a[1]] = decode(a[2]);
    const node: XNode = { tag, attrs, kids: [] };
    stack[stack.length - 1].kids.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

export function findAll(node: XNode, tag: string, out: XNode[] = []): XNode[] {
  for (const k of node.kids) {
    if (k.tag === tag) out.push(k);
    findAll(k, tag, out);
  }
  return out;
}

export function findOne(node: XNode, tag: string): XNode | null {
  for (const k of node.kids) {
    if (k.tag === tag) return k;
    const deep = findOne(k, tag);
    if (deep) return deep;
  }
  return null;
}

/** 직계 자식만 — 표가 중첩될 때 바깥 표의 tr 만 골라야 한다. */
export function childrenOf(node: XNode, tag: string): XNode[] {
  return node.kids.filter((k) => k.tag === tag);
}

const num = (v: string | undefined, dflt = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

// ── 서식(header.xml) ──

export interface CharPr {
  /** HWPUNIT — 1500 = 15pt */
  height: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  /** 자간(글자 크기 대비 %) */
  spacing: number;
}

export interface ParaPr {
  align: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFY" | "DISTRIBUTE";
}

export interface BorderSide {
  visible: boolean;
  /** pt */
  width: number;
  color: string;
}

export interface BorderFill {
  left: BorderSide;
  right: BorderSide;
  top: BorderSide;
  bottom: BorderSide;
  /** 배경색(#RRGGBB) — none 이면 null */
  fill: string | null;
}

/** "0.12 mm" → pt */
function borderWidth(raw: string | undefined): number {
  const m = /([\d.]+)\s*mm/.exec(raw ?? "");
  const mm = m ? Number(m[1]) : 0.12;
  return Math.max(0.35, (mm / 25.4) * 72);
}

function side(node: XNode | null): BorderSide {
  const type = node?.attrs.type ?? "NONE";
  return { visible: type !== "NONE", width: borderWidth(node?.attrs.width), color: node?.attrs.color ?? "#000000" };
}

// ── 본문(section0.xml) ──

export interface LineSeg {
  /** 문단 내 문자 오프셋 */
  textpos: number;
  /** 본문(또는 셀) 상단 기준 줄 상단 y */
  vertpos: number;
  vertsize: number;
  /** 줄 상단에서 베이스라인까지 */
  baseline: number;
  horzpos: number;
  horzsize: number;
}

export interface TextRun {
  charPrId: string;
  text: string;
}

export interface Cell {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  width: number;
  height: number;
  margin: { left: number; right: number; top: number; bottom: number };
  borderFillId: string;
  vertAlign: "TOP" | "CENTER" | "BOTTOM";
  paragraphs: Para[];
}

export interface Table {
  rowCnt: number;
  colCnt: number;
  width: number;
  height: number;
  outMargin: { left: number; right: number; top: number; bottom: number };
  /** 종이 절대 배치(hp:pos vertRelTo=PAPER) — 서명부 표를 인감에 맞춰 고정할 때 쓴다(2026-08-19) */
  pos?: { vertRelTo: string; horzRelTo: string; vertOffset: number; horzOffset: number };
  cells: Cell[];
}

export interface Picture {
  /** BinData 참조 id */
  binId: string;
  width: number;
  height: number;
  vertRelTo: string;
  horzRelTo: string;
  vertOffset: number;
  horzOffset: number;
}

export interface Para {
  paraPrId: string;
  runs: TextRun[];
  segs: LineSeg[];
  tables: Table[];
  pics: Picture[];
}

export interface PageGeom {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  header: number;
  footer: number;
}

export interface HwpxDoc {
  geom: PageGeom;
  /** 최상위 문단을 페이지 단위로 끊어 담는다 */
  pages: Para[][];
  charPr: Map<string, CharPr>;
  paraPr: Map<string, ParaPr>;
  borderFill: Map<string, BorderFill>;
  images: Map<string, Uint8Array>;
}

/** hp:t 안의 텍스트 — 탭·줄바꿈 컨트롤은 한 글자로 세어 textpos 를 맞춘다. */
function runText(run: XNode): string {
  let out = "";
  for (const k of run.kids) {
    if (k.tag !== "hp:t") continue;
    for (const t of k.kids) {
      if (t.tag === "#text") out += t.attrs.v ?? "";
      else if (t.tag === "hp:tab") out += "\t";
      else if (t.tag === "hp:lineBreak") out += "\n";
    }
  }
  return out;
}

function parseSegs(p: XNode): LineSeg[] {
  const arr = childrenOf(p, "hp:linesegarray")[0];
  if (!arr) return [];
  return childrenOf(arr, "hp:lineseg").map((s) => ({
    textpos: num(s.attrs.textpos),
    vertpos: num(s.attrs.vertpos),
    vertsize: num(s.attrs.vertsize),
    baseline: num(s.attrs.baseline),
    horzpos: num(s.attrs.horzpos),
    horzsize: num(s.attrs.horzsize),
  }));
}

function parseTable(tbl: XNode): Table {
  const sz = childrenOf(tbl, "hp:sz")[0];
  const om = childrenOf(tbl, "hp:outMargin")[0];
  const pos = childrenOf(tbl, "hp:pos")[0];
  const cells: Cell[] = [];
  for (const tr of childrenOf(tbl, "hp:tr")) {
    for (const tc of childrenOf(tr, "hp:tc")) {
      const addr = childrenOf(tc, "hp:cellAddr")[0];
      const span = childrenOf(tc, "hp:cellSpan")[0];
      const csz = childrenOf(tc, "hp:cellSz")[0];
      const cm = childrenOf(tc, "hp:cellMargin")[0];
      const sub = childrenOf(tc, "hp:subList")[0];
      cells.push({
        col: num(addr?.attrs.colAddr),
        row: num(addr?.attrs.rowAddr),
        colSpan: num(span?.attrs.colSpan, 1) || 1,
        rowSpan: num(span?.attrs.rowSpan, 1) || 1,
        width: num(csz?.attrs.width),
        height: num(csz?.attrs.height),
        margin: {
          left: num(cm?.attrs.left),
          right: num(cm?.attrs.right),
          top: num(cm?.attrs.top),
          bottom: num(cm?.attrs.bottom),
        },
        borderFillId: tc.attrs.borderFillIDRef ?? "",
        vertAlign: (sub?.attrs.vertAlign as Cell["vertAlign"]) ?? "TOP",
        paragraphs: sub ? childrenOf(sub, "hp:p").map(parsePara) : [],
      });
    }
  }
  return {
    rowCnt: num(tbl.attrs.rowCnt),
    colCnt: num(tbl.attrs.colCnt),
    width: num(sz?.attrs.width),
    height: num(sz?.attrs.height),
    outMargin: { left: num(om?.attrs.left), right: num(om?.attrs.right), top: num(om?.attrs.top), bottom: num(om?.attrs.bottom) },
    pos: pos
      ? {
          vertRelTo: pos.attrs.vertRelTo ?? "PARA",
          horzRelTo: pos.attrs.horzRelTo ?? "PARA",
          vertOffset: num(pos.attrs.vertOffset),
          horzOffset: num(pos.attrs.horzOffset),
        }
      : undefined,
    cells,
  };
}

function parsePara(p: XNode): Para {
  const runs: TextRun[] = [];
  const tables: Table[] = [];
  const pics: Picture[] = [];
  for (const run of childrenOf(p, "hp:run")) {
    const charPrId = run.attrs.charPrIDRef ?? "";
    for (const tbl of childrenOf(run, "hp:tbl")) tables.push(parseTable(tbl));
    for (const pic of childrenOf(run, "hp:pic")) {
      const img = findOne(pic, "hc:img");
      const sz = childrenOf(pic, "hp:sz")[0];
      const pos = childrenOf(pic, "hp:pos")[0];
      if (!img || !sz || !pos) continue;
      pics.push({
        binId: img.attrs.binaryItemIDRef ?? "",
        width: num(sz.attrs.width),
        height: num(sz.attrs.height),
        vertRelTo: pos.attrs.vertRelTo ?? "PARA",
        horzRelTo: pos.attrs.horzRelTo ?? "PARA",
        vertOffset: num(pos.attrs.vertOffset),
        horzOffset: num(pos.attrs.horzOffset),
      });
    }
    const text = runText(run);
    // 표·그림은 문단 안에서 한 글자를 차지한다(textpos 정합)
    const objs = childrenOf(run, "hp:tbl").length + childrenOf(run, "hp:pic").length;
    if (text || objs) runs.push({ charPrId, text: text + " ".repeat(objs && !text ? objs : 0) });
  }
  return { paraPrId: p.attrs.paraPrIDRef ?? "", runs, segs: parseSegs(p), tables, pics };
}

function parseHeader(headerXml: string) {
  const root = parseXml(headerXml);
  const charPr = new Map<string, CharPr>();
  for (const c of findAll(root, "hh:charPr")) {
    if (charPr.has(c.attrs.id)) continue; // 앞선 정의가 본문 기준
    const sp = childrenOf(c, "hh:spacing")[0];
    const ul = childrenOf(c, "hh:underline")[0];
    charPr.set(c.attrs.id, {
      height: num(c.attrs.height, 1000),
      bold: childrenOf(c, "hh:bold").length > 0,
      italic: childrenOf(c, "hh:italic").length > 0,
      underline: !!ul && (ul.attrs.type ?? "NONE") !== "NONE",
      color: c.attrs.textColor ?? "#000000",
      spacing: num(sp?.attrs.hangul),
    });
  }
  const paraPr = new Map<string, ParaPr>();
  for (const p of findAll(root, "hh:paraPr")) {
    if (paraPr.has(p.attrs.id)) continue;
    const al = childrenOf(p, "hh:align")[0];
    paraPr.set(p.attrs.id, { align: (al?.attrs.horizontal as ParaPr["align"]) ?? "LEFT" });
  }
  const borderFill = new Map<string, BorderFill>();
  for (const b of findAll(root, "hh:borderFill")) {
    if (borderFill.has(b.attrs.id)) continue;
    const brush = findOne(b, "hc:winBrush");
    const face = brush?.attrs.faceColor;
    borderFill.set(b.attrs.id, {
      left: side(childrenOf(b, "hh:leftBorder")[0] ?? null),
      right: side(childrenOf(b, "hh:rightBorder")[0] ?? null),
      top: side(childrenOf(b, "hh:topBorder")[0] ?? null),
      bottom: side(childrenOf(b, "hh:bottomBorder")[0] ?? null),
      fill: face && face !== "none" ? face : null,
    });
  }
  return { charPr, paraPr, borderFill };
}

function parseGeom(sectionRoot: XNode): PageGeom {
  const pp = findOne(sectionRoot, "hp:pagePr");
  const mg = pp ? childrenOf(pp, "hp:margin")[0] : null;
  return {
    width: num(pp?.attrs.width, 59528),
    height: num(pp?.attrs.height, 84186),
    left: num(mg?.attrs.left, 5669),
    right: num(mg?.attrs.right, 5669),
    top: num(mg?.attrs.top, 4251),
    bottom: num(mg?.attrs.bottom, 2834),
    header: num(mg?.attrs.header, 2835),
    footer: num(mg?.attrs.footer, 2835),
  };
}

/**
 * 페이지 분할 — 한글은 페이지마다 vertpos 를 0 부터 다시 센다.
 * 따라서 최상위 문단을 훑다가 vertpos 가 뒤로 되돌아가면 그 지점이 새 페이지다.
 */
function splitPages(paras: Para[]): Para[][] {
  const pages: Para[][] = [[]];
  let last = -1;
  for (const p of paras) {
    const first = p.segs[0];
    if (first) {
      if (first.vertpos < last) {
        pages.push([]);
        last = first.vertpos;
      } else {
        last = p.segs[p.segs.length - 1].vertpos;
      }
    }
    pages[pages.length - 1].push(p);
  }
  return pages.filter((pg) => pg.length > 0);
}

/** zip 안의 HWPX 를 렌더 모델로 — 이미지는 BinData 원본 바이트 그대로 싣는다. */
export async function parseHwpx(bytes: Uint8Array): Promise<HwpxDoc> {
  const zip = await JSZip.loadAsync(bytes);
  const sectionFile = zip.file("Contents/section0.xml");
  const headerFile = zip.file("Contents/header.xml");
  if (!sectionFile || !headerFile) throw new Error("HWPX 구조가 아닙니다(section0/header 없음).");

  const sectionRoot = parseXml(await sectionFile.async("string"));
  const sec = findOne(sectionRoot, "hs:sec") ?? sectionRoot;
  const paras = childrenOf(sec, "hp:p").map(parsePara);

  const images = new Map<string, Uint8Array>();
  const binDir = zip.folder("BinData");
  if (binDir) {
    const entries: Promise<void>[] = [];
    binDir.forEach((rel, file) => {
      if (file.dir) return;
      const id = rel.replace(/\.[^.]+$/, "");
      entries.push(file.async("uint8array").then((b) => void images.set(id, b)));
    });
    await Promise.all(entries);
  }

  return { geom: parseGeom(sectionRoot), pages: splitPages(paras), ...parseHeader(await headerFile.async("string")), images };
}
