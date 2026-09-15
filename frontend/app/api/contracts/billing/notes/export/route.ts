import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { resolveVisibleContractIds } from "@/lib/auth/contract-scope";
import {
  filterNoteRows,
  getContractNoteStatus,
  noteIssuedBasisDate,
  notePeriodRange,
  type NoteBasis,
  type NotePeriodUnit,
} from "@/lib/ieps/note-status";
import { createTablePdf, createTableWorkbook, type TableDocumentSpec } from "@/lib/export/table-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stampDisplay(d: Date): string {
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}.`;
}

const withVat = (supply: number) => Math.round(supply * 1.1);

/**
 * 어음 발행/만기 현황 내보내기(세무사 제출용).
 * kind=issued|maturity, year, unit(year|half|quarter|month), seq(반기 1~2 / 분기 1~4 / 월 1~12).
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("billing.view");
    const ids = await resolveVisibleContractIds(ctx.userId, "billing.view");
    const sp = req.nextUrl.searchParams;
    const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
    const kind: NoteBasis = sp.get("kind") === "maturity" ? "maturity" : "issued";
    const unitParam = sp.get("unit");
    const unit: NotePeriodUnit = ["year", "half", "quarter", "month"].includes(unitParam ?? "")
      ? (unitParam as NotePeriodUnit)
      : "year";
    const year = Number(sp.get("year")) || new Date().getFullYear();
    const seq = Number(sp.get("seq")) || 1;
    const period = notePeriodRange(year, unit, seq);

    const status = await getContractNoteStatus(ids);
    const filtered = filterNoteRows(status.rows, kind, period.from, period.to).sort((a, b) => {
      const da = kind === "issued" ? noteIssuedBasisDate(a) ?? "" : a.noteMaturityDate ?? "";
      const db = kind === "issued" ? noteIssuedBasisDate(b) ?? "" : b.noteMaturityDate ?? "";
      return da.localeCompare(db);
    });

    const rows: string[][] = filtered.map((row, idx) => [
      String(idx + 1),
      row.counterpartyName || "-",
      row.contractTitle,
      row.stageLabel || "",
      row.noteKind ?? "",
      row.noteBank ?? "",
      noteIssuedBasisDate(row) ?? "",
      row.noteMaturityDate ?? "",
      row.amount > 0 ? row.amount.toLocaleString("ko-KR") : "-",
      row.amount > 0 ? withVat(row.amount).toLocaleString("ko-KR") : "-",
      row.collected ? `수금(${row.collectedAt ?? ""})` : "미수",
    ]);
    const totalAmount = filtered.reduce((acc, r) => acc + r.amount, 0);

    const now = new Date();
    const kindLabel = kind === "issued" ? "발행" : "만기";
    const titleBase = `${period.label} 어음 ${kindLabel} 현황`;
    const fileStamp = stampDisplay(now);
    const isoDate = now.toISOString().slice(0, 10);

    const spec: TableDocumentSpec = {
      headers: [
        "연번", "발주처", "용역명", "조건", "어음 종류", "취급 은행",
        "발행일", "만기일", "공급가액(원)", "액면 환산(VAT 포함, 원)", "수금 상태",
      ],
      aligns: ["center", "left", "left", "left", "center", "center", "center", "center", "right", "right", "center"],
      pdfColWidths: [26, 90, 150, 60, 62, 62, 68, 68, 84, 96, 74],
      xlsxColChars: [6, 18, 36, 12, 12, 12, 13, 13, 16, 18, 16],
      sheetName: `어음${kindLabel}현황`,
      orientation: "landscape",
      rows,
      totalLabel: `총 ${rows.length.toLocaleString("ko-KR")}건`,
      totalValue: `${totalAmount.toLocaleString("ko-KR")}원(공급가액)`,
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
