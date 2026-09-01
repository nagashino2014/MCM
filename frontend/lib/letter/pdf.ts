// 공문 PDF 렌더러 — pdf-lib 단일 페이지(A4 1장 강제). briefing-pdf.ts 의 폰트 embed·
// wrapText 패턴을 이식하되, 공문은 실측 좌표 기반 고정 프레임(상단 헤더·하단 고정부·서명줄)
// 위에 본문만 흐름 배치한다. measure→fit→draw 2패스로 1장 맞춤 파라미터를 확정하고,
// 확정 fit 은 HWPX 생성(hwpx.ts)에도 동일 적용된다.
// 폰트: 맑은 고딕(사용자 확정 — 08-05 실전 생성본 검토 후 명조에서 변경).
// 본문·붙임이 짧은 공문은 서명줄·하단 고정부를 2~3줄 위로 올려 여백을 줄인다(사용자 확정).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  BODY_INDENT,
  CONTENT_W,
  DEFAULT_FIT,
  MARGIN_L,
  MARGIN_R,
  PAGE_H,
  PAGE_W,
  SIGNATURE_Y_BY_GAP,
  type FitParams,
  type LetterBlock,
  type LetterLayout,
  type TextRun,
} from "./types";

const INK = rgb(0.1, 0.1, 0.12);
const LINE_THIN = 0.8;
const LINE_THICK = 2.2;

