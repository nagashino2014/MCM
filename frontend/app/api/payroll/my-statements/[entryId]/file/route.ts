import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { renderPayslipPdf } from "@/lib/payroll/statement-pdf";
import { assertOwnPayslip, buildPayslipInput } from "@/lib/payroll/statements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 본인 급여명세서 PDF — 발행(발송)된 본인 행만 열람 가능. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  try {
    const ctx = await requireSession();
    const { entryId } = await params;
    await assertOwnPayslip(ctx.userId, entryId);
    const input = await buildPayslipInput(entryId);
    const bytes = await renderPayslipPdf(input);
    const fileName = `${input.employeeName} 급여명세서(${input.payYear}년 ${input.payMonth}월).pdf`;
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
