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

// ⚠나눔고딕에는 ㈜(U+321C) 글리프가 없어 빈칸으로 렌더된다(삼성전기㈜ 수신란 실측, 2026-08-25)
// — 이 렌더러를 지나는 모든 문자열 값에서 "(주)" 표기로 치환한다.
const s = (values: DeliverableValues, key: string): string =>
  String(values[key] ?? "").trim().replace(/㈜/g, "(주)");
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

/**
 * 청구 단위 전개(2026-08-24 사용자 확정) — "1,2차 변경 준공금" 같은 복합 단계명을
 * "1차 변경 준공금"/"2차 변경 준공금" 줄들로 풀어 금회 청구액 아래에 표기한다.
 * "A + B" 조인 라벨은 구분자로 나눈다. 패턴이 아니면 원문 한 줄.
 */
export function expandStageLabels(stageLabel: string): string[] {
  const t = stageLabel.trim();
  if (!t) return [];
  const m = t.match(/^(\d+(?:\s*[,·]\s*\d+)+)\s*차\s*(.*)$/);
  if (m) {
    const nums = m[1].split(/[,·]/).map((x) => x.trim()).filter(Boolean);
    const tail = m[2].trim();
    return nums.map((num) => `${num}차${tail ? ` ${tail}` : ""}`);
  }
  if (t.includes("+")) return t.split("+").map((x) => x.trim()).filter(Boolean);
  return [t];
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
        return { name, bytes: await readFile(path.join(fontsDir, name)) };
      } catch {
        /* 다음 후보 */
      }
    }
    throw new Error("본문 글꼴을 찾을 수 없습니다(public/fonts).");
  };
  // 글꼴은 나눔고딕(사용자 확정, 2026-08-24) — 없으면 명조·맑은고딕 폴백.
  // ⚠나눔고딕 TTF 는 fontkit subset 임베드에서 글리프가 대량 누락된다(실측) — 전체 임베드.
  const embed = async (names: string[]) => {
    const f = await pick(names);
    return doc.embedFont(f.bytes, { subset: !f.name.startsWith("Nanum") });
  };
  const fonts: Fonts = {
    regular: await embed(["NanumGothic.ttf", "HANBatang.ttf", "kopub-batang-md.ttf", "malgun.ttf"]),
    bold: await embed(["NanumGothicBold.ttf", "HANBatangB.ttf", "kopub-batang-bd.ttf", "malgunbd.ttf"]),
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
  // 청구 항목 나열은 하단 표의 단계별 분해와 중복 + 항목이 많으면 우측 한글 금액과 겹친다
  // (2026-08-25 사용자 요청) — 요약 박스는 금액만 표기한다.
  const bigAmount = `￦ ${formatMoney(cur.total)}`;
  const bigW = fonts.bold.widthOfTextAtSize(bigAmount, 19);
  page.drawText(bigAmount, { x: MARGIN + CONTENT_W - boxPad - bigW, y: y - 12, size: 19, font: fonts.bold, color: NAVY });
  // 표기 일관화(2026-08-24 사용자 지적) — 표시 금액은 전부 부가세 포함 합계다.
  // vatNote("VAT 별도")는 단계 금액의 계산 기준(공급가에 10% 가산)일 뿐이라 여기 쓰면 모순처럼 보인다.
  const hangul = `일금 ${toHangulAmount(cur.total, { leadingOne: true })} 원정 (부가세 포함)`;
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

  // ── 청구 내역 표 — 금회 행은 라벨 아래에 청구 단위를 줄바꿈 표기(행 높이 가변) ──
  const col0 = 128;
  const colW = (CONTENT_W - col0) / 3;
  const rowH = 25;
  const subLineH = 12;
  const headers = ["구  분", "공급가액", `부가세`, "합  계"];
  // 금회 하위 줄 — 복수 회차 청구면 단위별 금액(payment.stageBreakdown), 아니면 단계명 전개만.
  interface SubLine {
    label: string;
    v?: { supply: number; vat: number; total: number };
  }
  const rawBreakdown = (() => {
    const v = values["payment.stageBreakdown"];
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v.trim().startsWith("[")) {
      try {
        return JSON.parse(v) as unknown[];
      } catch {
        return [];
      }
    }
    return [];
  })();
  const breakdown: SubLine[] = rawBreakdown
    .map((b) => {
      const o = (b ?? {}) as Record<string, unknown>;
      return {
        label: String(o.label ?? "").trim(),
        v: { supply: Number(o.supply ?? 0), vat: Number(o.vat ?? 0), total: Number(o.total ?? 0) },
      };
    })
    .filter((b) => b.label);
  const stageLines: SubLine[] =
    breakdown.length > 1 ? breakdown : expandStageLabels(stageLabel).map((label) => ({ label }));
  const rows: Array<{ label: string; sub?: SubLine[]; v: { supply: number; vat: number; total: number }; em?: boolean }> = [
    { label: "계약금액", v: contractAmount },
    { label: priorLabel, v: prev },
    { label: "금회 청구액", sub: stageLines, v: cur, em: true },
    { label: "청구 후 잔액", v: remain },
  ];
  const rowHeights = rows.map((r) => rowH + (r.sub?.length ? r.sub.length * subLineH + 3 : 0));
  const tableTop = y;
  const tableH = rowH + rowHeights.reduce((a, b) => a + b, 0);
  const rowTop = (i: number) => tableTop - rowH - rowHeights.slice(0, i).reduce((a, b) => a + b, 0);
  // 헤더 배경 + 강조 행 배경
  page.drawRectangle({ x: MARGIN, y: tableTop - rowH, width: CONTENT_W, height: rowH, color: SOFT });
  rows.forEach((r, i) => {
    if (r.em) {
      page.drawRectangle({ x: MARGIN, y: rowTop(i) - rowHeights[i], width: CONTENT_W, height: rowHeights[i], color: TINT });
    }
  });
  // 헤더 텍스트(중앙)
  headers.forEach((h, i) => {
    const cx = i === 0 ? MARGIN : MARGIN + col0 + colW * (i - 1);
    const cw = i === 0 ? col0 : colW;
    const w = fonts.bold.widthOfTextAtSize(h, 10);
    page.drawText(h, { x: cx + (cw - w) / 2, y: tableTop - rowH + 8.5, size: 10, font: fonts.bold, color: INK });
  });
  // 데이터 행 — 라벨·금액은 첫 줄 기준, 하위 청구 단위는 그 아래 작은 글씨.
  rows.forEach((r, i) => {
    const top = rowTop(i);
    const firstY = top - rowH + 8.5;
    const font = r.em ? fonts.bold : fonts.regular;
    const color = r.em ? NAVY : INK;
    page.drawText(r.label, { x: MARGIN + 10, y: firstY, size: 10, font, color });
    (r.sub ?? []).forEach((line, k) => {
      const subY = firstY - (k + 1) * subLineH;
      page.drawText(`· ${line.label}`, { x: MARGIN + 18, y: subY, size: 8.8, font: fonts.regular, color: GRAY });
      // 단위별 금액(복수 회차 청구) — 공급가액/부가세/합계를 작은 글씨로 우측 정렬.
      if (line.v) {
        [line.v.supply, line.v.vat, line.v.total].forEach((num, j) => {
          const text = formatMoney(num);
          const w = fonts.regular.widthOfTextAtSize(text, 8.8);
          page.drawText(text, { x: MARGIN + col0 + colW * (j + 1) - 10 - w, y: subY, size: 8.8, font: fonts.regular, color: GRAY });
        });
      }
    });
    [r.v.supply, r.v.vat, r.v.total].forEach((num, j) => {
      const text = formatMoney(num);
      const w = font.widthOfTextAtSize(text, 10.2);
      page.drawText(text, { x: MARGIN + col0 + colW * (j + 1) - 10 - w, y: firstY, size: 10.2, font, color });
    });
  });
  // 라인 — 외곽 상하 굵게, 내부 가로 가늘게, 세로 구분선
  page.drawLine({ start: { x: MARGIN, y: tableTop }, end: { x: MARGIN + CONTENT_W, y: tableTop }, thickness: 1.1, color: INK });
  page.drawLine({ start: { x: MARGIN, y: tableTop - tableH }, end: { x: MARGIN + CONTENT_W, y: tableTop - tableH }, thickness: 1.1, color: INK });
  for (let i = 0; i < rows.length; i++) {
    const lineY = rowTop(i);
    page.drawLine({
      start: { x: MARGIN, y: lineY },
      end: { x: MARGIN + CONTENT_W, y: lineY },
      thickness: i === 0 ? 0.9 : 0.45,
      color: i === 0 ? INK : LINE_C,
    });
  }
  for (let j = 0; j <= 2; j++) {
    const x = MARGIN + col0 + colW * j;
    page.drawLine({ start: { x, y: tableTop }, end: { x, y: tableTop - tableH }, thickness: 0.45, color: LINE_C });
  }
  const vatCaption = "※ 합계는 부가세(10%)를 포함한 금액입니다.";
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
  y -= 56;

  const companyName = s(values, "company.name");
  const companyAddr = s(values, "company.address");
  const ceo = s(values, "company.ceo");
  const nameW = spacedWidth(companyName, fonts.bold, 14, 2);
  drawSpaced(page, companyName, MARGIN + (CONTENT_W - nameW) / 2, y, fonts.bold, 14, 2, INK);
  y -= 18;
  if (companyAddr) {
    const addrW = fonts.regular.widthOfTextAtSize(companyAddr, 9.5);
    page.drawText(companyAddr, { x: MARGIN + (CONTENT_W - addrW) / 2, y, size: 9.5, font: fonts.regular, color: GRAY });
    y -= 36;
  } else {
    y -= 14;
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
