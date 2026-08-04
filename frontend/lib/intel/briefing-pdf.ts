import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { RagBriefing } from "./rag-queries";

/*
 * AI 브리핑 리포트 PDF — 화면(BriefingReportView)의 구조화 리포트를 문서형으로 재현한다.
 * (표 전용 createTablePdf 와는 별개의 전용 렌더러 — roster-pdf 패턴.)
 * A4 세로, 질문/메타 → KPI → 핵심 동향 → 투자계획 상세 → 영업 시사점 → 출처 목록.
 * 본문 [n] 인용 번호는 텍스트 그대로 유지해 출처 목록과 대조할 수 있게 한다.
 */

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN_X = 48;
const MARGIN_TOP = 52;
const MARGIN_BOTTOM = 56;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const INK = rgb(0.13, 0.16, 0.23);
const MUTED = rgb(0.42, 0.46, 0.55);
const PRIMARY = rgb(0.365, 0.529, 1); // #5D87FF
const LINE = rgb(0.85, 0.87, 0.91);
const BOX_BG = rgb(0.955, 0.965, 0.985);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** **굵게**·*약조* 마크업 제거([n] 인용은 유지). */
function stripMd(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
}

/** 폭에 맞춰 단어 단위 줄바꿈(한글은 글자 단위 폴백). */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let cur = "";
    for (const word of para.split(/\s+/)) {
      const cand = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(cand, size) <= maxWidth) {
        cur = cand;
        continue;
      }
      if (cur) lines.push(cur);
      // 단어 자체가 폭 초과(긴 한글 문장 등) — 글자 단위 분할
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

class PdfWriter {
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

  /** 남은 공간이 need 미만이면 페이지 넘김. */
  ensure(need: number) {
    if (this.y - need < MARGIN_BOTTOM) this.addPage();
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; width?: number; gapAfter?: number; lineGap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const x = opts.x ?? MARGIN_X;
    const width = opts.width ?? PAGE_W - x - MARGIN_X;
    const step = size * (opts.lineGap ?? 1.45);
    for (const line of wrapText(text, font, size, width)) {
      this.ensure(step);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= step;
    }
    this.y -= opts.gapAfter ?? 0;
  }

  divider(gap = 10) {
    this.ensure(gap * 2);
    this.y -= gap;
    this.page.drawLine({
      start: { x: MARGIN_X, y: this.y },
      end: { x: PAGE_W - MARGIN_X, y: this.y },
      thickness: 0.7,
      color: LINE,
    });
    this.y -= gap;
  }

  sectionTitle(title: string) {
    this.ensure(34);
    this.y -= 8;
    this.page.drawRectangle({ x: MARGIN_X, y: this.y - 12.5, width: 3, height: 13, color: PRIMARY });
    this.page.drawText(title, { x: MARGIN_X + 9, y: this.y - 11.5, size: 12, font: this.fonts.bold, color: INK });
    this.y -= 24;
  }
}

