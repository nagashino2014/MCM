// 대금청구서 전용 PDF 렌더러(2026-08-24 리디자인) — 실물 스캔형 HWPX 템플릿(payment.hwpx)
// 좌표 복제 대신 코드로 직접 그린다. 절제된 현대 공문서 톤: 자간 넓은 표제 + 더블 라인,
// 금회 청구금액 강조 요약 박스, 계약금액·기청구·금회·잔액 4행 내역표(공급가/부가세/합계),
// 청구인 블록 + 인감(public/letter/stamp.png). 값 체계는 착수·준공계와 동일(DeliverableValues).
// HWPX 산출물(한글 편집본)은 종전 payment.hwpx 템플릿을 그대로 유지한다(generate.ts).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { toHangulAmount } from "@/lib/quote/hangul-amount";
import { splitVat } from "./data";
import { formatMoney } from "./format";
import { PAGE_H, PAGE_W, type DeliverableValues } from "./types";

const INK = rgb(0.12, 0.13, 0.16);
const NAVY = rgb(0.16, 0.22, 0.4);
const GRAY = rgb(0.44, 0.46, 0.5);
const LINE_C = rgb(0.78, 0.79, 0.82);
const SOFT = rgb(0.956, 0.96, 0.968);
const TINT = rgb(0.922, 0.936, 0.972);

const MARGIN = 62;
const CONTENT_W = PAGE_W - MARGIN * 2;

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

const s = (values: DeliverableValues, key: string): string => String(values[key] ?? "").trim();
const n = (values: DeliverableValues, key: string): number => {
  const v = Number(values[key] ?? 0);
  return Number.isFinite(v) ? v : 0;
};

/** "2026-08-24" → "2026. 08. 24." */
function dotted(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}. ${m[2]}. ${m[3]}.` : iso;
}

/** "2026-08-24" → "2026년 08월 24일" */
function koreanDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}년 ${m[2]}월 ${m[3]}일` : iso;
}

function drawSpaced(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, spacing: number, color = INK) {
  let cx = x;
  for (const ch of text) {
    page.drawText(ch, { x: cx, y, size, font, color });
    cx += font.widthOfTextAtSize(ch, size) + spacing;
  }
}

function spacedWidth(text: string, font: PDFFont, size: number, spacing: number): number {
  if (!text) return 0;
  return font.widthOfTextAtSize(text, size) + spacing * Math.max(0, text.length - 1);
}

