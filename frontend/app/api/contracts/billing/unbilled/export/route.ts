import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getContractUnbilledStatus } from "@/lib/ieps/unbilled";
import { filterUnbilledRows } from "@/lib/ieps/unbilled-filter";
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

    const yearParam = sp.get("year") || null;
    const categoryParam = sp.get("category") || null;
    const status = await getContractUnbilledStatus();
    const filtered = filterUnbilledRows(status.rows, { category: categoryParam, year: yearParam });

    const rows: string[][] = filtered.map((row, idx) => [
      String(idx + 1),
      row.contractTitle,
      row.category,
      row.counterpartyName,
      row.contractDate ?? "",
      row.stageLabel || "",
      row.amount > 0 ? row.amount.toLocaleString("ko-KR") : "-",
    ]);
    const totalAmount = filtered.reduce((acc, r) => acc + r.amount, 0);

    const now = new Date();
    const yearLabel = !yearParam || yearParam === "all" ? "전체기간" : `${yearParam}년`;
    const catLabel = categoryParam ? ` ${categoryParam}` : "";
    const titleBase = `${yearLabel}${catLabel} 미발행 리스트`;
    const fileStamp = stampDisplay(now);
    const isoDate = now.toISOString().slice(0, 10);

    const spec: TableDocumentSpec = {
      headers: ["연번", "용역명", "용역분류", "발주처", "계약일", "조건", "대상 금액(원)"],
      aligns: ["center", "left", "center", "left", "center", "left", "right"],
      pdfColWidths: [30, 200, 70, 110, 76, 90, 100],
      xlsxColChars: [6, 40, 12, 20, 14, 14, 18],
      sheetName: "미발행리스트",
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
