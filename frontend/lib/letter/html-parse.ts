// 공문 본문 HTML 파서 — MailEditor(contentEditable/execCommand) 출력 서브셋을 IR 로 변환.
// 지원: div/p/br 문단, b/strong/i/em/u 서식, text-align/margin-left(blockquote 포함) 들여쓰기,
// table(인라인 스타일)/tr/td, ul/ol/li(접두 문단으로 정규화).
// 미지원 서식(글꼴·크기·색·이미지·링크)은 텍스트만 보존한다 — 공문은 단일 서체 원칙.
// 외부 HTML 파서 의존성이 없어 자체 태그 스택 파서로 구현(서버/클라이언트 공용).

import type { LetterBlock, ParagraphBlock, TableBlock, TableCell, TextRun } from "./types";

interface Fmt {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

interface Tok {
  tag: string | null; // 소문자 태그명(텍스트 토큰은 null)
  close: boolean;
  selfClose: boolean;
  attrs: string; // 원문 속성 문자열
  text: string; // 텍스트 토큰 원문
}

const ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-zA-Z]+;|&nbsp;/g, (m) => ENTITY_MAP[m] ?? m);
}

function tokenize(html: string): Tok[] {
  const toks: Tok[] = [];
  const re = /<!--[\s\S]*?-->|<[^>]*>|[^<]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[0];
    if (raw.startsWith("<!--")) continue;
    if (raw.startsWith("<")) {
      const tm = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)(\/?)\s*>$/.exec(raw);
      if (!tm) continue;
      toks.push({ tag: tm[2].toLowerCase(), close: tm[1] === "/", selfClose: tm[4] === "/", attrs: tm[3] ?? "", text: "" });
    } else {
      toks.push({ tag: null, close: false, selfClose: false, attrs: "", text: raw });
    }
  }
  return toks;
}

function styleOf(attrs: string): string {
  const m = /style\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
  return (m?.[2] ?? m?.[3] ?? "").toLowerCase();
}

/** td/th 의 rowspan/colspan 속성(1 미만·비수치는 1). */
function spanOf(attrs: string, name: "rowspan" | "colspan"): number {
  const m = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i").exec(attrs);
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n > 1 ? Math.min(n, 100) : 1;
}

function alignOf(style: string): "left" | "center" | "right" | undefined {
  const m = /text-align\s*:\s*(left|center|right|justify)/.exec(style);
  if (!m) return undefined;
  return m[1] === "justify" ? "left" : (m[1] as "left" | "center" | "right");
}

/** margin-left / padding-left(px) → pt (1px = 0.75pt). */
function indentOf(style: string): number {
  const m = /(?:margin|padding)-left\s*:\s*([\d.]+)px/.exec(style);
  return m ? Math.round(Number(m[1]) * 0.75) : 0;
}

const BLOCK_TAGS = new Set(["div", "p", "li", "tr", "table", "ul", "ol", "blockquote", "h1", "h2", "h3", "h4"]);
const SKIP_TAGS = new Set(["script", "style", "head", "img", "hr", "colgroup", "col"]);

/**
 * MailEditor HTML → LetterBlock[].
 * 표는 1단계 중첩까지만(셀 안의 표는 텍스트로 평탄화), 목록은 접두 문단으로 정규화.
 */
