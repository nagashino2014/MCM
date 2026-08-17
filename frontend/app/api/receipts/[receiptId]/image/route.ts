import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { getReceipt } from "@/lib/finance/receipts";
import { readContractDocument } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 영수증 이미지 인라인 서빙 — 본인 또는 재무 조회 권한자(finance.view)만.
// ?kind=pdf 면 증빙 PDF 를 내려준다(내 영수증함 미리보기·다운로드 겸용).
export async function GET(req: NextRequest, { params }: { params: Promise<{ receiptId: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { receiptId } = await params;
    const receipt = await getReceipt(receiptId);
    if (!receipt) return NextResponse.json({ error: "영수증을 찾을 수 없습니다." }, { status: 404 });
    if (receipt.ownerUserId !== ctx.userId && !(await hasPermission(ctx.userId, "finance.view"))) {
      return NextResponse.json({ error: "본인 영수증만 열람할 수 있습니다." }, { status: 403 });
    }
    const isPdf = req.nextUrl.searchParams.get("kind") === "pdf";
    const buffer = await readContractDocument(isPdf ? receipt.pdfKey : receipt.imageKey);
    if (!buffer) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": isPdf ? "application/pdf" : "image/jpeg",
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": "inline",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