// 하단 고정부 좌표(하단 기준 pt) — 실측 공문 비율 환산값
const FOOT_THICK_Y = 42; // 최하단 굵은선
const FOOT_PHONE_Y = 58;
const FOOT_ISSUE_Y = 76;
const FOOT_CONTACT_Y = 94;
const FOOT_THIN_Y = 112; // 하단부 상단 얇은선
/** 하단 고정부 줄 간격(pt) — 주소 표기를 켜면 '시행' 위쪽이 이만큼 올라간다 */
const FOOT_ROW_STEP = 18;
const SIGNATURE_CLEARANCE = 40; // 본문 하한 = 서명줄 y + 이 값

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** 폭에 맞춰 단어 단위 줄바꿈(한글은 글자 단위 폴백) — briefing-pdf.ts 이식. */
function wrapPlain(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
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

interface StyledSeg {
  text: string;
  bold: boolean;
  underline: boolean;
}

/** 런 배열을 폭에 맞춰 줄 단위 세그먼트로 분할(서식 보존). */
function wrapRuns(runs: TextRun[], fonts: Fonts, size: number, firstWidth: number, restWidth: number): StyledSeg[][] {
  const lines: StyledSeg[][] = [];
  let cur: StyledSeg[] = [];
  let curW = 0;
  let maxW = firstWidth;
  const pushLine = () => {
    lines.push(cur);
    cur = [];
    curW = 0;
    maxW = restWidth;
  };
  for (const run of runs) {
    const font = run.bold ? fonts.bold : fonts.regular;
    // 단어 단위(공백 보존) 분할 — 한글 장문은 글자 단위 폴백
    const tokens = run.text.split(/(\s+)/).filter((t) => t.length);
    for (const tok of tokens) {
      const w = font.widthOfTextAtSize(tok, size);
      if (curW + w <= maxW) {
        cur.push({ text: tok, bold: !!run.bold, underline: !!run.underline });
        curW += w;
        continue;
      }
      if (/^\s+$/.test(tok)) {
        // 줄 끝 공백은 버림
        pushLine();
        continue;
      }
      if (w > maxW) {
        // 글자 단위 분할
        let chunk = "";
        for (const ch of tok) {
          const cw = font.widthOfTextAtSize(chunk + ch, size);
          if (curW + cw > maxW && (chunk || cur.length)) {
            if (chunk) cur.push({ text: chunk, bold: !!run.bold, underline: !!run.underline });
            pushLine();
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        if (chunk) {
          cur.push({ text: chunk, bold: !!run.bold, underline: !!run.underline });
          curW += font.widthOfTextAtSize(chunk, size);
        }
      } else {
        pushLine();
        cur.push({ text: tok, bold: !!run.bold, underline: !!run.underline });
        curW = w;
      }
    }
  }
  lines.push(cur);
  return lines;
}

function segsWidth(segs: StyledSeg[], fonts: Fonts, size: number): number {
  return segs.reduce((w, s) => w + (s.bold ? fonts.bold : fonts.regular).widthOfTextAtSize(s.text, size), 0);
}

/** 본문 블록 총높이 측정(그리지 않음). 표 포함. lineFactor = 줄 간격 배율(기본 1.6). */
function measureBlocks(blocks: LetterBlock[], attachItems: string[], fonts: Fonts, fit: FitParams, lineFactor = 1.6): number {
  const size = fit.bodyFontPt;
  const lineH = size * lineFactor;
  let h = 0;
  for (const b of blocks) {
    if (b.kind === "p") {
      const extraIndent = b.indentPt ?? 0;
      const firstW = CONTENT_W - BODY_INDENT - extraIndent;
      const restW = CONTENT_W - extraIndent;
      const lines = wrapRuns(b.runs, fonts, size, b.align ? CONTENT_W : firstW, b.align ? CONTENT_W : restW);
      h += lines.length * lineH + 2;
    } else {
      h += measureTable(b, fonts, size) + 6;
    }
  }
  if (attachItems.length) {
    h += attachGap(fit) + attachItems.length * lineH;
  }
  return h;
}

function attachGap(fit: FitParams): number {
  return [22, 14, 8][fit.gapLevel];
}

function topGap(fit: FitParams): number {
  // 제목 구분선과 본문 첫 항목 사이 여백(사용자 지정: 1줄 정도)
  return [18, 14, 10][fit.gapLevel];
}

/**
 * 표 레이아웃 공통 계산(2026-08-25, 셀 병합 지원) — 셀별 줄바꿈 결과와 행 높이.
 * covered(병합 점유) 자리는 null, 병합 시작 셀은 스팬 폭 기준으로 접는다.
 * 행 높이는 1행 스팬 셀로 먼저 정하고, 세로 병합 셀의 내용이 스팬 행 합계보다
 * 크면 마지막 스팬 행에 부족분을 가산한다.
 */
function layoutTable(
  t: Extract<LetterBlock, { kind: "table" }>,
  fonts: Fonts,
  size: number
): { widths: number[]; rowHs: number[]; wrapped: (StyledSeg[][] | null)[][]; cellLineH: number; pad: number } {
  const cellSize = size; // 표 글자 크기 = 본문과 동일(사용자 확정)
  const cellLineH = cellSize * 1.4;
  const pad = 3;
  const widths = t.colRatios.map((r) => r * (CONTENT_W - 2));
  const spanWidth = (ci: number, colSpan: number) =>
    widths.slice(ci, ci + colSpan).reduce((a, b) => a + b, 0);

  const wrapped: (StyledSeg[][] | null)[][] = t.rows.map((row) =>
    row.map((cell, ci) => {
      if (cell.covered) return null;
      const w = spanWidth(ci, cell.colSpan ?? 1) - pad * 2;
      const lines: StyledSeg[][] = [];
      for (const line of cell.lines) {
        for (const seg of wrapRuns(line, fonts, cellSize, w, w)) lines.push(seg);
      }
      return lines.length ? lines : [[{ text: "", bold: false, underline: false }]];
    })
  );

  const rowHs = t.rows.map((row, ri) => {
    let maxLines = 1;
    row.forEach((cell, ci) => {
      if (cell.covered || (cell.rowSpan ?? 1) > 1) return; // 세로 병합 셀은 2차 보정에서
      maxLines = Math.max(maxLines, wrapped[ri][ci]?.length ?? 1);
    });
    return maxLines * cellLineH + pad * 2;
  });
  // 세로 병합 셀 내용이 스팬 행 합계를 넘으면 마지막 스팬 행을 늘린다
  t.rows.forEach((row, ri) => {
    row.forEach((cell, ci) => {
      const rs = cell.rowSpan ?? 1;
      if (cell.covered || rs <= 1) return;
      const need = (wrapped[ri][ci]?.length ?? 1) * cellLineH + pad * 2;
      const got = rowHs.slice(ri, ri + rs).reduce((a, b) => a + b, 0);
      if (need > got) rowHs[Math.min(ri + rs, rowHs.length) - 1] += need - got;
    });
  });
  return { widths, rowHs, wrapped, cellLineH, pad };
}

function measureTable(t: Extract<LetterBlock, { kind: "table" }>, fonts: Fonts, size: number): number {
  return layoutTable(t, fonts, size).rowHs.reduce((a, b) => a + b, 0);
}

async function loadImage(doc: PDFDocument, rel: string): Promise<PDFImage | null> {
  try {
    const bytes = await readFile(path.join(process.cwd(), "public", rel));
    return await doc.embedPng(bytes);
  } catch {
    return null;
  }
}

export interface RenderResult {
  bytes: Uint8Array;
  fit: FitParams;
  /** false 면 최소 fit 으로도 1장 초과 — 상신 차단용 */
  fitted: boolean;
  /** 본문(붙임 포함) 끝 y — HWPX 의 본문 뒤 여백(빈 문단 수) 환산용 */
  bodyEndY: number;
  /** 실제 서명줄 y(짧은 공문 컴팩트 리프트 반영) — HWPX 여백 환산용 */
  signatureY: number;
}

export async function renderLetterPdf(layout: LetterLayout, opts: { fit?: FitParams } = {}): Promise<RenderResult> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const fonts: Fonts = {
    regular: await doc.embedFont(await readFile(path.join(fontsDir, "malgun.ttf")), { subset: true }),
    bold: await doc.embedFont(await readFile(path.join(fontsDir, "malgunbd.ttf")), { subset: true }),
  };
  const logo = await loadImage(doc, "letter/logo.png");
  const stamp = layout.stamp ? await loadImage(doc, "letter/stamp.png") : null;

  const page = doc.addPage([PAGE_W, PAGE_H]);

  // ── 1) 상단 헤더(로고 + 회사명) — 그룹 중앙 정렬 ──
  let y = PAGE_H - 46; // 상단 시작
  {
    // 로고 10% 확대·사명과의 간격 축소·영문 사명은 국문 시작 위치에 맞춘다(2026-08-25 사용자 요청)
    const logoH = 48;
    const logoW = logo ? (logo.width / logo.height) * logoH : 0;
    const nameSize = 21;
    const enSize = 10;
    const gap = 7;
    const nameW = fonts.bold.widthOfTextAtSize(layout.companyKo, nameSize);
    const enW = fonts.bold.widthOfTextAtSize(layout.companyEn, enSize);
    const textW = Math.max(nameW, enW);
    const groupW = logoW + (logoW ? gap : 0) + textW;
    const x0 = (PAGE_W - groupW) / 2;
    const centerY = y - logoH / 2;
    if (logo) page.drawImage(logo, { x: x0, y: y - logoH, width: logoW, height: logoH });
    const tx = x0 + logoW + (logoW ? gap : 0);
    page.drawText(layout.companyKo, { x: tx, y: centerY + 2, size: nameSize, font: fonts.bold, color: INK });
    page.drawText(layout.companyEn, { x: tx, y: centerY - enSize - 3, size: enSize, font: fonts.bold, color: INK });
    y -= logoH + 30;
  }

  // ── 2) 수신/참조/제목(일반) 또는 발신/수신/제목(내용증명) ──
  const headSize = 10.5;
  const headLineH = 19;
  const labelW = fonts.bold.widthOfTextAtSize("수    신", headSize);
  const valueX = MARGIN_L + labelW + fonts.regular.widthOfTextAtSize(" : ", headSize) + 2;
  const headLine = (label: string, value: string, cont = false) => {
    if (!cont) {
      page.drawText(label, { x: MARGIN_L, y: y - headSize, size: headSize, font: fonts.bold, color: INK });
      page.drawText(":", { x: MARGIN_L + labelW + 4, y: y - headSize, size: headSize, font: fonts.regular, color: INK });
    }
    const wrapped = wrapPlain(value, fonts.regular, headSize, PAGE_W - valueX - MARGIN_R);
    for (const ln of wrapped) {
      page.drawText(ln, { x: valueX, y: y - headSize, size: headSize, font: fonts.regular, color: INK });
      y -= headLineH;
    }
  };

  // 제목은 항상 한 줄(사용자 확정 로직) — ① 자간 축소(최대 -10%)를 먼저 시도,
  // ② 그래도 넘치면 자간 -10% 상태로 폰트를 0.5pt 씩 축소해 맞추고,
  // ③ 맞춘 크기에서 자간을 원복(0)해도 한 줄이면 원복, 다시 넘치면 줄인 자간을 유지.
  const subjectLine = () => {
    const availW = PAGE_W - valueX - MARGIN_R;
    page.drawText("제    목", { x: MARGIN_L, y: y - headSize, size: headSize, font: fonts.bold, color: INK });
    page.drawText(":", { x: MARGIN_L + labelW + 4, y: y - headSize, size: headSize, font: fonts.regular, color: INK });
    const widthAt = (pt: number, spacingPct: number) => fonts.regular.widthOfTextAtSize(layout.subject, pt) * (1 + spacingPct / 100);
    let size = layout.overrides?.subjectPt ?? headSize;
    let spacing = 0;
    if (layout.overrides?.subjectPt == null && widthAt(size, 0) > availW) {
      spacing = -10;
      while (size > 7 && widthAt(size, spacing) > availW) size -= 0.5;
      if (widthAt(size, 0) <= availW) spacing = 0; // 자간 원복해도 한 줄이면 원복
    }
    if (spacing === 0) {
      page.drawText(layout.subject, { x: valueX, y: y - headSize, size, font: fonts.regular, color: INK });
    } else {
      // 자간 축소 — 글자별 전진 폭을 배율로 줄여 그린다
      const scale = 1 + spacing / 100;
      let cx = valueX;
      for (const ch of layout.subject) {
        page.drawText(ch, { x: cx, y: y - headSize, size, font: fonts.regular, color: INK });
        cx += fonts.regular.widthOfTextAtSize(ch, size) * scale;
      }
    }
    y -= headLineH;
  };

  if (layout.kind === "proof") {
    const s = layout.proofSender;
    const r = layout.proofReceiver;
    if (s) {
      headLine("발    신", s.address);
      headLine("", `${s.company} (사업자번호 : ${s.bizNo})`, true);
      headLine("", `대표이사 ${s.representative}`, true);
    }
    if (r) {
      headLine("수    신", r.address);
      headLine("", `${r.company} (사업자번호 : ${r.bizNo})`, true);
      headLine("", `대표이사 ${r.representative}`, true);
    }
    subjectLine();
  } else {
    headLine("수    신", layout.receiverText || "-");
    headLine("참    조", layout.refText || "-");
    subjectLine();
  }

  // 제목 아래 굵은 구분선
  y -= 2;
  page.drawLine({ start: { x: MARGIN_L, y }, end: { x: PAGE_W - MARGIN_R, y }, thickness: LINE_THICK, color: INK });
  const titleLineY = y;

  // ── 3) fit 결정(measure) ── 기본 11pt(사용자 확정), 장문에서 단계 축소.
  //     미세조정(overrides)의 bodyFontPt/gapLevel 은 해당 축을 강제하고 나머지 축만 탐색한다.
  const ov = layout.overrides ?? {};
  const lineFactor = ov.lineSpacingPct ? ov.lineSpacingPct / 100 : 1.6;
  const gridFonts = ov.bodyFontPt != null ? [ov.bodyFontPt] : [11, 10.5, 10, 9.5, 9];
  const gridGaps: (0 | 1 | 2)[] = ov.gapLevel != null ? [ov.gapLevel] : [0, 1, 2];
  let fit: FitParams | null = opts.fit ?? null;
  let fitted = true;
  if (fit && ov.bodyFontPt != null) fit = { ...fit, bodyFontPt: ov.bodyFontPt };
  if (fit && ov.gapLevel != null) fit = { ...fit, gapLevel: ov.gapLevel };
  if (!fit) {
    outer: for (const f of gridFonts) {
      for (const g of gridGaps) {
        const cand: FitParams = { bodyFontPt: f, gapLevel: g };
        const h = measureBlocks(layout.bodyBlocks, layout.attachItems, fonts, cand, lineFactor);
        const bottomLimit = SIGNATURE_Y_BY_GAP[g] + SIGNATURE_CLEARANCE;
        if (titleLineY - topGap(cand) - h >= bottomLimit) {
          fit = cand;
          break outer;
        }
      }
    }
    if (!fit) {
      fit = { bodyFontPt: gridFonts[gridFonts.length - 1], gapLevel: gridGaps[gridGaps.length - 1] };
      // 강제 조정값으로 넘치는 건 사용자 선택 — 자동 탐색 실패일 때만 미맞춤으로 보고
      fitted = ov.bodyFontPt != null || ov.gapLevel != null ? true : false;
    }
  }

  // ── 4) 본문 draw ──
  const size = fit.bodyFontPt;
  const lineH = size * lineFactor;
  y = titleLineY - topGap(fit);

  const drawSegsLine = (segs: StyledSeg[], x: number) => {
    let cx = x;
    for (const s of segs) {
      const font = s.bold ? fonts.bold : fonts.regular;
      page.drawText(s.text, { x: cx, y: y - size, size, font, color: INK });
      const w = font.widthOfTextAtSize(s.text, size);
      if (s.underline) {
        page.drawLine({ start: { x: cx, y: y - size - 1.5 }, end: { x: cx + w, y: y - size - 1.5 }, thickness: 0.5, color: INK });
      }
      cx += w;
    }
  };

  for (const b of layout.bodyBlocks) {
    if (b.kind === "p") {
      const extraIndent = b.indentPt ?? 0;
      if (b.align === "center" || b.align === "right") {
        const lines = wrapRuns(b.runs, fonts, size, CONTENT_W, CONTENT_W);
        for (const segs of lines) {
          const w = segsWidth(segs, fonts, size);
          const x = b.align === "center" ? MARGIN_L + (CONTENT_W - w) / 2 : PAGE_W - MARGIN_R - w;
          drawSegsLine(segs, x);
          y -= lineH;
        }
      } else {
        // 기본: 첫 줄 들여쓰기(BODY_INDENT + 에디터 들여쓰기), 이후 줄은 좌여백부터(실측 재현)
        const firstX = MARGIN_L + BODY_INDENT + extraIndent;
        const restX = MARGIN_L + extraIndent;
        const lines = wrapRuns(b.runs, fonts, size, PAGE_W - MARGIN_R - firstX, PAGE_W - MARGIN_R - restX);
        lines.forEach((segs, i) => {
          drawSegsLine(segs, i === 0 ? firstX : restX);
          y -= lineH;
        });
      }
      y -= 2;
    } else {
      y = drawTable(page, b, fonts, size, y);
      y -= 6;
    }
  }

  // ── 5) 붙임 ──
  if (layout.attachItems.length) {
    y -= attachGap(fit);
    const label = "붙  임 : ";
    const labelWidth = fonts.bold.widthOfTextAtSize(label, size);
    const itemX = MARGIN_L + BODY_INDENT * 0.35; // 붙임 라벨은 본문보다 얕은 들여쓰기(실측)
    layout.attachItems.forEach((item, i) => {
      const text = layout.attachItems.length > 1 ? `${i + 1}. ${item}` : item;
      if (i === 0) {
        page.drawText(label, { x: itemX, y: y - size, size, font: fonts.bold, color: INK });
      }
      // 항목 번호를 일렬종대로 — 모든 항목이 label 폭 뒤 동일 x 에서 시작
      page.drawText(text, { x: itemX + labelWidth, y: y - size, size, font: fonts.regular, color: INK });
      y -= lineH;
    });
  }

  const bodyEndY = y;

  // 짧은 공문 컴팩트 배치(사용자 확정) — 본문·붙임이 페이지 상반부에서 끝나면 서명줄과
  // 하단 고정부를 2.5줄(33pt) 위로 올려 중간이 휑하지 않게 한다.
  const footLift = bodyEndY > 450 ? 33 : 0;
  const signatureY = SIGNATURE_Y_BY_GAP[fit.gapLevel] + footLift;

  // ── 6) 서명줄 + 인감 ──
  {
    const sigY = signatureY;
    const sigSize = 15;
    const text = `${layout.companyKo} 대표이사  ${layout.ceoName.split("").join(" ")}`;
    const w = fonts.bold.widthOfTextAtSize(text, sigSize);
    // 완전 중앙보다 1글자 왼쪽 치우침(사용자 확정 — 인감과의 좌우 균형)
    const x = (PAGE_W - w) / 2 - sigSize;
    page.drawText(text, { x, y: sigY, size: sigSize, font: fonts.bold, color: INK });
    if (stamp) {
      const stampW = 52;
      const stampH = (stamp.height / stamp.width) * stampW;
      // 사용자 확정 규칙: 인감 왼쪽 가장자리 = 대표이사 성명 오른쪽 끝 (+미세조정 dx/dy)
      page.drawImage(stamp, {
        x: x + w + (ov.stampDx ?? 0),
        y: sigY - stampH * 0.35 + (ov.stampDy ?? 0),
        width: stampW,
        height: stampH,
        opacity: 0.92,
      });
    }
  }

  // ── 7) 하단 고정부 — 구분선은 위 1개만(상단 구분선과 동일 굵기, 사용자 확정) ──
  {
    const fSize = 10;
    // 주소 한 줄을 넣으면 '시행' 위(담당·구분선)를 한 줄만큼 올린다 — 전화·주소는 제자리
    const addrShift = layout.includeAddress ? FOOT_ROW_STEP : 0;
    page.drawLine({
      start: { x: MARGIN_L, y: FOOT_THIN_Y + addrShift + footLift },
      end: { x: PAGE_W - MARGIN_R, y: FOOT_THIN_Y + addrShift + footLift },
      thickness: LINE_THICK,
      color: INK,
    });
    const contactLabelW = fonts.bold.widthOfTextAtSize("담    당", fSize);
    const put = (label: string, value: string, yy: number) => {
      page.drawText(label, { x: MARGIN_L + 2, y: yy + footLift, size: fSize, font: fonts.bold, color: INK });
      page.drawText(`: ${value}`, { x: MARGIN_L + 2 + contactLabelW + 6, y: yy + footLift, size: fSize, font: fonts.regular, color: INK });
    };
    put("담    당", `${spread(layout.contactName)}  ${layout.contactPosition}`, FOOT_CONTACT_Y + addrShift);
    // 우측: 대표이사
    const ceoText = `대 표 이 사 : ${spread(layout.ceoName)}`;
    page.drawText(ceoText, {
      x: PAGE_W - MARGIN_R - fonts.bold.widthOfTextAtSize(ceoText, fSize) - 12,
      y: FOOT_CONTACT_Y + addrShift + footLift,
      size: fSize,
      font: fonts.bold,
      color: INK,
    });
    put("시    행", `${layout.letterNo ?? "(채번 예정)"}     (${layout.issueDate})`, FOOT_ISSUE_Y + addrShift);
    // 주소 표기(선택) — 시행 아래·전화 위. 켜면 위쪽 줄들이 한 칸 올라간다.
    if (layout.includeAddress) put("주    소", layout.companyAddress, FOOT_ISSUE_Y);
    put("전    화", `${layout.contactPhone}  /  ${layout.contactEmail}`, FOOT_PHONE_Y);
  }

  return { bytes: await doc.save(), fit: fit ?? DEFAULT_FIT, fitted, bodyEndY, signatureY };
}

/** 이름 글자 벌리기 — "이재영" → "이 재 영" (실측 표기 재현). */
function spread(name: string): string {
  const t = (name ?? "").trim();
  return /^[가-힣]{2,4}$/.test(t) ? t.split("").join(" ") : t;
}

/**
 * 서명줄 텍스트 폭 실측(pt) — HWPX 인감 위치 산출용. 맑은 고딕 볼드 메트릭으로 측정한다
 * (한컴에서도 동일 서체를 쓰므로 근사 계수보다 정확).
 */
export async function measureSignTextWidths(companyKo: string, ceoName: string, sigPt = 15): Promise<{ textW: number; nameW: number }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bold = await doc.embedFont(await readFile(path.join(process.cwd(), "public", "fonts", "malgunbd.ttf")), { subset: true });
  const name = spread(ceoName);
  const text = `${companyKo} 대표이사  ${name}`;
  return { textW: bold.widthOfTextAtSize(text, sigPt), nameW: bold.widthOfTextAtSize(name, sigPt) };
}

function drawTable(page: PDFPage, t: Extract<LetterBlock, { kind: "table" }>, fonts: Fonts, size: number, yTop: number): number {
  const cellSize = size; // 표 글자 크기 = 본문과 동일(사용자 확정)
  const { widths, rowHs, wrapped, cellLineH, pad } = layoutTable(t, fonts, size);
  const x0 = MARGIN_L + 1;
  let y = yTop;
  t.rows.forEach((row, ri) => {
    let cx = x0;
    row.forEach((cell, ci) => {
      const cs = cell.colSpan ?? 1;
      const rs = cell.rowSpan ?? 1;
      if (cell.covered) {
        cx += widths[ci];
        return; // 병합에 덮인 자리 — 시작 셀이 스팬 크기로 그린다
      }
      const cellW = widths.slice(ci, ci + cs).reduce((a, b) => a + b, 0);
      const cellH = rowHs.slice(ri, ri + rs).reduce((a, b) => a + b, 0);
      page.drawRectangle({ x: cx, y: y - cellH, width: cellW, height: cellH, borderColor: INK, borderWidth: 0.6 });
      const lines = wrapped[ri][ci] ?? [[{ text: "", bold: false, underline: false }]];
      // 세로 병합 셀은 세로 중앙, 일반 셀은 종전대로 상단 정렬
      const contentH = lines.length * cellLineH;
      let ty = y - pad - (rs > 1 ? Math.max(0, (cellH - pad * 2 - contentH) / 2) : 0);
      for (const segs of lines) {
        const lineW = segs.reduce((w, s) => w + (s.bold ? fonts.bold : fonts.regular).widthOfTextAtSize(s.text, cellSize), 0);
        let sx = cx + pad;
        if (cell.align === "center") sx = cx + (cellW - lineW) / 2;
        else if (cell.align === "right") sx = cx + cellW - pad - lineW;
        let scx = sx;
        for (const s of segs) {
          const font = s.bold ? fonts.bold : fonts.regular;
          page.drawText(s.text, { x: scx, y: ty - cellSize, size: cellSize, font, color: INK });
          scx += font.widthOfTextAtSize(s.text, cellSize);
        }
        ty -= cellLineH;
      }
      cx += widths[ci];
    });
    y -= rowHs[ri];
  });
  return y;
}
