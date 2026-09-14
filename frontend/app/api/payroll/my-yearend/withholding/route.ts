import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getWithholdingReceiptPdf } from "@/lib/finance/yearend-self";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ATTACH = "inline; filename*=UTF-8'" + "'";

/** 본인 근로소득 원천징수영수증 PDF(?year=) — 세무법인 원본 우선, 없으면 앱 산출 요약본. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const year = Number(req.nextUrl.searchParams.get("year") ?? 0);
    if (!year) return NextResponse.json({ error: "year 가 필요합니다." }, { status: 400 });
    const pdf = await getWithholdingReceiptPdf(year, { userId: ctx.userId });
    if (!pdf) return NextResponse.json({ error: "해당 귀속연도의 정산 결과가 아직 없습니다." }, { status: 404 });
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
