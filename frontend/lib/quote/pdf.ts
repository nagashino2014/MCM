// 견적서 PDF 렌더 — 외부 발송·제출 공식 산출물(확정 사항 2: 외부로는 PDF만).
// 실물 견적서 양식 재현(2026-08-05 사용자 2차 피드백): 갑지=로고+주소헤더 박스+첨부목록+인감,
// 견적서=공급자 블록 표(상호·등록번호·대표이사·팩스·담당자·Mobile·E-mail·홈페이지)+브랜드 블루
// 강조(품목 헤더·최종견적금액 행), 별첨=색상 강화+총계(직접인건비) 등급열 병합 중앙.
// 폰트·wrapText·이미지 임베드 패턴은 lib/letter/pdf.ts·lib/approval/doc-pdf.ts 이식.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { COMPANY_KO, COMPANY_CEO, COMPANY_ADDRESS, COMPANY_BIZ_NO, COMPANY_PHONE } from "@/lib/letter/types";
import {
  COMPANY_FAX,
  COMPANY_HOMEPAGE,
  MD_GRADES,
  SUMMARY_SHEET_MIN_SITES,
  QUOTE_VALIDITY_TEXT,
  type QuoteFieldValues,
  type QuoteSite,
} from "./types";
import { gradeTotals, leafRows, laborCostOf, mdVectorTotal } from "./rates";
import { toHangulAmount } from "./hangul-amount";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 48;
const MARGIN_TOP = 52;
const MARGIN_BOTTOM = 56;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const INK = rgb(0.13, 0.16, 0.23);
const MUTED = rgb(0.42, 0.46, 0.55);
const LINE = rgb(0.72, 0.75, 0.8);
const WHITE = rgb(1, 1, 1);
// 차분한 남색 계열(2026-08-05 사용자 확정 — 인쇄물 적합 딥 네이비 #1F3864 톤)
const BRAND = rgb(0.122, 0.22, 0.392); // #1F3864 — 강조 행·라인
const BRAND_DARK = rgb(0.122, 0.22, 0.392); // 헤더 텍스트(동일 톤)
const HEAD_BG = rgb(0.925, 0.941, 0.963); // 연회청 #ECF0F6 — 헤더 배경
const SOFT_BG = rgb(0.961, 0.968, 0.98); // #F5F7FA — 대항목·소계 행 배경

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

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

interface Cell {
  text: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  bg?: ReturnType<typeof rgb>;
  color?: ReturnType<typeof rgb>;
}

class Writer {
  doc: PDFDocument;
  fonts: Fonts;
  page!: PDFPage;
  y = 0;
  /** 페이지 좌우 여백 — 갑지는 30% 넓게 쓴다(사용자 확정). line/text 가 참조. */
  marginX = MARGIN_X;

  get contentW(): number {
    return PAGE_W - this.marginX * 2;
  }

  constructor(doc: PDFDocument, fonts: Fonts) {
    this.doc = doc;
    this.fonts = fonts;
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN_TOP;
  }

  ensure(height: number): void {
    if (this.y - height < MARGIN_BOTTOM) this.newPage();
  }

  text(s: string, x: number, size: number, opts: { bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "center" | "right"; width?: number } = {}): void {
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    let tx = x;
    if (opts.align && opts.align !== "left") {
      const tw = font.widthOfTextAtSize(s, size);
      const w = opts.width ?? CONTENT_W;
      tx = opts.align === "center" ? x + (w - tw) / 2 : x + w - tw;
    }
    this.page.drawText(s, { x: tx, y: this.y - size, size, font, color: opts.color ?? INK });
  }

  line(s: string, size: number, opts: { bold?: boolean; align?: "left" | "center" | "right"; gap?: number; color?: ReturnType<typeof rgb> } = {}): void {
    this.ensure(size + (opts.gap ?? 6));
    this.text(s, this.marginX, size, { bold: opts.bold, align: opts.align, color: opts.color, width: this.contentW });
    this.y -= size + (opts.gap ?? 6);
  }

  gap(h: number): void {
    this.y -= h;
  }