/** 폭 초과 시 글자 단위 줄바꿈(계약건명이 긴 경우). */
function wrapChars(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (font.widthOfTextAtSize(cur + ch, size) > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export async function renderPaymentRequestPdf(values: DeliverableValues): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const pick = async (names: string[]) => {
    for (const name of names) {
      try {
        return await readFile(path.join(fontsDir, name));
      } catch {
        /* 다음 후보 */
      }
    }
    throw new Error("본문 글꼴을 찾을 수 없습니다(public/fonts).");
  };
  const fonts: Fonts = {
    regular: await doc.embedFont(await pick(["HANBatang.ttf", "kopub-batang-md.ttf", "malgun.ttf"]), { subset: true }),
    bold: await doc.embedFont(await pick(["HANBatangB.ttf", "kopub-batang-bd.ttf", "malgunbd.ttf"]), { subset: true }),
  };
  let stamp: PDFImage | null = null;
  try {
    stamp = await doc.embedPng(await readFile(path.join(process.cwd(), "public", "letter", "stamp.png")));
  } catch {
    /* 인감 없이 진행 */
  }

  const page = doc.addPage([PAGE_W, PAGE_H]);

  // ── 값 준비 ──
  const vatNote = s(values, "meta.vatNote") || "VAT 별도";
  const vatIncluded = !vatNote.includes("별도");
  const contractAmount = splitVat(n(values, "contract.amount"), vatIncluded);
  const prev = {
    supply: n(values, "completion.prevSupply"),
    vat: n(values, "completion.prevVat"),
    total: n(values, "completion.prevTotal"),
  };
  const cur = {
    supply: n(values, "completion.curSupply"),
    vat: n(values, "completion.curVat"),
    total: n(values, "completion.curTotal"),
  };
  const cum = {
    supply: n(values, "completion.cumSupply"),
    vat: n(values, "completion.cumVat"),
    total: n(values, "completion.cumTotal"),
  };
  const remain = {
    supply: contractAmount.supply - cum.supply,
    vat: contractAmount.vat - cum.vat,
    total: contractAmount.total - cum.total,
  };
  const stageLabel = s(values, "meta.stageLabel") || "준공 기성금";
  const priorLabel = s(values, "meta.priorLabel") || "기지급";
  const issueDate = s(values, "issue.date") || new Date().toISOString().slice(0, 10);
  const ordererName = s(values, "orderer.name");
  const contractTitle = s(values, "contract.title");

  let y = PAGE_H - MARGIN - 24;

  // ── 표제 + 더블 라인 ──
  const title = "대 금 청 구 서";
  const titleW = spacedWidth(title, fonts.bold, 23, 6);
  drawSpaced(page, title, MARGIN + (CONTENT_W - titleW) / 2, y, fonts.bold, 23, 6, NAVY);
  y -= 16;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 1.6, color: NAVY });
  page.drawLine({ start: { x: MARGIN, y: y - 2.6 }, end: { x: MARGIN + CONTENT_W, y: y - 2.6 }, thickness: 0.5, color: NAVY });
  y -= 20;

  // ── 작성일자(우) / 수신(좌) ──
  const dateText = `작성일자 : ${dotted(issueDate)}`;
  page.drawText(dateText, {
    x: MARGIN + CONTENT_W - fonts.regular.widthOfTextAtSize(dateText, 9.5),
    y,
    size: 9.5,
    font: fonts.regular,
    color: GRAY,
  });
  if (ordererName) {
    page.drawText(`수  신 : ${ordererName} 귀하`, { x: MARGIN, y, size: 11.5, font: fonts.bold, color: INK });
  }
  y -= 30;

  // ── 청구 금액 요약 박스 ──
  const boxH = 66;
  page.drawRectangle({ x: MARGIN, y: y - boxH + 12, width: CONTENT_W, height: boxH, color: SOFT });
  page.drawRectangle({ x: MARGIN, y: y - boxH + 12, width: 3.2, height: boxH, color: NAVY });
  const boxPad = 16;
  page.drawText("금회 청구금액", { x: MARGIN + boxPad, y: y - 8, size: 10, font: fonts.bold, color: GRAY });
  page.drawText(`청구 항목 · ${stageLabel}`, { x: MARGIN + boxPad, y: y - boxH + 24, size: 10.5, font: fonts.regular, color: INK });
  const bigAmount = `￦ ${formatMoney(cur.total)}`;
  const bigW = fonts.bold.widthOfTextAtSize(bigAmount, 19);
  page.drawText(bigAmount, { x: MARGIN + CONTENT_W - boxPad - bigW, y: y - 12, size: 19, font: fonts.bold, color: NAVY });
  const hangul = `일금 ${toHangulAmount(cur.total, { leadingOne: true })} 원정 (${vatNote} 합계)`;
  const hangulW = fonts.regular.widthOfTextAtSize(hangul, 9.5);
  page.drawText(hangul, {
    x: MARGIN + CONTENT_W - boxPad - hangulW,
    y: y - boxH + 24,
    size: 9.5,
    font: fonts.regular,
    color: GRAY,
  });
  y -= boxH + 14;

  // ── 계약 정보 ──
  const infoRows: Array<[string, string]> = [
    ["계약건명", contractTitle],
    ["계약금액", `일금 ${toHangulAmount(contractAmount.total, { leadingOne: true })} 원정 (￦ ${formatMoney(contractAmount.total)}, VAT 포함)`],
  ];
  const period = s(values, "contract.period");
  if (period) infoRows.push(["계약기간", period.replace("~", " ~ ")]);
  const labelW = 64;
  for (const [label, value] of infoRows) {
    drawSpaced(page, label, MARGIN + 2, y, fonts.bold, 10, label.length === 3 ? 5.6 : 0.9, GRAY);
    const lines = wrapChars(value, fonts.regular, 10.8, CONTENT_W - labelW - 14);
    for (const line of lines) {
      page.drawText(line, { x: MARGIN + labelW + 14, y, size: 10.8, font: fonts.regular, color: INK });
      y -= 16;
    }
    y -= 2;
  }
  y -= 8;

  // ── 청구 내역 표 ──
  const col0 = 118;
  const colW = (CONTENT_W - col0) / 3;
  const rowH = 25;
  const headers = ["구  분", "공급가액", `부가세`, "합  계"];
  const rows: Array<{ label: string; v: { supply: number; vat: number; total: number }; em?: boolean }> = [
    { label: "계약금액", v: contractAmount },
    { label: priorLabel, v: prev },
    { label: `금회 청구액 (${stageLabel})`, v: cur, em: true },
    { label: "청구 후 잔액", v: remain },
  ];
  const tableTop = y;
  const tableH = rowH * (rows.length + 1);
  // 헤더 배경 + 강조 행 배경
  page.drawRectangle({ x: MARGIN, y: tableTop - rowH, width: CONTENT_W, height: rowH, color: SOFT });
  rows.forEach((r, i) => {
    if (r.em) {
      page.drawRectangle({ x: MARGIN, y: tableTop - rowH * (i + 2), width: CONTENT_W, height: rowH, color: TINT });
    }
  });
  // 헤더 텍스트(중앙)
  headers.forEach((h, i) => {
    const cx = i === 0 ? MARGIN : MARGIN + col0 + colW * (i - 1);
    const cw = i === 0 ? col0 : colW;
    const w = fonts.bold.widthOfTextAtSize(h, 10);
    page.drawText(h, { x: cx + (cw - w) / 2, y: tableTop - rowH + 8.5, size: 10, font: fonts.bold, color: INK });
  });
  // 데이터 행
  rows.forEach((r, i) => {
    const rowY = tableTop - rowH * (i + 2) + 8.5;
    const font = r.em ? fonts.bold : fonts.regular;
    const color = r.em ? NAVY : INK;
    page.drawText(r.label, { x: MARGIN + 10, y: rowY, size: 10, font, color });
    [r.v.supply, r.v.vat, r.v.total].forEach((num, j) => {
      const text = formatMoney(num);
      const w = font.widthOfTextAtSize(text, 10.2);
      page.drawText(text, { x: MARGIN + col0 + colW * (j + 1) - 10 - w, y: rowY, size: 10.2, font, color });
    });
  });
  // 라인 — 외곽 상하 굵게, 내부 가로 가늘게, 세로 구분선
  page.drawLine({ start: { x: MARGIN, y: tableTop }, end: { x: MARGIN + CONTENT_W, y: tableTop }, thickness: 1.1, color: INK });
  page.drawLine({ start: { x: MARGIN, y: tableTop - tableH }, end: { x: MARGIN + CONTENT_W, y: tableTop - tableH }, thickness: 1.1, color: INK });
  for (let i = 1; i <= rows.length; i++) {
    page.drawLine({
      start: { x: MARGIN, y: tableTop - rowH * i },
      end: { x: MARGIN + CONTENT_W, y: tableTop - rowH * i },
      thickness: i === 1 ? 0.9 : 0.45,
      color: i === 1 ? INK : LINE_C,
    });
  }
  for (let j = 0; j <= 2; j++) {
    const x = MARGIN + col0 + colW * j;
    page.drawLine({ start: { x, y: tableTop }, end: { x, y: tableTop - tableH }, thickness: 0.45, color: LINE_C });
  }
  const vatCaption = `※ 부가세 표기 기준 : ${vatNote}`;
  y = tableTop - tableH - 14;
  page.drawText(vatCaption, { x: MARGIN, y, size: 8.8, font: fonts.regular, color: GRAY });
  y -= 24;

  // ── 별첨 ──
  const attachNote = s(values, "payment.attachNote");
  if (attachNote) {
    drawSpaced(page, "별첨", MARGIN + 2, y, fonts.bold, 10.5, 20, GRAY);
    page.drawText(attachNote, { x: MARGIN + labelW + 14, y, size: 10.8, font: fonts.regular, color: INK });
    y -= 34;
  } else {
    y -= 12;
  }

  // ── 클로징 · 날짜 · 청구인 ──
  const closing = "위 금액을 정히 청구합니다.";
  const closingW = spacedWidth(closing, fonts.bold, 12.5, 1.5);
  drawSpaced(page, closing, MARGIN + (CONTENT_W - closingW) / 2, y, fonts.bold, 12.5, 1.5, INK);
  y -= 34;
  const dateKor = koreanDate(issueDate);
  const dateW = fonts.regular.widthOfTextAtSize(dateKor, 11.5);
  page.drawText(dateKor, { x: MARGIN + (CONTENT_W - dateW) / 2, y, size: 11.5, font: fonts.regular, color: INK });
  y -= 44;

  const companyName = s(values, "company.name");
  const companyAddr = s(values, "company.address");
  const ceo = s(values, "company.ceo");
  const nameW = spacedWidth(companyName, fonts.bold, 14, 2);
  drawSpaced(page, companyName, MARGIN + (CONTENT_W - nameW) / 2, y, fonts.bold, 14, 2, INK);
  y -= 18;
  if (companyAddr) {
    const addrW = fonts.regular.widthOfTextAtSize(companyAddr, 9.5);
    page.drawText(companyAddr, { x: MARGIN + (CONTENT_W - addrW) / 2, y, size: 9.5, font: fonts.regular, color: GRAY });
    y -= 24;
  } else {
    y -= 10;
  }
  const ceoLine = `대표이사   ${[...ceo].join(" ")}   (인)`;
  const ceoW = fonts.bold.widthOfTextAtSize(ceoLine, 12.5);
  const ceoX = MARGIN + (CONTENT_W - ceoW) / 2;
  page.drawText(ceoLine, { x: ceoX, y, size: 12.5, font: fonts.bold, color: INK });
  if (stamp) {
    // "(인)" 표기 위에 인감을 겹쳐 찍는다(공문 관례).
    const sealSize = 40;
    const sealMarkW = fonts.bold.widthOfTextAtSize("(인)", 12.5);
    const sealX = ceoX + ceoW - sealMarkW / 2 - sealSize / 2;
    page.drawImage(stamp, { x: sealX, y: y - sealSize / 2 + 4, width: sealSize, height: sealSize, opacity: 0.92 });
  }

  return doc.save();
}
