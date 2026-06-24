import { NextRequest, NextResponse } from "next/server";
import { requirePermission, authErrorToResponse } from "@/lib/auth/guards";
import { listFacilities, type FacilityListFilter } from "@/lib/ieps/queries";
import { formatCompanyName } from "@/lib/ieps/formatters";
import {
  INTEGRATED_PERMIT_INDUSTRIES,
  industryCodeMatchesCategory,
} from "@/lib/ieps/integrated-permit-industries";
import {
  createTablePdf,
  createTableWorkbook,
  type TableDocumentSpec,
} from "@/lib/export/table-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = [
  "연번",
  "업종",
  "대표업종코드",
  "대표업종명",
  "사업장명",
  "시도 분류",
  "소재지",
  "대기 종",
  "수질 종",
];

const ALIGNS: ("center" | "left" | "right")[] = [
  "center",
  "center",
  "center",
  "left",
  "left",
  "center",
  "left",
  "center",
  "center",
];

function stampDisplay(d: Date): string {
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}.`;
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission("facility.view");
    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") === "pdf" ? "pdf" : "xlsx";

    const sidoSingle = searchParams.get("sido") || "";
    const sidosRaw = searchParams.get("sidos") || "";
    const sidoList = sidosRaw
      ? sidosRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : sidoSingle
      ? [sidoSingle]
      : [];

    // 선택된 업종 레이블
    const industryCategoryId = searchParams.get("industryCategory") || "";
    const industryLabel = industryCategoryId
      ? INTEGRATED_PERMIT_INDUSTRIES.find((c) => c.id === industryCategoryId)?.label ?? ""
      : "";
    const isIntegrated = Boolean(industryCategoryId);

    const filter: FacilityListFilter = {
      q: searchParams.get("q") || undefined,
      sido: sidoSingle || undefined,
      sidos: sidoList.length > 0 ? sidoList : undefined,
      industryCode: searchParams.get("industryCode") || undefined,
      industryCategory: industryCategoryId || undefined,
      airClass: searchParams.get("airClass") ? Number(searchParams.get("airClass")) : undefined,
      waterClass: searchParams.get("waterClass")
        ? Number(searchParams.get("waterClass"))
        : undefined,
      source: searchParams.get("source") || undefined,
      sort: (searchParams.get("sort") as "recent" | "name") || "recent",
      limit: 100000,
      offset: 0,
    };

    const { items } = await listFacilities(filter);

    const rows: string[][] = items.map((f, idx) => {
      const codes = String(f.industryCode ?? "")
        .split(/[\s,/]+/)
        .map((c) => c.trim())
        .filter(Boolean);
      const category = INTEGRATED_PERMIT_INDUSTRIES.find((cat) =>
        codes.some((code) => industryCodeMatchesCategory(code, cat))
      );
      const firstName = String(f.industryName ?? "")
        .split(/\r?\n/)
        .map((n) => n.trim())
        .filter(Boolean)[0];
      return [
        String(idx + 1),
        category?.label ?? "기타",
        codes[0] ?? "",
        firstName ?? "",
        formatCompanyName(f.companyName) ?? f.companyName,
        f.regionSido ?? "",
        f.siteAddress ?? "",
        f.airClass != null ? `${f.airClass}종` : "",
        f.waterClass != null ? `${f.waterClass}종` : "",
      ];
    });

    // 파일명·표 제목 조합
    // 통합허가 업종인 경우: [업종] [지역1]·[지역2]... 사업장 리스트(YY.MM.DD.)
    // 아닌 경우:            [지역1]·[지역2]... 사업장 리스트(YY.MM.DD.)
    const regionPart = sidoList.length > 0 ? ` ${sidoList.join("·")}` : "";
    const industryPart = isIntegrated && industryLabel ? `${industryLabel} ` : "";
    const titleBase = `${industryPart}${regionPart.trimStart()} 사업장 리스트`.trim();

    const now = new Date();
    const fileStamp = stampDisplay(now);
    const isoDate = now.toISOString().slice(0, 10);

    const spec: TableDocumentSpec = {
      headers: HEADERS,
      aligns: ALIGNS,
      pdfColWidths: [30, 64, 62, 130, 125, 56, 228, 33, 33],
      xlsxColChars: [6, 14, 12, 30, 30, 12, 44, 8, 8],
      sheetName: "사업장목록",
      orientation: "landscape",
      rows,
      totalLabel: "총 계",
      totalValue: `${rows.length.toLocaleString("ko-KR")}개소`,
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