  /** 표 행 — 셀별 배경/글자색 지원. 페이지 넘침 자동 처리. */
  tableRow(cells: Cell[], colRatios: number[], opts: { size?: number; minH?: number } = {}): void {
    const size = opts.size ?? 9;
    const padX = 5;
    const padY = 4.5;
    const widths = colRatios.map((r) => r * CONTENT_W);
    const wrapped = cells.map((c, i) => wrapText(c.text, c.bold ? this.fonts.bold : this.fonts.regular, size, widths[i] - padX * 2));
    const lineH = size * 1.35;
    const rowH = Math.max(opts.minH ?? 0, Math.max(...wrapped.map((w) => w.length)) * lineH + padY * 2);
    this.ensure(rowH);
    const top = this.y;
    let x = MARGIN_X;
    for (let i = 0; i < cells.length; i++) {
      const w = widths[i];
      if (cells[i].bg) {
        this.page.drawRectangle({ x, y: top - rowH, width: w, height: rowH, color: cells[i].bg });
      }
      this.page.drawRectangle({ x, y: top - rowH, width: w, height: rowH, borderColor: LINE, borderWidth: 0.7 });
      const font = cells[i].bold ? this.fonts.bold : this.fonts.regular;
      const lines = wrapped[i];
      let ty = top - (rowH - lines.length * lineH) / 2 - size;
      for (const ln of lines) {
        let tx = x + padX;
        const align = cells[i].align ?? "left";
        if (align !== "left") {
          const tw = font.widthOfTextAtSize(ln, size);
          tx = align === "center" ? x + (w - tw) / 2 : x + w - tw - padX;
        }
        this.page.drawText(ln, { x: tx, y: ty, size, font, color: cells[i].color ?? INK });
        ty -= lineH;
      }
      x += w;
    }
    this.y -= rowH;
  }
}

async function loadFonts(pdf: PDFDocument): Promise<Fonts> {
  pdf.registerFontkit(fontkit);
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  return {
    regular: await pdf.embedFont(await readFile(path.join(fontsDir, "malgun.ttf")), { subset: true }),
    bold: await pdf.embedFont(await readFile(path.join(fontsDir, "malgunbd.ttf")), { subset: true }),
  };
}

async function loadImage(doc: PDFDocument, rel: string): Promise<PDFImage | null> {
  try {
    const bytes = await readFile(path.join(process.cwd(), "public", rel));
    return await doc.embedPng(bytes);
  } catch {
    return null;
  }
}

export interface QuotePdfInput {
  values: QuoteFieldValues;
  quoteNo: string;
  drafterName: string;
  issueDate: string;
}

