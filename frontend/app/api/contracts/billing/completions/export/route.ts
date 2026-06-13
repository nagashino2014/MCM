import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getContractCompletionsStatus } from "@/lib/ieps/completions-status";
import { filterCompletionRows } from "@/lib/ieps/completions-filter";
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
    const subtypeParam = sp.get("subtype") || null;
    const status = await getContractCompletionsStatus();
    const filtered = filterCompletionRows(status.rows, {
      category: categoryParam,
      subtype: subtypeParam,
      year: yearParam,
    });

    const rows: string[][] = filtered.map((row, idx) => [
      String(idx + 1),
      row.contractTitle,
      row.category,
      row.subtype || "-",
      row.contractDate ?? "",
      row.permitDate ?? "-",
      row.invoiceDoneDate ?? "-",
    ]);

    const now = new Date();
    const yearLabel = !yearParam || yearParam === "all" ? "전체기간" : `${yearParam}년`;
    const catLabel = categoryParam ? ` ${categoryParam}` : "";
    const subLabel = subtypeParam ? ` ${subtypeParam}` : "";
    const titleBase = `${yearLabel}${catLabel}${subLabel} 완료 리스트`;
    const fileStamp = stampDisplay(now);
    const isoDate = now.toISOString().slice(0, 10);

    const spec: TableDocumentSpec = {
      headers: ["연번", "용역명", "용역분류", "용역세분류", "계약일", "완료일(허가일)", "완료일(발행일)"],
      aligns: ["center", "left", "center", "center", "center", "center", "center"],
      pdfColWidths: [30, 220, 70, 70, 76, 90, 90],
      xlsxColChars: [6, 40, 12, 12, 14, 16, 16],
      sheetName: "완료리스트",
      orientation: "landscape",
      rows,
      totalLabel: `총 완료 건수`,
      totalValue: `${rows.length.toLocaleString("ko-KR")}건`,
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
