import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { buildWithholdingWorkbook, withholdingByMonth } from "@/lib/finance/withholding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 연도 원천징수 월별 집계. format=xlsx → 신고 기초자료 다운로드
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const year = Number(req.nextUrl.searchParams.get("year") ?? 0) || new Date().getFullYear();
    if (req.nextUrl.searchParams.get("format") === "xlsx") {
      const buf = await buildWithholdingWorkbook(year);
      const filename = encodeURIComponent(`원천징수집계_${year}.xlsx`);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        },
      });
    }
    return NextResponse.json({ year, months: await withholdingByMonth(year) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
