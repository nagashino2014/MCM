import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { PDFDocument, PDFFont, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { getDoc } from "@/lib/approval/docs";
import { createApprovalDocPdf } from "@/lib/approval/doc-pdf";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { putContractDocument, readContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { sendMail } from "@/lib/mail/send";
import { listSettlementItems, listSettlements, type SettlementItemRow } from "@/lib/finance/expense-settlement";

/*
 * 부가세 신고 자료 묶음(FRM-P6) — 정산 1건의 개인카드 지출을 세무사 제출 세트로 만든다.
 *  ① 지출결의서(개인카드) 문서 PDF(결재 지면 그대로)
 *  ② 출장보고서는 개인카드 행만 추린 별도 집계 PDF(문서별 1장 — 법인카드 행 제외 요건)
 *  ③ 각 행에 매칭된 영수증 증빙 PDF(personal_receipts.pdf_key, 스캔 이미지 포함)
 * zip 으로 묶어 저장하고, 요청 시 세무사 메일로 발송한다(발송 이력은 expense_settlements 에 기록).
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const INK = rgb(0.13, 0.16, 0.23);
const MUTED = rgb(0.42, 0.46, 0.55);
const LINE = rgb(0.72, 0.75, 0.8);

const comma = (n: number) => n.toLocaleString("ko-KR");

/** 출장보고서 개인카드 행 집계 PDF — 문서 1건의 개인카드 행만 표로 렌더(간이 지면). */
async function buildTripPersonalPdf(doc: { docNo: string | null; title: string; drafterName: string | null }, items: SettlementItemRow[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const regular = await pdf.embedFont(await readFile(path.join(fontsDir, "malgun.ttf")), { subset: true });
  const bold = await pdf.embedFont(await readFile(path.join(fontsDir, "malgunbd.ttf")), { subset: true });
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 64;

  const text = (s: string, x: number, size: number, font: PDFFont, color = INK) =>
    page.drawText(s, { x, y, size, font, color });

  text("출장보고서 지출내역 (개인카드 한정)", MARGIN, 15, bold);
  y -= 22;
  text(`문서번호: ${doc.docNo ?? "-"}   제목: ${doc.title}   기안자: ${doc.drafterName ?? "-"}`, MARGIN, 10, regular, MUTED);
  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.8, color: LINE });
  y -= 18;

  const cols: Array<{ label: string; w: number; get: (i: SettlementItemRow) => string; right?: boolean }> = [
    { label: "사용일시", w: 76, get: (i) => i.usedOn ?? "-" },
    { label: "분류", w: 62, get: (i) => i.category ?? "-" },
    { label: "상호", w: 150, get: (i) => i.vendor ?? "-" },
    { label: "금액", w: 80, get: (i) => comma(i.amount), right: true },
    { label: "지출 목적", w: 131, get: (i) => i.detail ?? "-" },
  ];
  const drawRow = (vals: string[], font: PDFFont, rights: boolean[]) => {
    let x = MARGIN;
    vals.forEach((v, ci) => {
      const w = cols[ci].w;
      const size = 9.5;
      let s = v;
      while (font.widthOfTextAtSize(s, size) > w - 8 && s.length > 1) s = s.slice(0, -1);
      if (s !== v) s = `${s.slice(0, -1)}…`;
      const tx = rights[ci] ? x + w - 4 - font.widthOfTextAtSize(s, size) : x + 4;
      page.drawText(s, { x: tx, y, size, font, color: INK });
      x += w;
    });
  };
  drawRow(cols.map((c) => c.label), bold, cols.map(() => false));
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: LINE });
  y -= 14;
  for (const item of items) {
    if (y < 80) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - 64;
    }
    drawRow(cols.map((c) => c.get(item)), regular, cols.map((c) => !!c.right));
    y -= 15;
  }
  y -= 4;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.8, color: LINE });
  y -= 15;
  const total = items.reduce((a, i) => a + i.amount, 0);
  page.drawText(`합계 ${items.length}건  ${comma(total)}원`, {
    x: PAGE_W - MARGIN - bold.widthOfTextAtSize(`합계 ${items.length}건  ${comma(total)}원`, 10.5),
    y,
    size: 10.5,
    font: bold,
    color: INK,
  });
  return Buffer.from(await pdf.save());
}

export interface VatBundleResult {
  fileName: string;
  storageKey: string;
  docCount: number;
  receiptCount: number;
  missingReceipts: string[];
}

