import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getContractReceivablesStatus } from "@/lib/ieps/receivables";
import { filterReceivableRows, type ReceivableAgingFilter } from "@/lib/ieps/receivables-filter";
import { createTablePdf, createTableWorkbook, type TableDocumentSpec } from "@/lib/export/table-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stampDisplay(d: Date): string {
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}.`;
}

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const sp = req.nextUrl.searchParams;
    const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
    const agingRaw = sp.get("aging");
    const aging: ReceivableAgingFilter =
      agingRaw === "under2" || agingRaw === "over2" ? agingRaw : "all";

    const categoryParam = sp.get("category") || null;
    const status = await getContractReceivablesStatus();
    const filtered = filterReceivableRows(status.rows, { category: categoryParam, aging });

    const rows: string[][] = filtered.map((row, idx) => [
      String(idx + 1),
      row.contractTitle,
      row.category,
      row.counterpartyName,
      row.stageLabel || "",
      row.invoiceIssuedAt ?? "",
      `${row.agingMonths}개월`,
      row.outstandingAmount > 0 ? row.outstandingAmount.toLocaleString("ko-KR") : "-",
    ]);
    const totalAmount = filtered.reduce((acc, r) => acc + r.outstandingAmount, 0);

    const now = new Date();
    const catLabel = categoryParam ? ` ${categoryParam}` : "";
    // 미수금은 연도 구분 없이 전체 표시이므로 연도 레이블 생략
    const titleBase = `${catLabel.trimStart()} 미수금 리스트`.trimStart();
    const fileStamp = stampDisplay(now);
    const isoDate = now.toISOString().slice(0, 10);

    const spec: TableDocumentSpec = {
      headers: ["연번", "용역명", "용역분류", "발주처", "조건", "발행일", "경과", "미수금액(원)"],
      aligns: ["center", "left", "center", "left", "left", "center", "center", "right"],
      pdfColWidths: [30, 200, 70, 110, 100, 76, 50, 100],
      xlsxColChars: [6, 40, 12, 20, 16, 14, 9, 18],
      sheetName: "미수금리스트",
      orientation: "landscape",
      rows,
      totalLabel: `총 ${rows.length.toLocaleString("ko-KR")}건`,
      totalValue: `${totalAmount.toLocaleString("ko-KR")}원`,
      docTitle: titleBase,
      printDate: isoDate,
    };

    const fileName = encodeURIComponent(`${titleBase}(${fileStamp}).${format}`);

    if (format === "pdf") {
      const pdf = await createTablePdf(spec);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
          "Cache-Control": "no-store",
        },
      });
    }

    const xlsx = createTableWorkbook(spec);
    return new NextResponse(new Uint8Array(xlsx), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
