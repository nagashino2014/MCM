// 영수증 이미지 → 증빙 PDF (pdf-lib 이미지 임베드 + 하단 메타 스탬프).
// 결재 첨부(field_values.file_attachments)로 실려 결재자가 뷰어에서 원본을 확인한다.
// 폰트 로드는 payroll/contract-pdf.ts 관례(public/fonts/malgun.ttf 캐시).
// 설계: docs/accounting-expansion-blueprint.md §2.4 (P1)

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 40;
const META_H = 46; // 하단 메타 밴드 높이

let fontCache: Buffer | null = null;

async function loadFont(): Promise<Buffer> {
  if (fontCache) return fontCache;
  fontCache = await readFile(path.join(process.cwd(), "public", "fonts", "malgun.ttf"));
  return fontCache;
}

export interface ReceiptPdfMeta {
  storeName: string | null;
  paidAt: string | null;
  totalAmount: number | null;
  capturedBy: string; // 촬영자 표시명(이메일 등)
  capturedAt: string; // YYYY-MM-DD HH:MM:SS
}

/** 정규화된 JPEG 1장을 A4 1페이지 PDF로 — 이미지 원본비 유지 중앙 배치 + 하단 메타 1줄. */
export async function buildReceiptPdf(jpeg: Buffer, meta: ReceiptPdfMeta): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await loadFont(), { subset: true });
  const page = doc.addPage([PAGE_W, PAGE_H]);

  const img = await doc.embedJpg(jpeg);
  const boxW = PAGE_W - MARGIN * 2;
  const boxH = PAGE_H - MARGIN * 2 - META_H;
  const scale = Math.min(boxW / img.width, boxH / img.height, 1.5);
  const w = img.width * scale;
  const h = img.height * scale;
  page.drawImage(img, {
    x: (PAGE_W - w) / 2,
    y: MARGIN + META_H + (boxH - h) / 2,
    width: w,
    height: h,
  });

  const line1 = [
    meta.storeName ?? "상호 미상",
    meta.paidAt ?? "",
    meta.totalAmount != null ? `${meta.totalAmount.toLocaleString("ko-KR")}원` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const line2 = `촬영: ${meta.capturedBy} · ${meta.capturedAt} · MCM 개인카드 경비 증빙`;
  page.drawLine({
    start: { x: MARGIN, y: MARGIN + META_H - 8 },
    end: { x: PAGE_W - MARGIN, y: MARGIN + META_H - 8 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.72),
  });
  page.drawText(line1, { x: MARGIN, y: MARGIN + 22, size: 10, font, color: rgb(0.1, 0.1, 0.12) });
  page.drawText(line2, { x: MARGIN, y: MARGIN + 8, size: 8, font, color: rgb(0.45, 0.45, 0.5) });

  return Buffer.from(await doc.save());
}
