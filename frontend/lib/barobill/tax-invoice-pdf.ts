// 전자세금계산서 보관용 PDF 렌더러 (2026-08-25).
//
// 바로빌 TI API 는 PDF 다운로드를 제공하지 않고 조회/인쇄용 웹 URL 만 준다(전 메서드 실측).
// → 발행 데이터로 표준 전자세금계산서 양식(청색)을 직접 그려 계약 문서함에 보관한다.
// 법적 원본은 국세청·바로빌에 있으므로 이 파일은 보관·증빙용 사본이다(하단에 명시).
// 폰트 로드는 payment-pdf 와 같은 패턴 — 나눔고딕은 fontkit subset 글리프 누락(실측)으로 전체 임베드.

import path from "node:path";
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40; // 좌우 여백
const BOX_W = PAGE_W - M * 2;

const BLUE = rgb(0.13, 0.29, 0.62);
const TINT = rgb(0.93, 0.95, 0.99);
const INK = rgb(0.12, 0.13, 0.16);
const GRAY = rgb(0.45, 0.47, 0.52);

export interface TaxInvoicePdfInput {
  /** 국세청 승인번호 — 전송 완료 전이면 null(문서번호로 대체 표기) */
  ntsSendKey?: string | null;
  mgtKey: string;
  writeDate: string; // YYYY-MM-DD
  amountTotal: number;
  taxTotal: number;
  totalAmount: number;
  taxType: number; // 1 과세 / 2 영세 / 3 면세
  purposeType: number; // 1 영수 / 2 청구
  invoicer: { corpNum: string; corpName: string; ceoName?: string; addr?: string; bizType?: string; bizClass?: string; email?: string };
  invoicee: { corpNum: string; corpName: string; ceoName?: string; addr?: string; email?: string };
  items: Array<{ date?: string; name: string; spec?: string; qty?: string; unitPrice?: number; amount: number; tax: number }>;
  remark?: string | null;
  issuedAt?: string | null;
  /** 수정세금계산서 — 제목·비고에 반영 */
  modifyReason?: string | null;
}

const fmt = (n: number) => (Number.isFinite(n) && n !== 0 ? Math.round(n).toLocaleString("ko-KR") : n === 0 ? "0" : "");
const fmtCorpNum = (v: string) => {
  const d = v.replace(/[^0-9]/g, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : v;
};

function drawCell(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: boolean; border?: boolean } = { border: true }
) {
  if (opts.fill) page.drawRectangle({ x, y, width: w, height: h, color: TINT });
  if (opts.border !== false)
    page.drawRectangle({ x, y, width: w, height: h, borderColor: BLUE, borderWidth: 0.6 });
}

function textIn(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  font: PDFFont,
  size: number,
  opts: { align?: "left" | "center" | "right"; color?: ReturnType<typeof rgb>; padX?: number } = {}
) {
  if (!text) return;
  const padX = opts.padX ?? 4;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > w - padX * 2) t = t.slice(0, -1);
  const tw = font.widthOfTextAtSize(t, size);
  const tx = opts.align === "center" ? x + (w - tw) / 2 : opts.align === "right" ? x + w - padX - tw : x + padX;
  page.drawText(t, { x: tx, y: y + (h - size) / 2 + 1, size, font, color: opts.color ?? INK });
}