function fmtDateKo(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}년 ${m}월 ${d}일`;
}

function won(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}

export async function renderQuotePdf(input: QuotePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonts = await loadFonts(pdf);
  // 갑지 로고 — 한글 표기 포함 전용 로고(public/quote/logo.png, 사용자 제공) 우선.
  // 없으면 공문 로고(영문 표기) + 한글 회사명 텍스트 스택으로 폴백.
  const quoteLogo = await loadImage(pdf, "quote/logo.png");
  const letterLogo = quoteLogo ? null : await loadImage(pdf, "letter/logo.png");
  const stamp = await loadImage(pdf, "letter/stamp.png");
  const w = new Writer(pdf, fonts);
  const v = input.values;
  const sites = v.sites ?? [];

  drawCover(w, input, quoteLogo, letterLogo, stamp);
  if (sites.length >= SUMMARY_SHEET_MIN_SITES) {
    w.newPage();
    drawSummary(w, input, stamp);
  }
  for (const site of sites) {
    w.newPage();
    drawSiteQuote(w, input, site, stamp);
    w.newPage();
    drawAnnex(w, site);
  }
  return pdf.save();
}

// ── 갑지 — 실물 양식: 로고 + 주소 헤더 박스 + 일자/수신/용역명 + 첨부 목록 + 서명·인감 ──
function drawCover(w: Writer, input: QuotePdfInput, quoteLogo: PDFImage | null, letterLogo: PDFImage | null, stamp: PDFImage | null): void {
  const v = input.values;
  const r = v.recipients[0];
  const sites = v.sites ?? [];
  // 갑지 전용 좌우 여백 +30% (사용자 확정)
  w.marginX = Math.round(MARGIN_X * 1.3);
  const CM = w.marginX;

  // 로고(중앙) — quote/logo.png(한글 표기 포함, 사용자 원본 소스). 회사명 텍스트를 대체하는
  // 크기(구 로고+회사명 영역 합, 사용자 확정)로 배치. 폴백은 영문 로고+한글 회사명 스택.
  let y = PAGE_H - 44;
  if (quoteLogo) {
    const logoH = 96;
    const logoW = (quoteLogo.width / quoteLogo.height) * logoH;
    w.page.drawImage(quoteLogo, { x: (PAGE_W - logoW) / 2, y: y - logoH, width: logoW, height: logoH });
    y -= logoH + 12;
  } else {
    const logoH = 52;
    const logoW = letterLogo ? (letterLogo.width / letterLogo.height) * logoH : 0;
    if (letterLogo) w.page.drawImage(letterLogo, { x: (PAGE_W - logoW) / 2, y: y - logoH, width: logoW, height: logoH });
    y -= logoH + 6;
    const name = "(주)한국환경안전연구원";
    const nameSize = 14;
    const textW = w.fonts.bold.widthOfTextAtSize(name, nameSize);
    w.page.drawText(name, { x: (PAGE_W - textW) / 2, y: y - nameSize, size: nameSize, font: w.fonts.bold, color: INK });
    y -= nameSize + 14;
  }

  // 주소/전화/팩스 헤더 — 위아래 브랜드 라인 박스. 폰트는 폭 맞춤 축소로 1줄 유지(사용자 확정)
  {
    const headText = `${COMPANY_ADDRESS.replace(" (가산동, 에이스골드타워)", "")}, 에이스골드타워 12층 / Tel.${COMPANY_PHONE} / Fax:${COMPANY_FAX}`;
    const avail = PAGE_W - CM * 2;
    let size = 9.5;
    while (size > 7 && w.fonts.bold.widthOfTextAtSize(headText, size) > avail) size -= 0.2;
    w.page.drawLine({ start: { x: CM - 6, y }, end: { x: PAGE_W - CM + 6, y }, color: BRAND, thickness: 2.2 });
    const tw = w.fonts.bold.widthOfTextAtSize(headText, size);
    w.page.drawText(headText, { x: (PAGE_W - tw) / 2, y: y - 18, size, font: w.fonts.bold, color: INK });
    w.page.drawLine({ start: { x: CM - 6, y: y - 26 }, end: { x: PAGE_W - CM + 6, y: y - 26 }, color: BRAND, thickness: 2.2 });
    y -= 62;
  }

  w.y = y;
  // 일자 위 구분선(용역명 하단과 동일 스타일 — 사용자 확정)
  w.page.drawLine({ start: { x: CM, y: w.y }, end: { x: PAGE_W - CM, y: w.y }, color: LINE, thickness: 0.8 });
  w.gap(20);
  const recipientText = r ? [r.facilityName ?? r.name, r.deptName, r.title].filter(Boolean).join(" ") : "";
  w.line(`일      자 : ${fmtDateKo(input.issueDate)}`, 12.5, { gap: 11 });
  w.line(`수      신 : ${recipientText}`, 12.5, { gap: 11 });
  w.line(`문서번호 : ${input.quoteNo}`, 12.5, { gap: 11 });
  w.line(`용 역 명 : ${v.subject}`, 12.5, { bold: true, gap: 16 });
  w.page.drawLine({ start: { x: CM, y: w.y }, end: { x: PAGE_W - CM, y: w.y }, color: LINE, thickness: 0.8 });
  w.gap(22);

  w.line("1. 귀 사의 무궁한 발전을 기원합니다.", 12, { gap: 13 });
  w.line("2. 상기 제목과 관련하여 견적서를 첨부와 같이 제출합니다.", 12, { gap: 48 });

  // 첨부 목록 — 사업장 여러 개면 번호 목록(총괄 포함), 1개면 한 줄
  const dashPad = (label: string, target = 68) => {
    const n = Math.max(4, target - Math.round(w.fonts.regular.widthOfTextAtSize(label, 11) / 5.4));
    return "-".repeat(n);
  };
  if (sites.length > 1) {
    w.line("첨부", 11.5, { bold: true, gap: 9 });
    const items: string[] = [];
    if (sites.length >= SUMMARY_SHEET_MIN_SITES) items.push(`${v.subject} 견적서(총괄)`);
    for (const s of sites) items.push(`${s.subjectLine} 견적서`);
    items.forEach((label, i) => {
      w.line(`  ${i + 1}. ${label} ${dashPad(`  ${i + 1}. ${label}`)} 1부`, 11, { gap: 8 });
    });
    w.line(`별도첨부 : 직접인건비 산출기준, 인건비 및 제경비 등 단가 ${dashPad("별도첨부 : 직접인건비 산출기준, 인건비 및 제경비 등 단가")} 1부 .  끝 .`, 11, { gap: 8 });
  } else {
    w.line(`첨부 : ${v.subject} 견적서 ${dashPad(`첨부 : ${v.subject} 견적서`)} 1부`, 11, { gap: 9 });
    w.line(`별도첨부 : 직접인건비 산출기준, 인건비 및 제경비 등 단가 ${dashPad("별도첨부 : 직접인건비 산출기준, 인건비 및 제경비 등 단가")} 1부 .  끝 .`, 11, { gap: 8 });
  }

  // 하단 서명 + 인감 — 회사명(붙여쓰기, 자간 분배)과 대표이사 줄의 시작·끝 위치를 일치(사용자 확정)
  {
    const sigY = MARGIN_BOTTOM + 96;
    const name1 = "㈜한국환경안전연구원";
    const name2 = `대 표 이 사        ${COMPANY_CEO.split("").join("   ")}`;
    const s1 = 14; // 16 → -2pt
    const s2 = 12; // 14 → -2pt
    const w2 = w.fonts.bold.widthOfTextAtSize(name2, s2);
    const cx = PAGE_W / 2 + 60;
    const left = cx - w2 / 2;
    // 회사명을 대표이사 줄 폭(w2)에 맞춰 글자 간 간격 균등 분배
    {
      const chars = [...name1];
      const glyphW = chars.reduce((a, ch) => a + w.fonts.bold.widthOfTextAtSize(ch, s1), 0);
      const gapEach = chars.length > 1 ? (w2 - glyphW) / (chars.length - 1) : 0;
      let x = left;
      for (const ch of chars) {
        w.page.drawText(ch, { x, y: sigY + 24, size: s1, font: w.fonts.bold, color: INK });
        x += w.fonts.bold.widthOfTextAtSize(ch, s1) + gapEach;
      }
    }
    w.page.drawText(name2, { x: left, y: sigY, size: s2, font: w.fonts.bold, color: INK });
    if (stamp) {
      const stampW = 54;
      const stampH = (stamp.height / stamp.width) * stampW;
      w.page.drawImage(stamp, { x: left + w2 - 6, y: sigY - stampH * 0.35, width: stampW, height: stampH, opacity: 0.92 });
    }
  }
  w.marginX = MARGIN_X; // 갑지 전용 여백 복원(이후 견적서·별첨 페이지는 기본 여백)
}

// ── 견적서 공통 헤더 — 제목·수신·공급자 블록 표·건명·견적조건·견적금액 ──
function drawQuoteHead(w: Writer, input: QuotePdfInput, subjectLine: string, amount: number, stamp: PDFImage | null): void {
  const v = input.values;
  const r = v.recipients[0];

  // 제목 — 자간 넓은 중앙 + 하단 브랜드 라인
  w.line("견   적   서", 24, { bold: true, align: "center", gap: 6 });
  w.page.drawLine({ start: { x: PAGE_W / 2 - 74, y: w.y }, end: { x: PAGE_W / 2 + 74, y: w.y }, color: BRAND, thickness: 2 });
  w.gap(18);

  const topY = w.y;
  const leftW = CONTENT_W * 0.42;
  const ROW_H = 24; // 좌·우 블록 공통 행 높이(전 행 일치 — 사용자 확정)
  const totalH = ROW_H * 6;

  // 좌: 수신 블록 표 — 회사명(밑줄)/담당자 귀하/TEL/E-mail/아래와 같이 견적합니다/날짜 (실물 양식)
  {
    const contact = v.cc_refs?.[0];
    const bx = MARGIN_X;
    const bw = leftW - 10;
    const rows: { text: string; bold?: boolean; underline?: boolean; size?: number; label?: string }[] = [
      { text: r?.facilityName ?? r?.name ?? "", bold: true, underline: true, size: 12.5 },
      { text: contact ? `${[contact.name, contact.title].filter(Boolean).join(" ")} 귀하` : "귀하", size: 11 },
      { text: (r?.phone ?? contact?.phone ?? "") || "-", label: "T E L :", size: 9.5 },
      { text: contact?.email ?? "-", label: "E·mail :", size: 9.5 },
      { text: "아래와 같이 견적합니다.", size: 10 },
      { text: fmtDateKo(input.issueDate), size: 10 },
    ];
    rows.forEach((row, i) => {
      const ry = topY - ROW_H * i;
      // 행 구분 라인(하단)
      w.page.drawLine({ start: { x: bx, y: ry - ROW_H }, end: { x: bx + bw, y: ry - ROW_H }, color: LINE, thickness: 0.7 });
      const size = row.size ?? 10;
      const font = row.bold ? w.fonts.bold : w.fonts.regular;
      if (row.label) {
        w.page.drawText(row.label, { x: bx + 6, y: ry - ROW_H / 2 - size / 2 + 1, size: 9, font: w.fonts.bold, color: MUTED });
        w.page.drawText(row.text, { x: bx + 52, y: ry - ROW_H / 2 - size / 2 + 1, size, font, color: INK });
      } else {
        const tw = font.widthOfTextAtSize(row.text, size);
        const tx = bx + (bw - tw) / 2;
        const ty = ry - ROW_H / 2 - size / 2 + 1;
        w.page.drawText(row.text, { x: tx, y: ty, size, font, color: INK });
        if (row.underline) {
          w.page.drawLine({ start: { x: tx - 2, y: ty - 3 }, end: { x: tx + tw + 2, y: ty - 3 }, color: INK, thickness: 0.8 });
        }
      }
    });
  }

  // 우: 공급자 블록 표 — "공급자" 세로 라벨 + 6행, 전 행 동일 높이·라벨 중앙 정렬
  {
    const bx = MARGIN_X + leftW;
    const bw = CONTENT_W - leftW;
    const labW = 16; // 세로 '공급자' 칸
    const rows: { cells: { label: string; value: string; valueBold?: boolean; multiline?: boolean }[] }[] = [
      { cells: [{ label: "상    호", value: COMPANY_KO, valueBold: true }] },
      { cells: [{ label: "소 재 지", value: COMPANY_ADDRESS.replace(" (가산동, 에이스골드타워)", ", 에이스골드타워"), multiline: true }] },
      { cells: [{ label: "등록번호", value: COMPANY_BIZ_NO }, { label: "대표이사", value: COMPANY_CEO }] },
      { cells: [{ label: "대표전화", value: COMPANY_PHONE }, { label: "팩    스", value: COMPANY_FAX }] },
      { cells: [{ label: "담 당 자", value: input.drafterName }, { label: "Mobile", value: v.contact_mobile ?? "" }] },
      { cells: [{ label: "E-mail", value: v.contact_email ?? "" }, { label: "홈페이지", value: COMPANY_HOMEPAGE }] },
    ];
    w.page.drawRectangle({ x: bx, y: topY - totalH, width: labW, height: totalH, color: HEAD_BG, borderColor: LINE, borderWidth: 0.7 });
    const vert = "공급자";
    let vy = topY - totalH / 2 + (vert.length * 9) / 2 - 8;
    for (const ch of vert) {
      const cw = w.fonts.bold.widthOfTextAtSize(ch, 8.5);
      w.page.drawText(ch, { x: bx + (labW - cw) / 2, y: vy, size: 8.5, font: w.fonts.bold, color: BRAND_DARK });
      vy -= 13;
    }
    let ry = topY;
    for (const row of rows) {
      const innerX = bx + labW;
      const innerW = bw - labW;
      const cellW = innerW / row.cells.length;
      row.cells.forEach((c, ci) => {
        const cx = innerX + ci * cellW;
        const labelW = 46;
        w.page.drawRectangle({ x: cx, y: ry - ROW_H, width: labelW, height: ROW_H, color: HEAD_BG, borderColor: LINE, borderWidth: 0.7 });
        w.page.drawRectangle({ x: cx + labelW, y: ry - ROW_H, width: cellW - labelW, height: ROW_H, borderColor: LINE, borderWidth: 0.7 });
        const lw = w.fonts.bold.widthOfTextAtSize(c.label, 7.8);
        w.page.drawText(c.label, { x: cx + (labelW - lw) / 2, y: ry - ROW_H / 2 - 3.2, size: 7.8, font: w.fonts.bold, color: BRAND_DARK });
        const vfont = c.valueBold ? w.fonts.bold : w.fonts.regular;
        const maxW = cellW - labelW - 10;
        // 소재지(2행 허용) 외에는 폭 맞춤 폰트 축소로 1줄 유지(E-mail 잘림 방지)
        let vsize = c.valueBold ? 10.5 : 8.6;
        if (!c.multiline) {
          while (vsize > 6 && vfont.widthOfTextAtSize(c.value, vsize) > maxW) vsize -= 0.4;
          w.page.drawText(c.value, { x: cx + labelW + 5, y: ry - ROW_H / 2 - vsize / 2 + 1, size: vsize, font: vfont, color: INK });
        } else {
          const lines = wrapText(c.value, vfont, vsize, maxW);
          let ly = ry - (ROW_H - lines.length * (vsize + 2.5)) / 2 - vsize;
          for (const ln of lines) {
            w.page.drawText(ln, { x: cx + labelW + 5, y: ly, size: vsize, font: vfont, color: INK });
            ly -= vsize + 2.5;
          }
        }
      });
      ry -= ROW_H;
    }
    // 인감 — 대표이사 성명 셀(3행) 중심 오버레이 (+20% 확대: 40→48, 사용자 확정)
    if (stamp) {
      const stampW = 48;
      const stampH = (stamp.height / stamp.width) * stampW;
      w.page.drawImage(stamp, { x: bx + bw - stampW - 8, y: topY - ROW_H * 2.5 - stampH / 2, width: stampW, height: stampH, opacity: 0.9 });
    }
  }
  w.y = topY - totalH - 18;

  w.line(`건    명 : ${subjectLine}`, 12.5, { bold: true, gap: 10 });

  // 견적 조건 — 타이틀 행 + 2행
  w.tableRow([{ text: "견  적  조  건", align: "center", bold: true, bg: HEAD_BG, color: BRAND_DARK }], [1], { size: 9.5 });
  w.tableRow(
    [
      { text: "결재조건", align: "center", bold: true, bg: SOFT_BG },
      { text: "계약조건에 따름" },
      { text: "납품기한", align: "center", bold: true, bg: SOFT_BG },
      { text: "계약조건에 따름" },
    ],
    [0.14, 0.36, 0.14, 0.36],
    { size: 9.5 }
  );
  w.tableRow(
    [
      { text: "납품장소", align: "center", bold: true, bg: SOFT_BG },
      { text: "-" },
      { text: "유효기간", align: "center", bold: true, bg: SOFT_BG },
      { text: QUOTE_VALIDITY_TEXT },
    ],
    [0.14, 0.36, 0.14, 0.36],
    { size: 9.5 }
  );
  w.gap(10);
  w.tableRow(
    [
      { text: "견 적 금 액", bold: true, align: "center", bg: HEAD_BG, color: BRAND_DARK },
      { text: `一金 ${toHangulAmount(amount)} 원정`, bold: true },
      { text: `₩${won(amount)}`, bold: true, align: "right" },
      { text: "(V.A.T별도)", align: "center" },
    ],
    [0.16, 0.44, 0.26, 0.14],
    { size: 11.5, minH: 28 }
  );
  w.gap(12);
}

function drawItemTable(w: Writer, rows: { no: string; label: string; amount: string; note: string; kind?: "item" | "sum" | "final" }[]): void {
  const ratios = [0.08, 0.39, 0.25, 0.28]; // 비고 열을 넓혀 산정기준 문구 1줄 유지(행 높이 통일)
  w.tableRow(
    [
      { text: "NO", align: "center", bold: true, bg: HEAD_BG, color: BRAND_DARK },
      { text: "품 명  및  내 용", align: "center", bold: true, bg: HEAD_BG, color: BRAND_DARK },
      { text: "금   액(원)", align: "center", bold: true, bg: HEAD_BG, color: BRAND_DARK },
      { text: "비  고 (산정기준)", align: "center", bold: true, bg: HEAD_BG, color: BRAND_DARK },
    ],
    ratios,
    { size: 9.5 }
  );
  for (const r of rows) {
    if (r.kind === "final") {
      w.tableRow(
        [
          { text: "", bg: BRAND },
          { text: r.label, bold: true, align: "center", bg: BRAND, color: WHITE },
          { text: r.amount, align: "right", bold: true, bg: BRAND, color: WHITE },
          { text: r.note, align: "center", bg: BRAND, color: WHITE },
        ],
        ratios,
        { size: 11, minH: 29 }
      );
    } else if (r.kind === "sum") {
      w.tableRow(
        [
          { text: "", bg: SOFT_BG },
          { text: r.label, bold: true, align: "center", bg: SOFT_BG },
          { text: r.amount, align: "right", bold: true, bg: SOFT_BG },
          { text: r.note, align: "center", bg: SOFT_BG },
        ],
        ratios,
        { size: 10, minH: 26 }
      );
    } else {
      // 품목 행 높이 통일(사용자 확정) — 비고는 8.5pt 로 1줄 수렴
      const noteFits = w.fonts.regular.widthOfTextAtSize(r.note, 8.5) <= ratios[3] * CONTENT_W - 10;
      w.tableRow(
        [
          { text: r.no, align: "center" },
          { text: r.label },
          { text: r.amount, align: "right" },
          { text: noteFits ? r.note : r.note.replace(" × ", "×"), align: "center" },
        ],
        ratios,
        { size: 9.5, minH: 28 }
      );
    }
  }
}

function drawRemarks(w: Writer, remarks: string): void {
  w.gap(14);
  w.line("<특이사항>", 10, { bold: true, gap: 7 });
  for (const ln of (remarks ?? "").split(/\r?\n/).filter((l) => l.trim())) {
    for (const wrapped of wrapText(ln, w.fonts.regular, 9.5, CONTENT_W)) {
      w.line(wrapped, 9.5, { gap: 4.5 });
    }
  }
}

// ── 총괄 견적서 ──
function drawSummary(w: Writer, input: QuotePdfInput, stamp: PDFImage | null): void {
  const v = input.values;
  const total = v.sites.reduce((a, s) => a + (s.amounts.final || 0), 0);
  drawQuoteHead(w, input, v.subject, total, stamp);
  drawItemTable(w, [
    ...v.sites.map((s, i) => ({ no: String(i + 1), label: s.siteLabel, amount: won(s.amounts.final), note: `[첨 부 ${i + 1}]` })),
    { no: "", label: "합 계 금 액", amount: won(total), note: "", kind: "sum" as const },
    { no: "", label: "최 종 견 적 금 액", amount: won(total), note: "", kind: "final" as const },
  ]);
  drawRemarks(w, v.sites[0]?.remarks ?? "");
}

// ── 사업장별 견적서 ──
function drawSiteQuote(w: Writer, input: QuotePdfInput, site: QuoteSite, stamp: PDFImage | null): void {
  const a = site.amounts;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  drawQuoteHead(w, input, site.subjectLine, a.final, stamp);
  const items = site.freeItems?.length
    ? site.freeItems.map((it, i) => ({ no: String(i + 1), label: it.label, amount: won(it.amount), note: it.note ?? "" }))
    : [
        { no: "1", label: "직접인건비", amount: won(a.laborCost), note: "[별첨 1] [별첨 2]" },
        { no: "2", label: "제   경   비", amount: won(a.overhead), note: `(직접인건비) × ${pct(site.rates.overheadRate)}` },
        { no: "3", label: "기   술   료", amount: won(a.techFee), note: `[직접인건비+제경비] × ${pct(site.rates.techFeeRate)}` },
        ...(a.directExpense > 0
          ? [{ no: "4", label: "직 접 경 비", amount: won(a.directExpense), note: `(직접인건비) × ${pct(site.rates.directExpenseRate)}` }]
          : []),
      ];
  drawItemTable(w, [
    ...items,
    { no: "", label: "합 계 금 액", amount: won(a.sum), note: "", kind: "sum" },
    { no: "", label: "최 종 견 적 금 액", amount: won(a.final), note: "", kind: "final" },
  ]);
  drawRemarks(w, site.remarks);
}

// ── 별첨1(MD 산정) + 별첨2(단가표) ──
function drawAnnex(w: Writer, site: QuoteSite): void {
  const rows = site.mdMatrix ?? [];
  const rates = site.rates;
  // 제목 밑줄 — 제목 길이보다 약간 길게(사용자 확정, 별첨2와 동일 규칙)
  const titleUnderline = (title: string) => {
    const tw = w.fonts.bold.widthOfTextAtSize(title, 12);
    w.page.drawLine({ start: { x: MARGIN_X, y: w.y }, end: { x: MARGIN_X + tw + 14, y: w.y }, color: BRAND, thickness: 1.6 });
  };
  const annex1Title = `[별첨 1] ${site.subjectLine} 직접인건비 산출기준`;
  w.line(annex1Title, 12, { bold: true, gap: 5 });
  titleUnderline(annex1Title);
  w.gap(12);
  const ratios = [0.36, 0.135, 0.135, 0.135, 0.135, 0.1];
  const headCell = (text: string): Cell => ({ text, align: "center", bold: true, bg: HEAD_BG, color: BRAND_DARK });
  w.tableRow(
    [headCell("항   목"), headCell("기술사 or\n특급(MD)"), headCell("고급(MD)"), headCell("중급(MD)"), headCell("초급(MD)"), headCell("비고")],
    ratios,
    { size: 8.5 }
  );
  const parentIds = new Set(rows.map((r) => r.parentId).filter(Boolean));
  for (const r of rows) {
    const isParent = parentIds.has(r.itemId);
    const bg = isParent ? SOFT_BG : undefined;
    w.tableRow(
      [
        { text: (r.parentId ? "  " : "") + r.label, bold: isParent, bg },
        ...MD_GRADES.map((g) => ({ text: String(r.md[g] ?? 0), align: "center" as const, bold: isParent, bg })),
        { text: "-", align: "center", bg },
      ],
      ratios,
      { size: 8.5 }
    );
  }
  const totals = gradeTotals(rows);
  // 총계(MD) — 비고열은 합계 수치만('계' 제거, 사용자 확정)
  w.tableRow(
    [
      { text: "총   계(MD)", bold: true, align: "center", bg: HEAD_BG, color: BRAND_DARK },
      ...MD_GRADES.map((g) => ({ text: String(totals[g] ?? 0), align: "center" as const, bold: true, bg: HEAD_BG })),
      { text: String(mdVectorTotal(totals)), align: "center", bold: true, bg: HEAD_BG, color: BRAND_DARK },
    ],
    ratios,
    { size: 8.5 }
  );
  w.tableRow(
    [
      { text: "소   계(직접인건비)", bold: true, align: "center" },
      ...MD_GRADES.map((g) => ({ text: won((totals[g] ?? 0) * (rates.laborRates[g] ?? 0)), align: "right" as const })),
      { text: "-", align: "center" },
    ],
    ratios,
    { size: 8.5 }
  );
  // 총계(직접인건비) — 등급 4개 열을 병합(가운데 정렬, 사용자 확정)
  const totalLabor = leafRows(rows).reduce((acc, r) => acc + laborCostOf(r.md, rates.laborRates), 0);
  w.tableRow(
    [
      { text: "총   계(직접인건비)", bold: true, align: "center", bg: BRAND, color: WHITE },
      { text: `${won(totalLabor)} 원`, align: "center", bold: true, bg: BRAND, color: WHITE },
      { text: "-", align: "center", bg: BRAND, color: WHITE },
    ],
    [0.36, 0.54, 0.1],
    { size: 9.5, minH: 22 }
  );

  w.gap(22);
  const annex2Title = "[별첨 2] 인건비 및 제경비 등 단가";
  w.line(annex2Title, 12, { bold: true, gap: 5 });
  titleUnderline(annex2Title);
  w.gap(12);
  const r2 = [0.16, 0.2, 0.24, 0.14, 0.26];
  w.tableRow([headCell("분야"), headCell("구분"), headCell("단위 및 규격"), headCell("금액"), headCell("비고")], r2, { size: 8.5 });

  // 분야·비고 열은 그룹 단위 세로 병합(사용자 확정 — 실물 셀 병합 재현)
  const drawGroup = (groupLabel: string, note: string, body: { c1: string; c2: string; c3: string; c3Align?: "right" | "center" }[]) => {
    const rowH = 20; // 별첨2 행 높이 약간 축소(사용자 확정)
    const groupH = rowH * body.length;
    w.ensure(groupH);
    const top = w.y;
    const widths = r2.map((rt) => rt * CONTENT_W);
    const xs = widths.reduce<number[]>((acc, wd, i) => [...acc, (acc[i] ?? MARGIN_X) + wd], [MARGIN_X]);
    // 분야(병합) — 배경 + 세로 중앙
    w.page.drawRectangle({ x: xs[0], y: top - groupH, width: widths[0], height: groupH, color: SOFT_BG, borderColor: LINE, borderWidth: 0.7 });
    {
      const lines = wrapText(groupLabel, w.fonts.bold, 8.5, widths[0] - 10);
      let ly = top - (groupH - lines.length * 11.5) / 2 - 8.5;
      for (const ln of lines) {
        const tw = w.fonts.bold.widthOfTextAtSize(ln, 8.5);
        w.page.drawText(ln, { x: xs[0] + (widths[0] - tw) / 2, y: ly, size: 8.5, font: w.fonts.bold, color: BRAND_DARK });
        ly -= 11.5;
      }
    }
    // 본문 3열(행별)
    body.forEach((row, ri) => {
      const ry = top - rowH * ri;
      const vals: { text: string; align: "left" | "right" | "center"; xi: number }[] = [
        { text: row.c1, align: "left", xi: 1 },
        { text: row.c2, align: "left", xi: 2 },
        { text: row.c3, align: row.c3Align ?? "right", xi: 3 },
      ];
      for (const cell of vals) {
        w.page.drawRectangle({ x: xs[cell.xi], y: ry - rowH, width: widths[cell.xi], height: rowH, borderColor: LINE, borderWidth: 0.7 });
        const tw = w.fonts.regular.widthOfTextAtSize(cell.text, 8.5);
        const tx = cell.align === "right" ? xs[cell.xi] + widths[cell.xi] - tw - 6 : cell.align === "center" ? xs[cell.xi] + (widths[cell.xi] - tw) / 2 : xs[cell.xi] + 6;
        w.page.drawText(cell.text, { x: tx, y: ry - rowH / 2 - 3.5, size: 8.5, font: w.fonts.regular, color: INK });
      }
    });
    // 비고(병합)
    w.page.drawRectangle({ x: xs[4], y: top - groupH, width: widths[4], height: groupH, borderColor: LINE, borderWidth: 0.7 });
    {
      const lines = note.split("\n").flatMap((ln) => wrapText(ln, w.fonts.regular, 8, widths[4] - 10));
      let ly = top - (groupH - lines.length * 10.5) / 2 - 8;
      for (const ln of lines) {
        w.page.drawText(ln, { x: xs[4] + 5, y: ly, size: 8, font: w.fonts.regular, color: INK });
        ly -= 10.5;
      }
    }
    w.y = top - groupH;
  };

  const laborGrades: { grade: string; label: string }[] = [
    { grade: "기술사", label: "기술사" },
    { grade: "특급", label: "특급기술자" },
    { grade: "고급", label: "고급기술자" },
    { grade: "중급", label: "중급기술자" },
    { grade: "초급", label: "초급기술자" },
  ];
  drawGroup(
    "엔지니어링\n기술자\n노임단가",
    `엔지니어링 노임단가 환경부문 적용\n[적용일 : ${rates.laborYear}. 1. 1부터]`,
    laborGrades
      .filter(({ grade }) => rates.laborRates[grade] != null)
      .map(({ grade, label }) => ({ c1: label, c2: "원/일", c3: won(rates.laborRates[grade]) }))
  );
  drawGroup(
    rates.directExpenseRate > 0 ? "직접경비,\n제경비\n및 기술료" : "제경비\n및 기술료",
    "엔지니어링 사업대가의 기준\n[산업통상자원부 고시]",
    [
      ...(rates.directExpenseRate > 0
        ? [{ c1: "직접경비", c2: "상주 인원 인건비 대비", c3: `${Math.round(rates.directExpenseRate * 100)}% 적용`, c3Align: "center" as const }]
        : []),
      { c1: "제경비", c2: "인건비의 110~120%", c3: `${Math.round(rates.overheadRate * 100)}% 적용`, c3Align: "center" as const },
      { c1: "기술료", c2: "인건비+제경비의 20~40%", c3: `${Math.round(rates.techFeeRate * 100)}% 적용`, c3Align: "center" as const },
    ]
  );
}