export async function createBriefingPdf(briefing: RagBriefing): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const fonts: Fonts = {
    regular: await doc.embedFont(await readFile(path.join(fontsDir, "malgun.ttf")), { subset: true }),
    bold: await doc.embedFont(await readFile(path.join(fontsDir, "malgunbd.ttf")), { subset: true }),
  };
  const w = new PdfWriter(doc, fonts);
  const report = briefing.report;

  // ── 헤더: 문서 종류 · 질문 · 메타 ──
  w.text("AI 브리핑 리포트", { size: 9, bold: true, color: PRIMARY, gapAfter: 4 });
  w.text(stripMd(briefing.question), { size: 15.5, bold: true, lineGap: 1.35, gapAfter: 6 });
  const meta = [
    briefing.createdAt ? `생성 ${briefing.createdAt.slice(0, 16).replace("T", " ")}` : null,
    `출처 ${briefing.sources.length}건`,
    briefing.model,
  ].filter(Boolean).join("  ·  ");
  w.text(meta, { size: 8.5, color: MUTED });
  w.divider(12);

  if (report) {
    // ── KPI (2열 박스) ──
    const kpis = report.kpis.slice(0, 4);
    if (kpis.length) {
      const gap = 10;
      const boxW = (CONTENT_W - gap) / 2;
      const boxH = 58;
      for (let rIdx = 0; rIdx < Math.ceil(kpis.length / 2); rIdx++) {
        w.ensure(boxH + gap);
        const rowTop = w.y;
        for (let c = 0; c < 2; c++) {
          const k = kpis[rIdx * 2 + c];
          if (!k) continue;
          const x = MARGIN_X + c * (boxW + gap);
          w.page.drawRectangle({ x, y: rowTop - boxH, width: boxW, height: boxH, color: BOX_BG, borderColor: LINE, borderWidth: 0.7 });
          w.page.drawText(k.label, { x: x + 12, y: rowTop - 17, size: 8, font: fonts.bold, color: MUTED });
          w.page.drawText(k.value, { x: x + 12, y: rowTop - 33, size: 13, font: fonts.bold, color: INK });
          if (k.sub) {
            const sub = stripMd(k.sub);
            const line = wrapText(sub, fonts.regular, 7.5, boxW - 24)[0];
            w.page.drawText(line, { x: x + 12, y: rowTop - 47, size: 7.5, font: fonts.regular, color: MUTED });
          }
        }
        w.y = rowTop - boxH - gap;
      }
    }

    // ── 핵심 동향 ──
    if (report.trends.length) {
      w.sectionTitle("핵심 동향");
      for (const t of report.trends) {
        w.text(`•  ${stripMd(t)}`, { size: 9.5, x: MARGIN_X + 2, gapAfter: 3 });
      }
      w.y -= 6;
    }

    // ── 투자계획 상세 ──
    if (report.companies.length || report.etcNote) {
      w.sectionTitle("투자계획 상세");
      for (const c of report.companies) {
        w.ensure(50);
        const head = [c.name, c.region, c.status].filter(Boolean).join("  ·  ");
        w.text(head, { size: 10.5, bold: true, gapAfter: 1 });
        if (c.project) w.text(stripMd(c.project), { size: 9, bold: true, color: PRIMARY, gapAfter: 2 });
        if (c.desc) w.text(stripMd(c.desc), { size: 9, color: INK, gapAfter: 2 });
        if (c.facts.length) {
          w.text(c.facts.map((f) => `${f.label} ${f.value}`).join("   |   "), { size: 8.5, color: MUTED, gapAfter: 2 });
        }
        if (c.note) w.text(`[${c.note.kind}] ${stripMd(c.note.text)}`, { size: 8.5, color: MUTED, gapAfter: 2 });
        w.divider(6);
      }
      if (report.etcNote) w.text(stripMd(report.etcNote), { size: 8.5, color: MUTED, gapAfter: 4 });
      w.y -= 4;
    }

    // ── 영업 시사점 ──
    if (report.insights.length) {
      w.sectionTitle("영업 시사점");
      for (const ins of report.insights) {
        w.text(`[${ins.badge}]  ${stripMd(ins.text)}`, { size: 9.5, gapAfter: 4 });
      }
      w.y -= 6;
    }
  } else if (briefing.answerMd) {
    // 구버전(비구조화) 브리핑 — 마크다운을 평문으로
    w.text(stripMd(briefing.answerMd.replace(/^#{1,3}\s*/gm, "")), { size: 9.5 });
    w.y -= 8;
  }

  // ── 출처 신호 ──
  if (briefing.sources.length) {
    w.sectionTitle(`출처 신호 (${briefing.sources.length}건)`);
    briefing.sources.forEach((s, i) => {
      const line = [
        `[${i + 1}]`,
        s.source ? s.source.toUpperCase() : null,
        s.companyName ?? "회사 미상",
        s.reportName,
        s.disclosedAt ? s.disclosedAt.slice(0, 10) : null,
      ].filter(Boolean).join("  ·  ");
      w.text(line, { size: 8.5, color: MUTED, gapAfter: 2 });
    });
  }

  return doc.save();
}
