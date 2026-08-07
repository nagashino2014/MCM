// 전자결재 문서 PDF 렌더 — ApprovalFormRenderer/ApprovalDocHead 화면 구조를 pdf-lib 로
// 문서형 재현한다(중앙 양식명 → 기안정보표+결재란 → 필드 표 → 결재 의견). 멀티페이지 허용.
// 렌더 패턴은 lib/intel/briefing-pdf.ts(PdfWriter·wrapText·malgun embed)를 이식.
// records 화면의 flatten() 은 DOM(document.createElement) 의존이라 서버판 flattenValue 를 구현
// — multitext HTML 은 lib/letter/html-parse 의 평문 변환을 재사용한다.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { letterHtmlToPlainText } from "@/lib/letter/html-parse";
import { timeRangeText, type ApprovalFieldDef, type ApprovalTableColumn } from "@/lib/approval/fields";
import type { LeaveTypeItem } from "@/lib/approval/leave-types";
import { findInCatalog } from "@/lib/approval/leave-types";
import type { ApprovalDocDetail } from "@/lib/approval/docs";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 48;
const MARGIN_TOP = 52;
const MARGIN_BOTTOM = 56;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const INK = rgb(0.13, 0.16, 0.23);
const MUTED = rgb(0.42, 0.46, 0.55);
const LINE = rgb(0.72, 0.75, 0.8);
const CELL_BG = rgb(0.955, 0.962, 0.975);
const APPROVE_RED = rgb(0.85, 0.2, 0.16);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** 폭 맞춤 줄바꿈(한글 글자 단위 폴백) — briefing-pdf.ts 이식. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
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

/** 필드 값 → 표시 문자열(서버판 — ApprovalRecordsBoard.flatten 과 동일 규칙). */
export function flattenValue(field: ApprovalFieldDef, value: unknown, leaveCatalog: LeaveTypeItem[]): string {
  if (value == null) return "";
  switch (field.type) {
    case "multitext":
      return letterHtmlToPlainText(String(value)).trim();
    case "period": {
      const v = value as { from?: string; to?: string };
      return [v.from, v.to].filter(Boolean).join(" ~ ");
    }
    case "time_range":
      return timeRangeText(value);
    case "checkbox":
      return Array.isArray(value) ? value.map(String).join(", ") : String(value);
    case "user_select":
    case "contact_select": {
      const arr = Array.isArray(value) ? value : [value];
      return arr
        .map((p) => {
          if (p && typeof p === "object") {
            const o = p as { name?: string; title?: string; facilityName?: string };
            return [o.facilityName, o.name, o.title].filter(Boolean).join(" ");
          }
          return String(p ?? "");
        })
        .filter(Boolean)
        .join(", ");
    }
    case "company_select": {
      const v = value as { name?: string; manual?: boolean };
      return v && typeof v === "object" ? `${v.name ?? ""}${v.manual ? " (직접입력)" : ""}` : String(value);
    }
    case "contract_select": {
      const v = value as { title?: string; manual?: boolean };
      return v && typeof v === "object" ? `${v.title ?? ""}${v.manual ? " (직접입력)" : ""}` : String(value);
    }
    case "asset_select": {
      const v = value as { name?: string };
      return v && typeof v === "object" ? String(v.name ?? "") : String(value);
    }
    case "leave_type": {
      const it = findInCatalog(leaveCatalog, value);
      return it ? `${it.label}${it.days != null ? ` (${it.days}일)` : ""}` : String(value);
    }
    case "currency": {
      const n = Number(String(value).replace(/[^\d.-]/g, ""));
      return isNaN(n) ? String(value) : n.toLocaleString("ko-KR");
    }
    default:
      return String(value);
  }
}