export function parseLetterHtml(html: string): LetterBlock[] {
  const toks = tokenize(html ?? "");
  const blocks: LetterBlock[] = [];

  // ── 문단 상태 ──
  const fmtStack: Fmt[] = [{ bold: false, italic: false, underline: false }];
  const fmt = () => fmtStack[fmtStack.length - 1];
  let runs: TextRun[] = [];
  let curAlign: "left" | "center" | "right" | undefined;
  let curIndent = 0; // blockquote/margin-left 누적(pt)
  const indentStack: number[] = [];
  let started = false; // 현재 문단에 내용 유입 여부(연속 flush 로 빈 문단 남발 방지)

  const pushText = (text: string) => {
    if (!text) return;
    const f = fmt();
    const last = runs[runs.length - 1];
    if (last && last.bold === (f.bold || undefined) && last.italic === (f.italic || undefined) && last.underline === (f.underline || undefined)) {
      last.text += text;
    } else {
      runs.push({ text, bold: f.bold || undefined, italic: f.italic || undefined, underline: f.underline || undefined });
    }
    started = true;
  };

  const flushPara = (force = false) => {
    const textLen = runs.reduce((n, r) => n + r.text.length, 0);
    if (!force && textLen === 0) {
      runs = [];
      return;
    }
    const p: ParagraphBlock = { kind: "p", runs: runs.length ? runs : [{ text: "" }] };
    if (curAlign) p.align = curAlign;
    if (curIndent > 0) p.indentPt = curIndent;
    blocks.push(p);
    runs = [];
    started = false;
  };

  // ── 목록 상태 ──
  const listStack: { ordered: boolean; count: number }[] = [];

  // ── 표 상태 ──
  // pending[col] = 위 행의 rowspan 병합이 이 열을 앞으로 몇 행 더 덮는지.
  // 셀을 앉히기 전 커서 위치의 pending 을 covered 플레이스홀더로 소모해
  // rowspan 이 있어도 각 셀이 원래 열에 앉는다(2026-08-25 — 열 밀림 실사례).
  let table: {
    rows: TableCell[][];
    widths: number[];
    curRow: TableCell[] | null;
    curCell: TableCell | null;
    cellRuns: TextRun[];
    depth: number;
    pending: number[];
  } | null = null;

  const coveredCell = (): TableCell => ({ lines: [[{ text: "" }]], covered: true });

  /** 커서(curRow.length) 위치부터 연속된 병합 점유 열을 covered 로 채운다. */
  const consumePending = () => {
    if (!table?.curRow) return;
    while ((table.pending[table.curRow.length] ?? 0) > 0) {
      table.pending[table.curRow.length] -= 1;
      table.curRow.push(coveredCell());
    }
  };

  const flushCellLine = () => {
    if (!table?.curCell) return;
    table.curCell.lines.push(table.cellRuns.length ? table.cellRuns : [{ text: "" }]);
    table.cellRuns = [];
  };

  /** 닫힌 셀을 행에 앉히고 colspan 자리·rowspan 점유를 기록한다. */
  const seatCell = () => {
    if (!table?.curCell || !table.curRow) return;
    const cell = table.curCell;
    const startCol = table.curRow.length;
    const colSpan = cell.colSpan ?? 1;
    const rowSpan = cell.rowSpan ?? 1;
    table.curRow.push(cell);
    for (let i = 1; i < colSpan; i++) table.curRow.push(coveredCell());
    if (rowSpan > 1) {
      for (let i = 0; i < colSpan; i++) table.pending[startCol + i] = rowSpan - 1;
    }
    table.curCell = null;
  };

  for (const t of toks) {
    // ── 텍스트 ──
    if (t.tag === null) {
      const text = decodeEntities(t.text).replace(/[\r\n\t]+/g, " ");
      if (!text) continue;
      if (table?.curCell) {
        const f = fmt();
        table.cellRuns.push({ text, bold: f.bold || undefined, italic: f.italic || undefined, underline: f.underline || undefined });
      } else if (!table) {
        // 블록 사이 공백 텍스트는 무시(문단 안 텍스트만 수집)
        if (text.trim() || started) pushText(text);
      }
      continue;
    }

    const tag = t.tag;
    if (SKIP_TAGS.has(tag)) continue;

    // ── 표 처리 ──
    if (tag === "table") {
      if (t.close) {
        if (table) {
          if (table.depth > 1) {
            table.depth--; // 중첩 표 종료 — 평탄화 계속
          } else {
            flushCellLine();
            seatCell();
            consumePending();
            if (table.curRow?.length) table.rows.push(table.curRow);
            if (table.rows.length) {
              const cols = Math.max(...table.rows.map((r) => r.length));
              // 행별 셀 수 보정(부족분 빈 셀)
              for (const r of table.rows) while (r.length < cols) r.push({ lines: [[{ text: "" }]] });
              const ratios = computeColRatios(table.widths, cols);
              blocks.push({ kind: "table", rows: table.rows, colRatios: ratios } satisfies TableBlock);
            }
            table = null;
          }
        }
      } else if (!t.selfClose) {
        if (table) {
          table.depth++; // 중첩 표 — 텍스트 평탄화
        } else {
          flushPara(); // 표 앞 문단 확정
          table = { rows: [], widths: [], curRow: null, curCell: null, cellRuns: [], depth: 1, pending: [] };
        }
      }
      continue;
    }
    if (table) {
      if (table.depth > 1) continue; // 중첩 표 내부 구조 태그 무시(텍스트만)
      if (tag === "tr") {
        if (t.close) {
          flushCellLine();
          seatCell();
          consumePending(); // 행 끝의 rowspan 점유 열(예: 마지막 열 세로 병합) 채움
          if (table.curRow) table.rows.push(table.curRow);
          table.curRow = null;
        } else {
          table.curRow = [];
        }
        continue;
      }
      if (tag === "td" || tag === "th") {
        if (t.close) {
          flushCellLine();
          seatCell();
        } else {
          if (!table.curRow) table.curRow = [];
          consumePending(); // 셀이 앉을 열 커서를 먼저 확정
          const style = styleOf(t.attrs);
          const colSpan = spanOf(t.attrs, "colspan");
          const rowSpan = spanOf(t.attrs, "rowspan");
          if (table.rows.length === 0) {
            // 첫 행 열 폭 수집 — colspan 셀은 균등 분할해 열 수를 맞춘다
            const wm = /width\s*:\s*([\d.]+)(px|%)/.exec(style);
            const w = wm ? Number(wm[1]) / colSpan : 0;
            for (let i = 0; i < colSpan; i++) table.widths.push(w);
          }
          table.curCell = {
            lines: [],
            align: alignOf(style),
            rowSpan: rowSpan > 1 ? rowSpan : undefined,
            colSpan: colSpan > 1 ? colSpan : undefined,
          };
          table.cellRuns = [];
        }
        continue;
      }
      if (tag === "br" || ((tag === "div" || tag === "p") && t.close)) {
        flushCellLine();
        continue;
      }
      if (tag === "b" || tag === "strong") {
        if (t.close) fmtStack.pop();
        else fmtStack.push({ ...fmt(), bold: true });
        continue;
      }
      if (tag === "i" || tag === "em") {
        if (t.close) fmtStack.pop();
        else fmtStack.push({ ...fmt(), italic: true });
        continue;
      }
      if (tag === "u") {
        if (t.close) fmtStack.pop();
        else fmtStack.push({ ...fmt(), underline: true });
        continue;
      }
      continue; // 표 내부 기타 태그 무시
    }

    // ── 서식 태그 ──
    if (tag === "b" || tag === "strong") {
      if (t.close) fmtStack.length > 1 && fmtStack.pop();
      else fmtStack.push({ ...fmt(), bold: true });
      continue;
    }
    if (tag === "i" || tag === "em") {
      if (t.close) fmtStack.length > 1 && fmtStack.pop();
      else fmtStack.push({ ...fmt(), italic: true });
      continue;
    }
    if (tag === "u") {
      if (t.close) fmtStack.length > 1 && fmtStack.pop();
      else fmtStack.push({ ...fmt(), underline: true });
      continue;
    }
    if (tag === "span" || tag === "font" || tag === "a") continue; // 서식 미지원 — 텍스트만

    // ── 줄바꿈/블록 ──
    if (tag === "br") {
      // <br> = 문단 경계. 내용이 없어도 빈 문단을 만든다 — MailEditor 의 빈 줄은
      // <div><br></div> 형태라, force 없이는 본문 빈 줄이 전부 소실된다(실측 회귀).
      flushPara(true);
      continue;
    }
    if (tag === "blockquote") {
      if (t.close) {
        flushPara();
        curIndent = indentStack.pop() ?? 0;
      } else {
        flushPara();
        indentStack.push(curIndent);
        curIndent += Math.max(indentOf(styleOf(t.attrs)), 30);
      }
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      if (t.close) listStack.pop();
      else listStack.push({ ordered: tag === "ol", count: 0 });
      flushPara();
      continue;
    }
    if (tag === "li") {
      if (t.close) {
        flushPara();
      } else {
        flushPara();
        const list = listStack[listStack.length - 1];
        if (list) {
          list.count++;
          curAlign = undefined;
          pushText(list.ordered ? `${list.count}. ` : "• ");
          started = false; // 접두만으로는 빈 항목 취급
        }
      }
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      if (t.close) {
        flushPara(started);
        curAlign = undefined;
      } else {
        flushPara();
        const style = styleOf(t.attrs);
        curAlign = alignOf(style);
        const ind = indentOf(style);
        if (ind > 0) {
          indentStack.push(curIndent);
          curIndent = ind; // div 자체 margin-left 는 절대값으로
        }
        // div 여는 태그만 있고 닫힘 전 br 없는 빈 div 는 flush 시 정리됨
      }
      continue;
    }
  }
  flushPara(started);
  return blocks;
}

function computeColRatios(widths: number[], cols: number): number[] {
  const w = widths.slice(0, cols);
  while (w.length < cols) w.push(0);
  const known = w.filter((v) => v > 0);
  if (known.length === cols && known.length > 0) {
    const sum = known.reduce((a, b) => a + b, 0);
    return w.map((v) => v / sum);
  }
  return new Array(cols).fill(1 / cols);
}

/** IR → 평문(문단·표 줄 단위 보존). doc-pdf(multitext)·요약 표시 등에서 재사용. */
export function blocksToPlainText(blocks: LetterBlock[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === "p") {
      out.push(b.runs.map((r) => r.text).join(""));
    } else {
      for (const row of b.rows) {
        out.push(
          row
            .filter((c) => !c.covered) // 병합 점유 자리는 내용이 없다
            .map((c) => c.lines.map((l) => l.map((r) => r.text).join("")).join(" "))
            .join(" | ")
        );
      }
    }
  }
  return out.join("\n");
}

/** HTML → 평문 편의 함수. */
export function letterHtmlToPlainText(html: string): string {
  return blocksToPlainText(parseLetterHtml(html));
}
