// 법인카드 매출전표(사용내역 증빙) PDF — 카드사 승인내역 원장(card_transactions) 기반 자동 생성.
// 실물 전표가 없는 법인카드 건의 결재 증빙용 — 건당 1장, 지출결의서·출장보고서의
// 법인카드 내역 불러오기 시 첨부서류(field_values.file_attachments)로 실린다(2026-08-26 사용자 확정).
// 폰트 로드는 receipt-pdf.ts 관례(public/fonts/malgun.ttf 캐시).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 56;

let fontCache: Buffer | null = null;
let fontBoldCache: Buffer | null = null;

async function loadFont(bold: boolean): Promise<Buffer> {
  if (bold) {
    if (!fontBoldCache) fontBoldCache = await readFile(path.join(process.cwd(), "public", "fonts", "malgunbd.ttf"));
    return fontBoldCache;
  }
  if (!fontCache) fontCache = await readFile(path.join(process.cwd(), "public", "fonts", "malgun.ttf"));
  return fontCache;
}

export interface CardSlipData {
  cardAlias: string | null;
  cardCompany: string | null;
  cardLast4: string | null;
  approvalNum: string | null;
  approvedAt: string | null; // YYYY-MM-DD HH:MI:SS
  storeName: string | null;
  storeCeo: string | null;
  storeCorpNum: string | null;
  storeBizType: string | null;
  storeAddr: string | null;
  supplyAmount: number | null;
  taxAmount: number | null;
  amountTotal: number;
  holderName: string | null; // 카드 소지 직원
}

const won = (n: number | null | undefined) => (n != null ? `${Math.round(n).toLocaleString("ko-KR")}원` : "-");

/** 승인내역 1건 → A4 전표 1장. */
export async function buildCardSlipPdf(data: CardSlipData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await loadFont(false), { subset: true });
  const bold = await doc.embedFont(await loadFont(true), { subset: true });
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const INK = rgb(0.1, 0.1, 0.12);
  const GRAY = rgb(0.45, 0.45, 0.5);
  const LINE = rgb(0.78, 0.79, 0.82);

  let y = PAGE_H - MARGIN - 10;
  const title = "법인카드 매출전표";
  const titleSize = 20;
  page.drawText(title, { x: (PAGE_W - bold.widthOfTextAtSize(title, titleSize)) / 2, y, size: titleSize, font: bold, color: INK });
  y -= 12;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.4, color: INK });
  y -= 4;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: INK });
  y -= 26;

  const cardLabel = [data.cardCompany, data.cardAlias].filter(Boolean).join(" ") || "법인카드";
  const rows: Array<[string, string, boolean?]> = [
    ["카드", `${cardLabel}${data.cardLast4 ? ` (****-${data.cardLast4})` : ""}`],
    ["소지자", data.holderName ?? "-"],
    ["승인번호", data.approvalNum ?? "-"],
    ["승인일시", data.approvedAt ?? "-"],
    ["가맹점명", data.storeName ?? "-"],
    ["대표자", data.storeCeo ?? "-"],
    ["사업자번호", data.storeCorpNum ?? "-"],
    ["업태", data.storeBizType ?? "-"],
    ["주소", data.storeAddr ?? "-"],
    ["공급가액", won(data.supplyAmount)],
    ["부가세", won(data.taxAmount)],
    ["합계금액", won(data.amountTotal), true],
  ];

  const labelX = MARGIN + 14;
  const valueX = MARGIN + 120;
  const rowH = 30;
  const tableTop = y;
  for (const [label, value, emphasize] of rows) {
    page.drawText(label, { x: labelX, y: y - 19, size: 10.5, font: bold, color: GRAY });
    const f: PDFFont = emphasize ? bold : font;
    const size = emphasize ? 13 : 11;
    // 값이 길면(주소 등) 폭에 맞춰 잘라 말줄임
    let text = value;
    const maxW = PAGE_W - MARGIN - 14 - valueX;
    while (text.length > 1 && f.widthOfTextAtSize(text, size) > maxW) text = text.slice(0, -2) + "…";
    page.drawText(text, { x: valueX, y: y - 19, size, font: f, color: INK });
    y -= rowH;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.4, color: LINE });
  }
  // 표 좌우 테두리 + 상단선
  page.drawLine({ start: { x: MARGIN, y: tableTop }, end: { x: PAGE_W - MARGIN, y: tableTop }, thickness: 0.4, color: LINE });
  page.drawLine({ start: { x: MARGIN, y: tableTop }, end: { x: MARGIN, y }, thickness: 0.4, color: LINE });
  page.drawLine({ start: { x: PAGE_W - MARGIN, y: tableTop }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.4, color: LINE });

  y -= 26;
  const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  page.drawText("※ 본 전표는 카드사 승인내역(매입 원장)을 기반으로 자동 생성된 사용내역 증빙입니다.", {
    x: MARGIN, y, size: 9, font, color: GRAY,
  });
  y -= 14;
  page.drawText(`생성일시: ${now} · MCM 법인카드 경비 증빙`, { x: MARGIN, y, size: 8, font, color: GRAY });

  return Buffer.from(await doc.save());
}
