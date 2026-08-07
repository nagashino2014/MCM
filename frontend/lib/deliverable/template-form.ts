// 발주처 자체양식(HWPX) 개요 추출·직렬화 — D4 분석의 입력과 값 주입의 좌표계를 정한다.
//
// bid 의 lib/bid/hwpx-form.ts 와 같은 목적이지만 두 가지가 다르다.
//  ① 표 밖 문단도 좌표(연번)를 갖는다 — 착수계처럼 표 없이 "□ 계 약 명 : …" 문단으로만 된
//     양식이 실재하므로, 셀만 매핑해서는 값을 넣을 자리가 없다.
//  ② 파싱은 hwpx-doc.ts 를 재사용한다 — PDF 렌더러와 같은 파서를 써야 분석에서 본 좌표와
//     주입·렌더의 좌표가 어긋나지 않는다.

import { childrenOf, findOne, parseXml, type HwpxDoc, type Para, type Table } from "./hwpx-doc";

export interface OutlineCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  text: string;
}

export interface OutlineTable {
  index: number;
  rowCnt: number;
  colCnt: number;
  cells: OutlineCell[];
}

export interface OutlinePara {
  index: number;
  text: string;
  /** 이 문단에 실린 표의 연번 */
  tables: number[];
}

export interface FormOutline {
  paras: OutlinePara[];
  tables: OutlineTable[];
}

export const paraText = (p: Para): string => p.runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();

function cellText(table: Table, col: number, row: number): string {
  const cell = table.cells.find((c) => c.col === col && c.row === row);
  if (!cell) return "";
  return cell.paragraphs.map(paraText).filter(Boolean).join(" ");
}

/** 파싱 결과 → 문단 연번·표 연번이 붙은 평면 구조. 연번이 곧 TemplateSlot 의 좌표다. */
export function outlineHwpx(doc: HwpxDoc): FormOutline {
  const paras: OutlinePara[] = [];
  const tables: OutlineTable[] = [];
  let paraIndex = 0;
  for (const page of doc.pages) {
    for (const p of page) {
      const tableIdx: number[] = [];
      for (const t of p.tables) {
        const index = tables.length;
        tableIdx.push(index);
        tables.push({
          index,
          rowCnt: t.rowCnt,
          colCnt: t.colCnt,
          cells: t.cells.map((c) => ({
            row: c.row,
            col: c.col,
            rowSpan: c.rowSpan,
            colSpan: c.colSpan,
            text: cellText(t, c.col, c.row),
          })),
        });
      }
      paras.push({ index: paraIndex, text: paraText(p), tables: tableIdx });
      paraIndex += 1;
    }
  }
  return { paras, tables };
}

/** LLM 분석 입력 — 문서 순서대로 문단(연번)과 표(셀 그리드)를 평문으로. */
export function serializeOutline(outline: FormOutline, opts?: { maxCellChars?: number }): string {
  const maxLen = opts?.maxCellChars ?? 80;
  const cut = (s: string) => (s.length > maxLen ? s.slice(0, maxLen) + "…" : s);
  const lines: string[] = [];
  for (const p of outline.paras) {
    if (p.text) lines.push(`[문단 ${p.index}] ${cut(p.text)}`);
    else if (!p.tables.length) lines.push(`[문단 ${p.index}] (빈 줄)`);
    for (const ti of p.tables) {
      const t = outline.tables[ti];
      lines.push(`[표 ${t.index}] (문단 ${p.index}) ${t.rowCnt}행 x ${t.colCnt}열`);
      for (const c of t.cells) {
        const span = c.rowSpan > 1 || c.colSpan > 1 ? ` (span ${c.rowSpan}x${c.colSpan})` : "";
        lines.push(`  r${c.row}c${c.col}${span}: ${cut(c.text) || "(빈칸)"}`);
      }
    }
  }
  return lines.join("\n");
}

// ── 값 주입 좌표계 ──
//
// 주입은 원본 XML 문자열을 직접 고친다(문단 재조립은 표 중첩 때문에 위험 — hwpx.ts 와 같은 판단).
// 최상위 <hp:p> 를 순서대로 훑어 문단 연번을 매기고, 그 안의 <hp:tbl> 로 표 연번을 매긴다.
// outlineHwpx 와 같은 순서를 보장해야 분석 결과의 좌표가 그대로 들어맞는다.

export interface ParaSpan {
  index: number;
  start: number;
  end: number;
  /** 이 문단에 실린 표 연번과 그 XML 구간 */
  tables: { index: number; start: number; end: number }[];
}