function cellText(col: ApprovalTableColumn, row: Record<string, unknown>, idx: number): string {
  if (col.type === "rowno") return String(idx + 1);
  const v = row[col.key];
  if (v == null) return "";
  if (col.type === "people") {
    const arr = Array.isArray(v) ? v : [v];
    return arr
      .map((p) => (p && typeof p === "object" ? String((p as { name?: string }).name ?? "") : String(p ?? "")))
      .filter(Boolean)
      .join(", ");
  }
  if (col.type === "currency") {
    const n = Number(String(v).replace(/[^\d.-]/g, ""));
    return isNaN(n) ? String(v) : n.toLocaleString("ko-KR");
  }
  return String(v);
}

class Writer {
  doc: PDFDocument;
  fonts: Fonts;
  page!: PDFPage;
  y = 0;

  constructor(doc: PDFDocument, fonts: Fonts) {
    this.doc = doc;
    this.fonts = fonts;
    this.addPage();
  }

  addPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN_TOP;
  }

  ensure(need: number) {
    if (this.y - need < MARGIN_BOTTOM) this.addPage();
  }
}

const STEP_STATUS_LABEL: Record<string, string> = {
  approved: "승인",
  rejected: "반려",
  pending: "대기",
  waiting: "예정",
  skipped: "건너뜀",
};

