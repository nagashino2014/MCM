import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { binaryResponse, readStorageObject, sanitizeDownloadName } from "@/lib/contracts/document-bundle";
import { generateQuoteArtifacts } from "@/lib/quote/generate";
import { getQuoteById } from "@/lib/quote/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: 견적서 PDF — S3 보관본 프록시. 미생성이면 on-demand 렌더(저장 안 함 — 결재 진행 중 열람용).
// ?disposition=inline 은 팝업 미리보기용.
export async function GET(req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    await requirePermission("approval.view");
    const { quoteId } = await params;
    const quote = await getQuoteById(quoteId);
    if (!quote) return NextResponse.json({ error: "견적을 찾을 수 없습니다." }, { status: 404 });
    const inline = req.nextUrl.searchParams.get("disposition") === "inline";
    const fileName = `(${quote.quoteNo ?? "미채번"})${quote.title ?? "견적서"}.pdf`;

    let bytes: Uint8Array | null = null;
    if (quote.pdfKey) {
      bytes = await readStorageObject(quote.pdfKey).catch(() => null);
    }
    if (!bytes) {
      const artifacts = await generateQuoteArtifacts(quote.docId, { persist: false });
      bytes = artifacts.pdfBytes;
    }
    if (!bytes) return NextResponse.json({ error: "PDF 원본이 없습니다." }, { status: 404 });

    if (inline) {
      return new NextResponse(Buffer.from(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(sanitizeDownloadName(fileName))}`,
          "Cache-Control": "private, max-age=0, no-store",
        },
      });
    }
    return binaryResponse(bytes, "application/pdf", fileName);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