/** 최상위 문단 XML 구간을 순서대로 — 중첩(셀 안 문단)은 건너뛴다. */
export function scanParaSpans(xml: string): ParaSpan[] {
  const spans: ParaSpan[] = [];
  const open = /<hp:p\b[^>]*>/g;
  const tblOpen = /<hp:tbl\b[^>]*>/g;
  let m: RegExpExecArray | null;
  let cursor = 0;
  let tableCount = 0;
  while ((m = open.exec(xml))) {
    if (m.index < cursor) continue; // 앞 문단 안에 중첩된 문단
    const end = matchingEnd(xml, m.index, "hp:p");
    if (end < 0) break;
    const body = xml.slice(m.index, end);
    const tables: ParaSpan["tables"] = [];
    tblOpen.lastIndex = 0;
    let t: RegExpExecArray | null;
    let inner = 0;
    while ((t = tblOpen.exec(body))) {
      if (t.index < inner) continue; // 중첩 표
      const tEnd = matchingEnd(body, t.index, "hp:tbl");
      if (tEnd < 0) break;
      tables.push({ index: tableCount, start: m.index + t.index, end: m.index + tEnd });
      tableCount += 1;
      inner = tEnd;
    }
    spans.push({ index: spans.length, start: m.index, end, tables });
    cursor = end;
    open.lastIndex = end;
  }
  return spans;
}

/** 여는 태그 위치에서 짝이 맞는 닫는 태그의 끝 오프셋(없으면 -1). self-closing 은 그 자리에서 끝난다. */
export function matchingEnd(xml: string, openAt: number, tag: string): number {
  const head = /<[^>]*>/g;
  head.lastIndex = openAt;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = head.exec(xml))) {
    const s = m[0];
    if (s.startsWith(`<${tag}`) && /^[\s/>]/.test(s.slice(tag.length + 1))) {
      if (s.endsWith("/>")) {
        if (depth === 0) return m.index + s.length;
      } else depth += 1;
    } else if (s === `</${tag}>`) {
      depth -= 1;
      if (depth === 0) return m.index + s.length;
    }
  }
  return -1;
}

/** 표 XML 구간에서 특정 셀(hp:tc)의 구간을 찾는다. */
export function findCellSpan(tableXml: string, row: number, col: number): { start: number; end: number } | null {
  const open = /<hp:tc\b[^>]*>/g;
  let m: RegExpExecArray | null;
  let cursor = 0;
  while ((m = open.exec(tableXml))) {
    if (m.index < cursor) continue;
    const end = matchingEnd(tableXml, m.index, "hp:tc");
    if (end < 0) break;
    const body = tableXml.slice(m.index, end);
    const addr = /<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"/.exec(body);
    if (addr && Number(addr[2]) === row && Number(addr[1]) === col) return { start: m.index, end };
    cursor = end;
    open.lastIndex = end;
  }
  return null;
}

/** 문단·셀 XML 안의 첫 <hp:t> 텍스트를 새 값으로 바꾸고 나머지 <hp:t> 는 비운다. */
export function replaceTexts(fragment: string, next: string): string {
  let done = false;
  return fragment.replace(/<hp:t>[\s\S]*?<\/hp:t>|<hp:t\/>/g, () => {
    if (done) return "<hp:t></hp:t>";
    done = true;
    return `<hp:t>${escapeXml(next)}</hp:t>`;
  });
}

export function escapeXml(v: string): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 셀 XML 에서 표 자체를 제외한 텍스트만 — 중첩 표가 있으면 셀 본문 판단이 흐려진다. */
export function stripNested(fragment: string): string {
  const at = fragment.indexOf("<hp:tbl");
  return at < 0 ? fragment : fragment.slice(0, at);
}

/** 원본 section XML 을 파싱해 문단/표 좌표계를 얻는다(주입 직전 확인용). */
export function outlineFromXml(xml: string): { paras: number; tables: number } {
  const spans = scanParaSpans(xml);
  return { paras: spans.length, tables: spans.reduce((a, s) => a + s.tables.length, 0) };
}

/** section0.xml 만 쓰는지 확인 — 여러 섹션이면 좌표가 섹션별로 갈린다. */
export function sectionNamesOf(zipFiles: Record<string, unknown>): string[] {
  return Object.keys(zipFiles)
    .filter((n) => /^Contents\/section\d+\.xml$/.test(n))
    .sort();
}

// parseXml/findOne/childrenOf 는 분석 단계에서 부분 파싱이 필요할 때 쓴다.
export { parseXml, findOne, childrenOf };
