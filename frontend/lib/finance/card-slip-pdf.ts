// 법인카드 전자 전표(매출전표) PDF — 바로빌 매입내역 1건 = 전표 1장.
// 지출결의서·출장보고서에 카드 건을 담으면 이 PDF 가 증빙 첨부로 자동으로 따라붙는다.
// 생성은 야간 배치(card-slip.ts)가 미리 해 둔다 — 기안 화면에서 만들지 않는다(대기 시간 제거).
// 크기: A4 비율(1:√2)을 유지한 A5(A4의 정확한 절반) — 전표 1건에 A4 한 장은 과하다(사용자 확정).
// 기재 항목은 적격증빙(신용카드 매출전표) 기준: 카드사·카드번호·승인번호·승인일시·거래구분·할부,
// 가맹점(상호·사업자번호·대표자·업태·주소), 공급가액·부가세·봉사료·합계, 매입확정 여부.
// 폰트 로드는 receipt-pdf.ts 관례(public/fonts/malgun.ttf 캐시)를 그대로 따른다.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

// A5 세로 — A4(595.28 × 841.89)의 절반, 비율 동일.
const PAGE_W = 420.94;
const PAGE_H = 595.28;
const MARGIN = 30;
const LABEL_W = 84; // 라벨 열 폭
const ROW_H = 20;

const INK = rgb(0.13, 0.15, 0.2);
const MUTED = rgb(0.42, 0.45, 0.52);
const LINE = rgb(0.78, 0.81, 0.86);
const LABEL_BG = rgb(0.95, 0.96, 0.98);
const ACCENT = rgb(0.36, 0.53, 1); // cdash primary #5D87FF

let fontCache: Buffer | null = null;

async function loadFont(): Promise<Buffer> {
  if (fontCache) return fontCache;
  fontCache = await readFile(path.join(process.cwd(), "public", "fonts", "malgun.ttf"));
  return fontCache;
}

export interface CardSlipData {
  cardTxnId: string;
  /** 카드사명 + 카드 별칭("비씨카드 · 법인공용1") */
  cardLabel: string;
  /** 하이픈 없는 원문 카드번호 — 여기서 마스킹해 그린다. */
  cardNum: string | null;
  approvalType: string; // 승인 / 취소 / 부분취소 …
  approvalNum: string | null;
  approvedAt: string; // YYYY-MM-DD HH:MM:SS
  useDate: string | null; // 매입일(BC) — 없으면 생략
  installment: string | null; // 할부 개월("00"=일시불)
  isPurchased: boolean; // 매입 확정 여부
  storeName: string | null;
  storeCorpNum: string | null;
  storeCeo: string | null;
  storeBizType: string | null;
  storeAddr: string | null;
  amountTotal: number;
  supplyAmount: number | null;
  taxAmount: number | null;
  serviceCharge: number | null;
  /** 자동 분류 결과 라벨(계정 성격 참고용) — 없으면 생략 */
  categoryLabel: string | null;
  /** 발행 주체 표시 */
  companyName: string;
  companyCorpNum: string | null;
  /** 전표 생성 시각(KST) */
  issuedAt: string;
}

const won = (n: number | null | undefined) => (n == null ? "-" : `${Math.round(n).toLocaleString("ko-KR")}원`);

/** 000-00-00000 — 숫자 10자리가 아니면 원문 그대로. */
function fmtCorpNum(v: string | null): string {
  const d = (v ?? "").replace(/[^0-9]/g, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : v || "-";
}

/** 카드번호는 앞 4 · 뒤 4 만 남긴다(전표에 전체 번호를 남기지 않는다). */
function maskCardNum(v: string | null): string {
  const d = (v ?? "").replace(/[^0-9]/g, "");
  if (d.length < 8) return "-";
  return `${d.slice(0, 4)}-****-****-${d.slice(-4)}`;
}

/** 할부 표기 — "00"/"1"/null 은 일시불. */
function fmtInstallment(v: string | null): string {
  const n = Number((v ?? "").replace(/[^0-9]/g, ""));
  return !n || n <= 1 ? "일시불" : `${n}개월 할부`;
}

/** 폭을 넘기면 말줄임 — 주소·상호가 길어도 칸을 벗어나지 않게. */
function fit(font: PDFFont, text: string, size: number, maxW: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > maxW) cut = cut.slice(0, -1);
  return `${cut}…`;
}

