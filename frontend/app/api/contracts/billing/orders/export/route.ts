import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getContractOrdersStatus } from "@/lib/ieps/contracts";
import { filterOrdersStatusRows } from "@/lib/ieps/orders-status-filter";
import { createTablePdf, createTableWorkbook, type TableDocumentSpec } from "@/lib/export/table-document";
import { shortenSido } from "@scraper/lib/ieps/region";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 출력일자 파일명용: YY.MM.DD. */
function stampDisplay(d: Date): string {
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}.`;
}

/** 출력일자 표 내부용: YYYY-MM-DD */
function stampIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const sp = req.nextUrl.searchParams;
    const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";

    const status = await getContractOrdersStatus(sp.get("year") ?? undefined);
    const categoryParam = sp.get("category") || null;
    const sidoParam = sp.get("sido") || null;
    const filtered = filterOrdersStatusRows(status.rows, {
      category: categoryParam,
      industryId: sp.get("industry") || null,
      sido: sidoParam,
    });

    const rows: string[][] = filtered.map((row, idx) => [
      String(idx + 1),
      row.contractTitle,
      row.counterpartyName,
      row.industryCategory ?? "-",
      firstLine(row.facilityIndustryName) || "-",
      shortenSido(row.sido) ?? row.sido ?? "-",
      row.contractDate ?? "",
      row.amount > 0 ? row.amount.toLocaleString("ko-KR") : "-",
    ]);
    const totalAmount = filtered.reduce((acc, r) => acc + r.amount, 0);

    // 파일명/제목 조합: [선택연도] [선택용역] 수주 계약 리스트 (YY.MM.DD.)
    const now = new Date();
    const yearLabel = sp.get("year") === "all" || !sp.get("year") ? "전체기간" : `${sp.get("year")}년`;
    const catLabel = categoryParam ? ` ${categoryParam}` : "";
    const sidoLabel = sidoParam ? ` ${sidoParam}` : "";
    const titleBase = `${yearLabel}${catLabel}${sidoLabel} 수주 계약 리스트`;
    const fileStamp = stampDisplay(now);
    const isoDate = stampIso(now);

    const spec: TableDocumentSpec = {
      headers: ["연번", "용역명", "발주처", "업종분류", "업종세분류", "지역", "계약일", "수주 금액(원)"],
      aligns: ["center", "left", "left", "center", "left", "center", "center", "right"],
      pdfColWidths: [30, 230, 110, 70, 130, 44, 76, 100],
      xlsxColChars: [6, 44, 24, 14, 30, 6, 14, 18],
      sheetName: "수주계약리스트",
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

function firstLine(value: string | null): string {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)[0] ?? "";
}
