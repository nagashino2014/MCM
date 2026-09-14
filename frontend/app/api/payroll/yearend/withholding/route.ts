import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { getWithholdingReceiptPdf } from "@/lib/finance/yearend-self";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ATTACH = "inline; filename*=UTF-8'" + "'";

/** 관리자 — 직원 원천징수영수증 PDF 미리보기(?year=&employeeId=). */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const year = Number(req.nextUrl.searchParams.get("year") ?? 0);
    const employeeId = req.nextUrl.searchParams.get("employeeId") ?? "";
    if (!year || !employeeId) return NextResponse.json({ error: "year·employeeId 가 필요합니다." }, { status: 400 });
    const pdf = await getWithholdingReceiptPdf(year, { employeeId });
    if (!pdf) return NextResponse.json({ error: "정산 결과가 없습니다." }, { status: 404 });
    return new NextResponse(Buffer.from(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": ATTACH + encodeURIComponent(pdf.fileName),
        "X-Receipt-Source": pdf.source,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