export async function buildCardSlipPdf(d: CardSlipData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await loadFont(), { subset: true });
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const innerW = PAGE_W - MARGIN * 2;

  let y = PAGE_H - MARGIN;

  // ── 표제
  const title = "법인카드 매출전표";
  page.drawText(title, { x: MARGIN, y: y - 15, size: 15.5, font, color: INK });
  page.drawText(`전표번호 ${d.cardTxnId}`, {
    x: PAGE_W - MARGIN - font.widthOfTextAtSize(`전표번호 ${d.cardTxnId}`, 7.5),
    y: y - 11,
    size: 7.5,
    font,
    color: MUTED,
  });
  y -= 22;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.2, color: ACCENT });
  y -= 6;
  const issuer = [d.companyName, d.companyCorpNum ? fmtCorpNum(d.companyCorpNum) : null].filter(Boolean).join(" · ");
  page.drawText(fit(font, issuer, 8.5, innerW), { x: MARGIN, y: y - 9, size: 8.5, font, color: MUTED });
  y -= 22;

  /** 라벨/값 2열 표 — 섹션 제목 + 행들. */
  const section = (heading: string, rows: Array<[string, string]>) => {
    page.drawText(heading, { x: MARGIN, y: y - 9, size: 9, font, color: ACCENT });
    y -= 15;
    const top = y;
    rows.forEach(([label, value], i) => {
      const rowTop = top - ROW_H * i;
      const rowBottom = rowTop - ROW_H;
      page.drawRectangle({ x: MARGIN, y: rowBottom, width: LABEL_W, height: ROW_H, color: LABEL_BG });
      page.drawText(label, { x: MARGIN + 8, y: rowBottom + 6.5, size: 8.5, font, color: MUTED });
      page.drawText(fit(font, value, 9, innerW - LABEL_W - 16), {
        x: MARGIN + LABEL_W + 8,
        y: rowBottom + 6.5,
        size: 9,
        font,
        color: INK,
      });
      page.drawLine({
        start: { x: MARGIN, y: rowBottom },
        end: { x: PAGE_W - MARGIN, y: rowBottom },
        thickness: 0.5,
        color: LINE,
      });
    });
    const bottom = top - ROW_H * rows.length;
    // 표 외곽 + 라벨 열 구분선
    page.drawLine({ start: { x: MARGIN, y: top }, end: { x: PAGE_W - MARGIN, y: top }, thickness: 0.5, color: LINE });
    page.drawLine({ start: { x: MARGIN, y: top }, end: { x: MARGIN, y: bottom }, thickness: 0.5, color: LINE });
    page.drawLine({
      start: { x: PAGE_W - MARGIN, y: top },
      end: { x: PAGE_W - MARGIN, y: bottom },
      thickness: 0.5,
      color: LINE,
    });
    page.drawLine({
      start: { x: MARGIN + LABEL_W, y: top },
      end: { x: MARGIN + LABEL_W, y: bottom },
      thickness: 0.5,
      color: LINE,
    });
    y = bottom - 16;
  };

  section("승인 정보", [
    ["카드", d.cardLabel || "-"],
    ["카드번호", maskCardNum(d.cardNum)],
    ["거래구분", `${d.approvalType || "승인"} · ${fmtInstallment(d.installment)}`],
    ["승인번호", d.approvalNum || "-"],
    ["승인일시", d.approvedAt || "-"],
    ["매입", d.isPurchased ? `매입 확정${d.useDate ? ` (${d.useDate})` : ""}` : "매입 대기"],
  ]);

  section("가맹점", [
    ["상호", d.storeName || "-"],
    ["사업자번호", fmtCorpNum(d.storeCorpNum)],
    ["대표자", d.storeCeo || "-"],
    ["업태·종목", (d.storeBizType || "-").replace(/\s+/g, " ").trim()],
    ["주소", d.storeAddr || "-"],
  ]);

  section("결제 금액", [
    ["공급가액", won(d.supplyAmount)],
    ["부가세", won(d.taxAmount)],
    ["봉사료", won(d.serviceCharge ?? 0)],
  ]);

  // ── 합계 강조 밴드
  const bandH = 30;
  const bandTop = y;
  page.drawRectangle({
    x: MARGIN,
    y: bandTop - bandH,
    width: innerW,
    height: bandH,
    color: rgb(0.93, 0.95, 1),
  });
  page.drawText("합계 금액", { x: MARGIN + 10, y: bandTop - bandH + 11, size: 10, font, color: MUTED });
  const totalText = won(d.amountTotal);
  page.drawText(totalText, {
    x: PAGE_W - MARGIN - 12 - font.widthOfTextAtSize(totalText, 14),
    y: bandTop - bandH + 10,
    size: 14,
    font,
    color: INK,
  });
  y = bandTop - bandH - 16;

  if (d.categoryLabel) {
    page.drawText(`분류(자동): ${d.categoryLabel}`, { x: MARGIN, y, size: 9, font, color: MUTED });
    y -= 15;
  }

  // ── 하단 고지
  const notes = [
    "본 전표는 바로빌에서 수집한 법인카드 매입내역을 근거로 자동 생성된 전자 전표입니다.",
    `생성 ${d.issuedAt} · MCM 전자결재 증빙`,
  ];
  let ny = MARGIN + 12;
  page.drawLine({
    start: { x: MARGIN, y: ny + 22 },
    end: { x: PAGE_W - MARGIN, y: ny + 22 },
    thickness: 0.5,
    color: LINE,
  });
  for (const n of [...notes].reverse()) {
    page.drawText(fit(font, n, 8, innerW), { x: MARGIN, y: ny, size: 8, font, color: MUTED });
    ny += 12;
  }

  return Buffer.from(await doc.save());
}
