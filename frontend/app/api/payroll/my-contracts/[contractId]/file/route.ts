import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { assertOwnContract } from "@/lib/payroll/sign";
import { buildContractPdfById } from "@/lib/payroll/contract-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 본인 계약서 PDF — generated 계약을 온디맨드 렌더(서명 완료 시 서명 각인 확정본). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contractId: string }> }
) {
  try {
    const ctx = await requireSession();
    const { contractId } = await params;
    await assertOwnContract(ctx.userId, contractId);
    const built = await buildContractPdfById(contractId);
    if (!built) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    return new NextResponse(Buffer.from(built.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(built.fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
