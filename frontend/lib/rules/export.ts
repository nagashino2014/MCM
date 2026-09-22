// 내부 규정 출력(PDF·HWPX) — 조문 IR → 흐름형 블록(lib/flowdoc). 일람 화면 표시창(InternalRuleView)과 같은 구성:
// 규정 제목 → 머리 표(규정번호·제정일 / 주관부서·승인, 라벨칸 음영) → 제N장 → 제N조(제목) → 항·호·목 → 부칙 → 별표.
// 항·호·목은 기호 폭만큼 내어쓰기해 둘째 줄이 본문 첫 글자에 맞는다.

import type { TableCell, TextRun } from "@/lib/letter/types";
import type { FlowBlock, FlowTable } from "@/lib/flowdoc/types";
import { itemHead } from "./normalize";
import { formatRegNo, type RuleArticle, type RuleBody, type RuleTable } from "./types";

export interface RuleExportHeader {
  title: string;
  regNo: number | null;
  ownerDept: string | null;
  approver: string | null;
  enactedDate: string | null;
}

const BODY_PT = 11;

function dotDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${y}. ${m}. ${d}.` : iso;
}

const cell = (text: string, opts: { bold?: boolean; align?: "left" | "center" | "right" } = {}): TableCell => ({
  lines: [[{ text, bold: opts.bold }]],
  align: opts.align,
  valign: "middle",
});

/** 병합 정보가 있는 규정 표(셀 나열) → 균일 격자 + 병합 점유 자리(covered) — 공문 표 IR 규약 */
export function ruleTableToFlow(t: RuleTable): FlowTable {
  const grid: (TableCell | null)[][] = [];
  const occupied: boolean[][] = [];
  let cols = 0;
  t.rows.forEach((row, r) => {
    occupied[r] ??= [];
    grid[r] ??= [];
    let c = 0;
    for (const src of row) {
      while (occupied[r][c]) c += 1;
      const cs = Math.max(1, src.colSpan || 1);
      const rs = Math.max(1, src.rowSpan || 1);
      for (let dr = 0; dr < rs; dr += 1) {
        occupied[r + dr] ??= [];
        grid[r + dr] ??= [];
        for (let dc = 0; dc < cs; dc += 1) {
          occupied[r + dr][c + dc] = true;
          grid[r + dr][c + dc] = dr === 0 && dc === 0 ? null : { lines: [[{ text: "" }]], covered: true };
        }
      }
      grid[r][c] = {
        lines: src.text.split("\n").map((ln) => [{ text: ln }]),
        align: r === 0 ? "center" : "left",
        ...(cs > 1 ? { colSpan: cs } : {}),
        ...(rs > 1 ? { rowSpan: rs } : {}),
      };
      c += cs;
      cols = Math.max(cols, c);
    }
  });
  cols = Math.max(cols, 1);
  const rows: TableCell[][] = grid.map((row) =>
    Array.from({ length: cols }, (_, c) => row[c] ?? { lines: [[{ text: "" }]] }),
  );
  return { kind: "table", rows, colRatios: Array.from({ length: cols }, () => 1 / cols), widthPct: 100 };
}

/** 기호 폭(pt) 근사 — 내어쓰기 폭 */
function markWidth(mark: string): number {
  return [...mark].reduce((w, ch) => w + (/[가-힣①-⑳]/.test(ch) ? BODY_PT : BODY_PT * 0.55), 0) + BODY_PT * 0.3;
}

function articleBlocks(a: RuleArticle, opts: { addendum: boolean }): FlowBlock[] {
  const out: FlowBlock[] = [];
  if (a.no > 0) {
    out.push({ kind: "p", runs: [{ text: `제${a.no}조${a.title ? `(${a.title})` : ""}` }], bold: true, spaceBeforePt: 8 });
  }
  const base = opts.addendum && !a.no ? 0 : 12;
  for (const c of a.clauses) {
    if (c.text || c.label) {
      const runs: TextRun[] = [{ text: `${c.label ? `${c.label} ` : ""}${c.text}` }];
      const hang = c.label ? markWidth(c.label) : 0;
      out.push({ kind: "p", runs, leftPt: base + hang, indentPt: -hang });
    }
    for (const it of c.items) {
      const head = itemHead(it);
      const level = head?.level ?? 1;
      const hang = head ? markWidth(head.mark) : 0;
      const left = 20 + (level - 1) * 18;
      out.push({ kind: "p", runs: [{ text: it }], leftPt: left + hang, indentPt: -hang });
    }
  }
  for (const t of a.tables ?? []) out.push({ kind: "table", table: ruleTableToFlow(t) });
  return out;
}

export function buildRuleFlow(header: RuleExportHeader, body: RuleBody): FlowBlock[] {
  const blocks: FlowBlock[] = [];
  blocks.push({ kind: "p", runs: [{ text: header.title || "(제목 없음)" }], align: "center", sizePt: 18, bold: true });
  blocks.push({ kind: "p", runs: [{ text: "" }], sizePt: 6 });
  blocks.push({
    kind: "table",
    shadeCols: [0, 2],
    sizePt: 10.5,
    table: {
      kind: "table",
      widthPct: 100,
      colRatios: [0.16, 0.34, 0.16, 0.34],
      rows: [
        [cell("규정번호", { bold: true, align: "center" }), cell(formatRegNo(header.regNo)), cell("제정일", { bold: true, align: "center" }), cell(dotDate(header.enactedDate))],
        [cell("주관부서", { bold: true, align: "center" }), cell(header.ownerDept || "-"), cell("승인", { bold: true, align: "center" }), cell(header.approver || "-")],
      ],
    },
  });

  const hasChapters = body.chapters.some((c) => c.no > 0);
  for (const ch of body.chapters) {
    if (hasChapters && ch.no > 0) {
      blocks.push({ kind: "p", runs: [{ text: `제 ${ch.no} 장  ${ch.title}` }], sizePt: 13, bold: true, spaceBeforePt: 14 });
    }
    for (const a of ch.articles) blocks.push(...articleBlocks(a, { addendum: false }));
  }

  if (body.addendum.length) {
    blocks.push({ kind: "p", runs: [{ text: "부  칙" }], sizePt: 13, bold: true, spaceBeforePt: 14 });
    for (const a of body.addendum) blocks.push(...articleBlocks(a, { addendum: true }));
  }

  for (const ap of body.appendices) {
    const title = /^별지/.test(ap.title) ? `[${ap.title}]` : `[별표 ${ap.no}] ${ap.title}`;
    blocks.push({ kind: "p", runs: [{ text: title }], bold: true, spaceBeforePt: 14 });
    for (const p of ap.paras) blocks.push({ kind: "p", runs: [{ text: p }] });
    for (const t of ap.tables) blocks.push({ kind: "table", table: ruleTableToFlow(t) });
  }
  return blocks;
}

/** 파일 이름 — '(KESI 규정 제 0001호) 규정명' */
export function ruleExportFileBase(header: RuleExportHeader): string {
  return `(${formatRegNo(header.regNo)}) ${header.title || "내부규정"}`;
}