export async function createApprovalDocPdf(doc: ApprovalDocDetail, leaveCatalog: LeaveTypeItem[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const fonts: Fonts = {
    regular: await pdf.embedFont(await readFile(path.join(fontsDir, "malgun.ttf")), { subset: true }),
    bold: await pdf.embedFont(await readFile(path.join(fontsDir, "malgunbd.ttf")), { subset: true }),
  };
  const w = new Writer(pdf, fonts);

  // ── 1) 중앙 양식명(자간 벌림 — ApprovalDocHead 재현) ──
  {
    const title = doc.formName.split("").join(" ");
    const size = 19;
    const tw = fonts.bold.widthOfTextAtSize(title, size);
    w.page.drawText(title, { x: (PAGE_W - tw) / 2, y: w.y - size, size, font: fonts.bold, color: INK });
    w.y -= size + 26;
  }

  // ── 2) 좌 기안정보표 + 우 결재란 ──
  {
    const infoRows: [string, string][] = [
      ["기안자", doc.drafterName ?? "-"],
      ["소속", doc.deptName ?? "-"],
      ["기안일", (doc.submittedAt ?? "").slice(0, 16).replace("T", " ") || "-"],
      ["문서번호", doc.docNo ?? "미채번"],
    ];
    const rowH = 20;
    const labelW = 58;
    const valueW = 170;
    const topY = w.y;
    infoRows.forEach(([label, value], i) => {
      const y0 = topY - i * rowH;
      w.page.drawRectangle({ x: MARGIN_X, y: y0 - rowH, width: labelW, height: rowH, color: CELL_BG, borderColor: LINE, borderWidth: 0.6 });
      w.page.drawRectangle({ x: MARGIN_X + labelW, y: y0 - rowH, width: valueW, height: rowH, borderColor: LINE, borderWidth: 0.6 });
      w.page.drawText(label, { x: MARGIN_X + 8, y: y0 - 14, size: 8.5, font: fonts.bold, color: MUTED });
      const val = wrapText(value, fonts.regular, 9, valueW - 12)[0];
      w.page.drawText(val, { x: MARGIN_X + labelW + 6, y: y0 - 14, size: 9, font: fonts.regular, color: INK });
    });

    // 결재란 — 기안 + 각 단계(승인 스텝 순). 칸: 직위/구분 → 상태 → 이름 → 처리일
    const cells = [
      { role: "기안", name: doc.drafterName ?? "-", position: doc.drafterPosition ?? "", status: "approved", date: (doc.submittedAt ?? "").slice(0, 10) },
      ...doc.steps.map((s) => ({
        role: s.stepType === "agree" ? "합의" : "승인",
        name: s.assigneeName ?? "-",
        position: s.assigneePosition ?? "",
        status: s.status,
        date: (s.actedAt ?? "").slice(0, 10),
      })),
    ];
    const cellW = 64;
    const cellH = 78;
    const totalW = cells.length * cellW;
    const x0 = PAGE_W - MARGIN_X - totalW;
    const yTop = topY;
    cells.forEach((c, i) => {
      const x = x0 + i * cellW;
      w.page.drawRectangle({ x, y: yTop - cellH, width: cellW, height: cellH, borderColor: LINE, borderWidth: 0.6 });
      w.page.drawRectangle({ x, y: yTop - 16, width: cellW, height: 16, color: CELL_BG, borderColor: LINE, borderWidth: 0.6 });
      const roleText = c.position ? `${c.role}·${c.position}` : c.role;
      const rw = fonts.bold.widthOfTextAtSize(roleText, 7.5);
      w.page.drawText(roleText, { x: x + (cellW - rw) / 2, y: yTop - 12, size: 7.5, font: fonts.bold, color: MUTED });
      // 상태(승인 도장 재현 — 원 + 상태 문자)
      const label = STEP_STATUS_LABEL[c.status] ?? c.status;
      const isActed = c.status === "approved" || c.status === "rejected";
      const cy = yTop - 38;
      if (isActed) {
        w.page.drawCircle({ x: x + cellW / 2, y: cy, size: 13, borderColor: APPROVE_RED, borderWidth: 1.4 });
        const lw = fonts.bold.widthOfTextAtSize(label, 8.5);
        w.page.drawText(label, { x: x + (cellW - lw) / 2, y: cy - 3.5, size: 8.5, font: fonts.bold, color: APPROVE_RED });
      } else {
        const lw = fonts.regular.widthOfTextAtSize(label, 8.5);
        w.page.drawText(label, { x: x + (cellW - lw) / 2, y: cy - 3.5, size: 8.5, font: fonts.regular, color: MUTED });
      }
      const nw = fonts.regular.widthOfTextAtSize(c.name, 8.5);
      w.page.drawText(c.name, { x: x + (cellW - nw) / 2, y: yTop - 62, size: 8.5, font: fonts.regular, color: INK });
      if (c.date) {
        const dw = fonts.regular.widthOfTextAtSize(c.date, 7);
        w.page.drawText(c.date, { x: x + (cellW - dw) / 2, y: yTop - 73, size: 7, font: fonts.regular, color: MUTED });
      }
    });

    w.y = topY - Math.max(infoRows.length * rowH, cellH) - 18;
  }

  // ── 3) 문서 제목 ──
  w.ensure(24);
  w.page.drawText(`제목: ${doc.title}`, { x: MARGIN_X, y: w.y - 11, size: 11, font: fonts.bold, color: INK });
  w.y -= 26;

  // ── 4) 필드 표(라벨:값 순차) ──
  const labelW = 104;
  const valueW2 = CONTENT_W - labelW;
  for (const field of doc.fields) {
    const value = doc.fieldValues[field.key];
    if (field.type === "static") {
      const text = field.content ?? "";
      if (!text.trim()) continue;
      const lines = wrapText(text, fonts.regular, 8, CONTENT_W - 12);
      const h = lines.length * 11 + 10;
      w.ensure(h + 4);
      w.page.drawRectangle({ x: MARGIN_X, y: w.y - h, width: CONTENT_W, height: h, color: CELL_BG, borderColor: LINE, borderWidth: 0.5 });
      lines.forEach((ln, i) => w.page.drawText(ln, { x: MARGIN_X + 6, y: w.y - 13 - i * 11, size: 8, font: fonts.regular, color: MUTED }));
      w.y -= h + 4;
      continue;
    }
    if (field.type === "table") {
      // 전폭 표 — tableColumns 헤더 + 행 + (sumColumn 합계)
      const cols = field.tableColumns ?? [];
      if (!cols.length) continue;
      const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
      w.ensure(40);
      w.page.drawText(field.label, { x: MARGIN_X, y: w.y - 10, size: 9.5, font: fonts.bold, color: INK });
      w.y -= 16;
      const colW = CONTENT_W / cols.length;
      const drawRow = (texts: string[], bold: boolean, bg: boolean) => {
        const wrapped = texts.map((t, ci) => wrapText(t, bold ? fonts.bold : fonts.regular, 8, colW - 8));
        const lines = Math.max(...wrapped.map((l) => l.length), 1);
        const rh = lines * 10.5 + 8;
        w.ensure(rh);
        texts.forEach((_, ci) => {
          const x = MARGIN_X + ci * colW;
          w.page.drawRectangle({ x, y: w.y - rh, width: colW, height: rh, color: bg ? CELL_BG : undefined, borderColor: LINE, borderWidth: 0.5 });
          wrapped[ci].forEach((ln, li) => {
            w.page.drawText(ln, { x: x + 4, y: w.y - 11 - li * 10.5, size: 8, font: bold ? fonts.bold : fonts.regular, color: INK });
          });
        });
        w.y -= rh;
      };
      drawRow(cols.map((c) => c.label), true, true);
      rows.forEach((r, i) => drawRow(cols.map((c) => cellText(c, r, i)), false, false));
      if (field.sumColumn && rows.length) {
        const sum = rows.reduce((a, r) => a + (Number(String(r[field.sumColumn!] ?? "").replace(/[^\d.-]/g, "")) || 0), 0);
        drawRow(cols.map((c) => (c.key === field.sumColumn ? sum.toLocaleString("ko-KR") : c.key === cols[0].key ? "합계" : "")), true, true);
      }
      w.y -= 8;
      continue;
    }

    const text = flattenValue(field, value, leaveCatalog);
    const lines = wrapText(text || "-", fonts.regular, 9, valueW2 - 12);
    const h = Math.max(20, lines.length * 12 + 8);
    w.ensure(h);
    w.page.drawRectangle({ x: MARGIN_X, y: w.y - h, width: labelW, height: h, color: CELL_BG, borderColor: LINE, borderWidth: 0.5 });
    w.page.drawRectangle({ x: MARGIN_X + labelW, y: w.y - h, width: valueW2, height: h, borderColor: LINE, borderWidth: 0.5 });
    const labelLines = wrapText(field.label, fonts.bold, 8.5, labelW - 12);
    labelLines.forEach((ln, i) => w.page.drawText(ln, { x: MARGIN_X + 6, y: w.y - 13 - i * 10.5, size: 8.5, font: fonts.bold, color: MUTED }));
    lines.forEach((ln, i) => w.page.drawText(ln, { x: MARGIN_X + labelW + 6, y: w.y - 13.5 - i * 12, size: 9, font: fonts.regular, color: INK }));
    w.y -= h;
  }

  // ── 5) 결재 의견 ──
  const comments = doc.steps.filter((s) => (s.comment ?? "").trim());
  if (comments.length) {
    w.y -= 12;
    w.ensure(30);
    w.page.drawText("결재 의견", { x: MARGIN_X, y: w.y - 10, size: 9.5, font: fonts.bold, color: INK });
    w.y -= 18;
    for (const s of comments) {
      const head = `${s.assigneeName ?? "-"}${s.assigneePosition ? ` ${s.assigneePosition}` : ""} · ${STEP_STATUS_LABEL[s.status] ?? s.status} · ${(s.actedAt ?? "").slice(0, 16).replace("T", " ")}`;
      w.ensure(26);
      w.page.drawText(head, { x: MARGIN_X, y: w.y - 9, size: 8, font: fonts.bold, color: MUTED });
      w.y -= 12;
      for (const ln of wrapText(String(s.comment), fonts.regular, 9, CONTENT_W - 8)) {
        w.ensure(13);
        w.page.drawText(ln, { x: MARGIN_X + 4, y: w.y - 10, size: 9, font: fonts.regular, color: INK });
        w.y -= 13;
      }
      w.y -= 6;
    }
  }

  return pdf.save();
}