export async function renderTaxInvoicePdf(input: TaxInvoicePdfInput): Promise<Uint8Array> {
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
  const embed = async (names: string[]) => {
    const f = await pick(names);
    return doc.embedFont(f.bytes, { subset: !f.name.startsWith("Nanum") });
  };
  const R = await embed(["NanumGothic.ttf", "HANBatang.ttf", "kopub-batang-md.ttf", "malgun.ttf"]);
  const B = await embed(["NanumGothicBold.ttf", "HANBatangB.ttf", "kopub-batang-bd.ttf", "malgunbd.ttf"]);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 60;

  // ── 제목 + 승인번호 ──
  const taxTypeLabel = input.taxType === 2 ? "(영세율)" : input.taxType === 3 ? "(면세)" : "";
  const baseTitle = input.modifyReason ? "수 정 전 자 세 금 계 산 서" : "전 자 세 금 계 산 서";
  const title = baseTitle + (taxTypeLabel ? ` ${taxTypeLabel}` : "");
  const titleSize = 20;
  page.drawText(title, {
    x: M + (BOX_W - B.widthOfTextAtSize(title, titleSize)) / 2,
    y: y - titleSize,
    size: titleSize,
    font: B,
    color: BLUE,
  });
  y -= titleSize + 10;
  const approvalLabel = input.ntsSendKey ? "승인번호" : "문서번호";
  const approvalValue = input.ntsSendKey || input.mgtKey;
  const approvalText = `${approvalLabel} : ${approvalValue}`;
  page.drawText(approvalText, {
    x: M + BOX_W - R.widthOfTextAtSize(approvalText, 8.5),
    y,
    size: 8.5,
    font: R,
    color: GRAY,
  });
  y -= 8;

  // ── 공급자 / 공급받는자 2열 블록 ──
  const half = BOX_W / 2;
  const sideLabelW = 16; // 세로 라벨(공급자/공급받는자)
  const rowLabelW = 52;
  const partyRows: Array<{ label: string; supplier: string; buyer: string }> = [
    { label: "등록번호", supplier: fmtCorpNum(input.invoicer.corpNum), buyer: fmtCorpNum(input.invoicee.corpNum) },
    { label: "상호(법인명)", supplier: input.invoicer.corpName, buyer: input.invoicee.corpName },
    { label: "대표자", supplier: input.invoicer.ceoName ?? "", buyer: input.invoicee.ceoName ?? "" },
    { label: "사업장 주소", supplier: input.invoicer.addr ?? "", buyer: input.invoicee.addr ?? "" },
    { label: "업태 / 종목", supplier: [input.invoicer.bizType, input.invoicer.bizClass].filter(Boolean).join(" / "), buyer: "" },
    { label: "이메일", supplier: input.invoicer.email ?? "", buyer: input.invoicee.email ?? "" },
  ];
  const partyRowH = 19;
  const partyH = partyRows.length * partyRowH;
  const partyTop = y;
  // 세로 라벨 칸
  drawCell(page, M, partyTop - partyH, sideLabelW, partyH, { fill: true });
  drawCell(page, M + half, partyTop - partyH, sideLabelW, partyH, { fill: true });
  const drawVertical = (label: string, cx: number) => {
    const chars = label.split("");
    const total = chars.length * 10;
    let cy = partyTop - (partyH - total) / 2 - 10;
    for (const ch of chars) {
      page.drawText(ch, { x: cx + (sideLabelW - B.widthOfTextAtSize(ch, 8)) / 2, y: cy, size: 8, font: B, color: BLUE });
      cy -= 10;
    }
  };
  drawVertical("공급자", M);
  drawVertical("공급받는자", M + half);
  partyRows.forEach((row, i) => {
    const ry = partyTop - partyRowH * (i + 1);
    // 공급자 열
    drawCell(page, M + sideLabelW, ry, rowLabelW, partyRowH, { fill: true });
    textIn(page, row.label, M + sideLabelW, ry, rowLabelW, partyRowH, R, 7.5, { align: "center", color: BLUE });
    drawCell(page, M + sideLabelW + rowLabelW, ry, half - sideLabelW - rowLabelW, partyRowH);
    textIn(page, row.supplier, M + sideLabelW + rowLabelW, ry, half - sideLabelW - rowLabelW, partyRowH, R, 8.5);
    // 공급받는자 열
    drawCell(page, M + half + sideLabelW, ry, rowLabelW, partyRowH, { fill: true });
    textIn(page, row.label, M + half + sideLabelW, ry, rowLabelW, partyRowH, R, 7.5, { align: "center", color: BLUE });
    drawCell(page, M + half + sideLabelW + rowLabelW, ry, half - sideLabelW - rowLabelW, partyRowH);
    textIn(page, row.buyer, M + half + sideLabelW + rowLabelW, ry, half - sideLabelW - rowLabelW, partyRowH, R, 8.5);
  });
  y = partyTop - partyH - 8;

  // ── 작성일자 · 공급가액 · 세액 ──
  const sumHeadH = 15;
  const sumValH = 22;
  const sumCols = [
    { label: "작성일자", w: 110, value: input.writeDate },
    { label: "공급가액", w: 170, value: fmt(input.amountTotal) },
    { label: "세액", w: 170, value: fmt(input.taxTotal) },
    { label: "비고", w: BOX_W - 110 - 170 - 170, value: [input.modifyReason, input.remark].filter(Boolean).join(" · ") },
  ];
  let cx = M;
  for (const col of sumCols) {
    drawCell(page, cx, y - sumHeadH, col.w, sumHeadH, { fill: true });
    textIn(page, col.label, cx, y - sumHeadH, col.w, sumHeadH, B, 8, { align: "center", color: BLUE });
    drawCell(page, cx, y - sumHeadH - sumValH, col.w, sumValH);
    textIn(page, col.value, cx, y - sumHeadH - sumValH, col.w, sumValH, col.label === "비고" ? R : B, 9.5, {
      align: col.label === "작성일자" ? "center" : col.label === "비고" ? "left" : "right",
    });
    cx += col.w;
  }
  y -= sumHeadH + sumValH + 8;

  // ── 품목 표 ──
  const itemCols = [
    { label: "월일", w: 42 },
    { label: "품목", w: 175 },
    { label: "규격", w: 60 },
    { label: "수량", w: 36 },
    { label: "단가", w: 70 },
    { label: "공급가액", w: 70 },
    { label: "세액", w: 62 },
    { label: "비고", w: BOX_W - 42 - 175 - 60 - 36 - 70 - 70 - 62 },
  ];
  const itemHeadH = 16;
  const itemRowH = 18;
  cx = M;
  for (const col of itemCols) {
    drawCell(page, cx, y - itemHeadH, col.w, itemHeadH, { fill: true });
    textIn(page, col.label, cx, y - itemHeadH, col.w, itemHeadH, B, 8, { align: "center", color: BLUE });
    cx += col.w;
  }
  y -= itemHeadH;
  // 최대 8행 — 초과분은 마지막 행에 "외 N건"으로 합친다(공급가액·세액 합산).
  const MAX_ROWS = 8;
  let rows = input.items.slice();
  if (rows.length > MAX_ROWS) {
    const head = rows.slice(0, MAX_ROWS - 1);
    const rest = rows.slice(MAX_ROWS - 1);
    head.push({
      name: `${rest[0].name} 외 ${rest.length - 1}건`,
      amount: rest.reduce((a, r) => a + r.amount, 0),
      tax: rest.reduce((a, r) => a + r.tax, 0),
    });
    rows = head;
  }
  const rowCount = Math.max(rows.length, 4);
  for (let i = 0; i < rowCount; i++) {
    const it = rows[i];
    const ry = y - itemRowH * (i + 1);
    cx = M;
    const values = it
      ? [
          (it.date ?? "").replace(/^\d{4}-/, "").replace(/^(\d{2})-(\d{2})$/, "$1-$2"),
          it.name,
          it.spec ?? "",
          it.qty ?? "",
          it.unitPrice != null ? fmt(it.unitPrice) : "",
          fmt(it.amount),
          fmt(it.tax),
          "",
        ]
      : ["", "", "", "", "", "", "", ""];
    itemCols.forEach((col, ci) => {
      drawCell(page, cx, ry, col.w, itemRowH);
      textIn(page, values[ci], cx, ry, col.w, itemRowH, R, 8.5, {
        align: ci === 0 || ci === 3 ? "center" : ci >= 4 && ci <= 6 ? "right" : "left",
      });
      cx += col.w;
    });
  }
  y -= itemRowH * rowCount + 8;

  // ── 합계 행 ──
  const totalCols = [
    { label: "합계금액", w: 110, value: fmt(input.totalAmount), bold: true },
    { label: "현금", w: 78, value: "" },
    { label: "수표", w: 78, value: "" },
    { label: "어음", w: 78, value: "" },
    { label: "외상미수금", w: 78, value: "" },
  ];
  const totalW = totalCols.reduce((a, c) => a + c.w, 0);
  const purposeW = BOX_W - totalW;
  cx = M;
  for (const col of totalCols) {
    drawCell(page, cx, y - sumHeadH, col.w, sumHeadH, { fill: true });
    textIn(page, col.label, cx, y - sumHeadH, col.w, sumHeadH, B, 8, { align: "center", color: BLUE });
    drawCell(page, cx, y - sumHeadH - sumValH, col.w, sumValH);
    textIn(page, col.value, cx, y - sumHeadH - sumValH, col.w, sumValH, col.bold ? B : R, 9.5, { align: "right" });
    cx += col.w;
  }
  drawCell(page, cx, y - sumHeadH - sumValH, purposeW, sumHeadH + sumValH);
  const purposeText = `이 금액을 (${input.purposeType === 1 ? "영수" : "청구"}) 함`;
  textIn(page, purposeText, cx, y - sumHeadH - sumValH, purposeW, sumHeadH + sumValH, B, 9.5, { align: "center" });
  y -= sumHeadH + sumValH + 18;

  // ── 하단 각주 ──
  const footer1 = input.ntsSendKey
    ? `국세청 승인번호 ${input.ntsSendKey} · 바로빌 문서번호 ${input.mgtKey}`
    : `바로빌 문서번호 ${input.mgtKey} · 국세청 전송 대기(전송 완료 시 승인번호가 반영됩니다)`;
  const footer2 =
    "본 문서는 바로빌(BaroService)을 통해 전자발행된 세금계산서의 보관용 사본입니다." +
    (input.issuedAt ? ` 발행일시 ${input.issuedAt}` : "");
  page.drawText(footer1, { x: M, y, size: 7.5, font: R, color: GRAY });
  page.drawText(footer2, { x: M, y: y - 11, size: 7.5, font: R, color: GRAY });

  return doc.save();
}
