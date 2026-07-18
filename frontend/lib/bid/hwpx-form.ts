import JSZip from "jszip";

/*
 * HWPX 양식 파서 — Contents/section*.xml 에서 표·셀(좌표/스팬/텍스트)과 표 밖 문단을
 * 문서 순서대로 추출한다. 입찰 서류 양식(RFP 별첨 서식) LLM 분석의 입력을 만든다.
 * (샘플 5벌 실측: 표 중첩 없음·cellAddr/cellSpan 규칙적 — docs/bid-package-blueprint.md)
 */

export interface HwpxCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  text: string;
}

export interface HwpxTable {
  index: number;
  rowCnt: number;
  colCnt: number;
  cells: HwpxCell[];
}

export type HwpxBlock = { type: "para"; text: string } | { type: "table"; index: number };

export interface HwpxFormDoc {
  tables: HwpxTable[];
  /** 문서 순서(문단·표 인터리브) — 서식 표제([별첨 서식 N])와 표의 대응 파악용. */
  blocks: HwpxBlock[];
}

const TBL_RE = /<hp:tbl\b[^>]*>[\s\S]*?<\/hp:tbl>/g;
const TC_RE = /<hp:tc\b[\s\S]*?<\/hp:tc>/g;
const ADDR_RE = /<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"/;
const SPAN_RE = /<hp:cellSpan colSpan="(\d+)" rowSpan="(\d+)"/;
const T_RE = /<hp:t>([^<]*)<\/hp:t>/g;
const DIMS_RE = /rowCnt="(\d+)"[^>]*colCnt="(\d+)"/;

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textsIn(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(T_RE)) {
    const t = decodeXml(m[1]).replace(/[-]/g, "").trim(); // 사양 외 개인영역 글리프 제거
    if (t) out.push(t);
  }
  return out;
}

function parseTable(block: string, index: number): HwpxTable {
  const dims = DIMS_RE.exec(block);
  const cells: HwpxCell[] = [];
  for (const cm of block.matchAll(TC_RE)) {
    const c = cm[0];
    const addr = ADDR_RE.exec(c);
    if (!addr) continue;
    const span = SPAN_RE.exec(c);
    cells.push({
      row: Number(addr[2]),
      col: Number(addr[1]),
      rowSpan: span ? Number(span[2]) : 1,
      colSpan: span ? Number(span[1]) : 1,
      text: textsIn(c).join(" "),
    });
  }
  cells.sort((a, b) => a.row - b.row || a.col - b.col);
  return {
    index,
    rowCnt: dims ? Number(dims[1]) : 0,
    colCnt: dims ? Number(dims[2]) : 0,
    cells,
  };
}

/** HWPX(zip) 바이트 → 표/문단 구조. 섹션이 여럿이면 순서대로 이어붙인다(표 index 는 전역 연번). */
export async function parseHwpxForm(bytes: Uint8Array): Promise<HwpxFormDoc> {
  const zip = await JSZip.loadAsync(bytes);
  const sectionNames = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/.test(n))
    .sort();
  if (sectionNames.length === 0) {
    throw new Error("HWPX 본문(Contents/section*.xml)을 찾을 수 없습니다. HWPX 파일인지 확인하세요.");
  }

  const tables: HwpxTable[] = [];
  const blocks: HwpxBlock[] = [];
  for (const name of sectionNames) {
    const xml = await zip.files[name].async("string");
    let cursor = 0;
    for (const m of xml.matchAll(TBL_RE)) {
      // 표 이전 구간의 문단 텍스트
      for (const t of textsIn(xml.slice(cursor, m.index))) blocks.push({ type: "para", text: t });
      const table = parseTable(m[0], tables.length);
      tables.push(table);
      blocks.push({ type: "table", index: table.index });
      cursor = (m.index ?? 0) + m[0].length;
    }
    for (const t of textsIn(xml.slice(cursor))) blocks.push({ type: "para", text: t });
  }
  return { tables, blocks };
}

/** LLM 분석 입력용 직렬화 — 문서 순서대로 문단·표(셀 좌표 그리드)를 평문으로. */
export function serializeFormForLlm(doc: HwpxFormDoc, opts?: { maxCellChars?: number }): string {
  const maxLen = opts?.maxCellChars ?? 80;
  const lines: string[] = [];
  for (const block of doc.blocks) {
    if (block.type === "para") {
      lines.push(`[문단] ${block.text}`);
      continue;
    }
    const t = doc.tables[block.index];
    lines.push(`[표 ${t.index}] ${t.rowCnt}행 x ${t.colCnt}열`);
    for (const c of t.cells) {
      const span = c.rowSpan > 1 || c.colSpan > 1 ? ` (span ${c.rowSpan}x${c.colSpan})` : "";
      const text = c.text.length > maxLen ? c.text.slice(0, maxLen) + "…" : c.text;
      lines.push(`  r${c.row}c${c.col}${span}: ${text || "(빈칸)"}`);
    }
  }
  return lines.join("\n");
}