/** 정산 1건의 부가세 자료 zip 생성·저장 — {지출결의서, 출장보고서(개인카드), 영수증} 세트. */
export async function buildVatBundle(settlementId: string): Promise<VatBundleResult> {
  const settlement = (await listSettlements()).find((s) => s.settlementId === settlementId);
  if (!settlement) throw new Error("정산 내역을 찾을 수 없습니다.");
  const items = await listSettlementItems(settlementId);
  if (!items.length) throw new Error("정산 항목이 없습니다.");

  const zip = new JSZip();
  const byDoc = new Map<string, SettlementItemRow[]>();
  for (const item of items) {
    const list = byDoc.get(item.docId) ?? [];
    list.push(item);
    byDoc.set(item.docId, list);
  }

  let docCount = 0;
  const missingReceipts: string[] = [];
  const db = await getDb();

  for (const [docId, docItems] of byDoc) {
    const doc = await getDoc(docId);
    if (!doc) continue;
    const base = sanitizeFilename(`${doc.docNo ?? docId}_${doc.drafterName ?? ""}`);
    if (doc.formId === "frm-expense-personal") {
      // 결재 지면 그대로 — 표 전체가 개인카드 내역
      const bytes = await createApprovalDocPdf(doc, []);
      zip.file(`지출결의서(개인카드)/${base}.pdf`, bytes);
    } else {
      // 출장보고서 — 개인카드 행만 추린 별도 집계 지면
      const bytes = await buildTripPersonalPdf(doc, docItems);
      zip.file(`출장보고서(개인카드 내역)/${base}.pdf`, bytes);
    }
    docCount += 1;
  }

  // 영수증 증빙 — personal_receipts.pdf_key(스캔 이미지 포함 증빙 PDF)
  const receiptIds = items.map((i) => i.receiptId).filter((v): v is string => !!v);
  let receiptCount = 0;
  if (receiptIds.length) {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT receipt_id, pdf_key, store_name, paid_at FROM personal_receipts WHERE receipt_id = ANY($1)`,
        [receiptIds]
      )
    );
    const byId = new Map(rows.map((r) => [String(r.receipt_id), r]));
    for (const item of items) {
      if (!item.receiptId) continue;
      const rec = byId.get(item.receiptId);
      const pdfKey = rec?.pdf_key != null ? String(rec.pdf_key) : null;
      const buf = pdfKey ? await readContractDocument(pdfKey) : null;
      if (!buf) {
        missingReceipts.push(`${item.employeeName ?? ""} ${item.usedOn ?? ""} ${item.vendor ?? item.receiptId}`);
        continue;
      }
      const name = sanitizeFilename(`${item.docNo ?? item.docId}_${item.usedOn ?? ""}_${item.vendor ?? "영수증"}.pdf`);
      zip.file(`영수증/${name}`, buf);
      receiptCount += 1;
    }
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const fileName = `개인카드 부가세자료_${settlement.settledOn.replace(/-/g, "")}.zip`;
  const storageKey = `finance/expense-settlements/${settlementId}/${sanitizeFilename(fileName)}`;
  await putContractDocument(storageKey, buffer, "application/zip");
  return { fileName, storageKey, docCount, receiptCount, missingReceipts };
}

/** 부가세 자료 zip 을 세무사 메일로 발송 — 발송 이력은 정산 헤더에 기록. */
export async function sendVatBundle(params: {
  settlementId: string;
  actorUserId: string;
  toEmail: string;
  toName?: string | null;
  message?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const bundle = await buildVatBundle(params.settlementId);
  const content = await readContractDocument(bundle.storageKey);
  if (!content) return { ok: false, error: "생성된 자료 파일을 읽지 못했습니다." };
  const settlement = (await listSettlements()).find((s) => s.settlementId === params.settlementId);
  const label = settlement ? `${settlement.settledOn} 정산분` : params.settlementId;
  const result = await sendMail({
    userId: params.actorUserId,
    to: [{ address: params.toEmail, name: params.toName ?? undefined }],
    subject: `[부가세 자료] 개인카드 지출 증빙 — ${label}`,
    bodyHtml: `<p>안녕하세요.</p><p>부가세 신고용 개인카드 지출 자료(${label})를 송부드립니다.<br/>` +
      `구성: 지출결의서(개인카드)·출장보고서 개인카드 내역·영수증 증빙 ${bundle.receiptCount}건.</p>` +
      (params.message ? `<p>${params.message}</p>` : "") +
      `<p>감사합니다.</p>`,
    attachments: [{ filename: bundle.fileName, contentType: "application/zip", content }],
    idempotencyKey: `vat-bundle-${params.settlementId}`,
  });
  if (result.ok) {
    await withDbWrite(async (txn) => {
      await txn.run(`UPDATE expense_settlements SET vat_bundle_sent_at = $2, vat_bundle_sent_to = $3 WHERE settlement_id = $1`, [
        params.settlementId,
        new Date().toISOString(),
        params.toEmail,
      ]);
    });
  }
  return { ok: result.ok, error: result.error };
}
