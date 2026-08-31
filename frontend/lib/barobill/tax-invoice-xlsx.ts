// 전자세금계산서 보관용 XLSX 빌더 (2026-08-25).
//
// 사용자 제공 홈택스 출력 양식(public/xlsx/tax-invoice.xlsx — 실물 발행본에서 데이터·QR 을
// 걷어낸 템플릿)에 exceljs 로 값만 채운다. "원본이 곧 템플릿" 방식(hwpx 와 동일 규칙) —
// 서식(병합·테두리·열폭)은 템플릿이 전담하므로 코드에서는 셀 주소에 값만 놓는다.
// PDF 는 converter(LibreOffice) 변환으로 만든다 — 실패 시 pdf-lib 렌더 폴백(invoice-archive).

import path from "node:path";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import type { TaxInvoicePdfInput } from "@/lib/barobill/tax-invoice-pdf";

const fmtCorpNum = (v: string) => {
  const d = v.replace(/[^0-9]/g, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : v;
};

export interface TaxInvoiceXlsxInput extends TaxInvoicePdfInput {
  /** 수정세금계산서 — 제목·수정사유 칸에 반영 */
  modifyReason?: string | null;
}

export async function buildTaxInvoiceXlsx(input: TaxInvoiceXlsxInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const bytes = await readFile(path.join(process.cwd(), "public", "xlsx", "tax-invoice.xlsx"));
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const set = (addr: string, value: string | number | null | undefined) => {
    if (value == null || value === "") return;
    ws.getCell(addr).value = value;
  };

  // 제목 · 승인번호
  set("C2", input.modifyReason ? "수정전자세금계산서" : "전자세금계산서");
  set("X2", input.ntsSendKey || input.mgtKey);

  // 공급자
  set("H3", fmtCorpNum(input.invoicer.corpNum));
  set("H4", input.invoicer.corpName);
  set("O4", input.invoicer.ceoName);
  set("H5", input.invoicer.addr);
  set("H6", input.invoicer.bizType);
  set("L6", input.invoicer.bizClass);
  set("H7", input.invoicer.email);

  // 공급받는자
  set("X3", fmtCorpNum(input.invoicee.corpNum));
  set("X4", input.invoicee.corpName);
  set("AE4", input.invoicee.ceoName);
  set("X5", input.invoicee.addr);
  set("X7", input.invoicee.email);

  // 작성일자 · 공급가액 · 세액 · 수정사유 · 비고
  set("C10", input.writeDate);
  set("H10", Math.round(input.amountTotal));
  set("M10", Math.round(input.taxTotal));
  set("T10", input.modifyReason ?? undefined);
  set("Y10", input.remark ?? undefined);

  // 품목 — 템플릿 값행 12~15(4행). 초과분은 마지막 행에 "외 N건"으로 합친다.
  const MAX_ROWS = 4;
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
  rows.forEach((it, i) => {
    const r = 12 + i;
    const md = (it.date ?? "").match(/^\d{4}-(\d{2})-(\d{2})$/);
    set(`C${r}`, md ? md[1] : undefined);
    set(`E${r}`, md ? md[2] : undefined);
    set(`F${r}`, it.name);
    set(`N${r}`, it.spec);
    set(`P${r}`, it.qty);
    set(`T${r}`, it.unitPrice != null ? Math.round(it.unitPrice) : undefined);
    set(`X${r}`, Math.round(it.amount));
    set(`AC${r}`, Math.round(it.tax));
  });

  // 합계금액 · 청구/영수
  set("C17", Math.round(input.totalAmount));
  set("AC16", `이 금액을 (${input.purposeType === 1 ? "영수" : "청구"}) 함`);

  // 각주 — 바로빌 문서번호·보관용 사본 표기(하단 얇은 행)
  const footer = input.ntsSendKey
    ? `바로빌 문서번호 ${input.mgtKey} · 바로빌(BaroService) 전자발행 보관용 사본${input.issuedAt ? ` · 발행일시 ${input.issuedAt}` : ""}`
    : `바로빌 문서번호 ${input.mgtKey} · 국세청 전송 대기(전송 완료 시 승인번호가 반영됩니다) · 바로빌 전자발행 보관용 사본`;
  set("C24", footer);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
