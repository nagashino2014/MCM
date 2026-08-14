import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { renderPayslipPdf } from "@/lib/payroll/statement-pdf";
import { buildPayslipInput } from "@/lib/payroll/statements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 관리자 명세서 미리보기 PDF — 대장 라인에서 온디맨드 렌더(파일 무저장). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  try {
    await requireAdmin();
    const { entryId } = await params;
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
