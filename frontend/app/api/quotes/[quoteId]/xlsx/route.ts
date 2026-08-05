import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { binaryResponse, readStorageObject } from "@/lib/contracts/document-bundle";
import { generateQuoteArtifacts } from "@/lib/quote/generate";
import { getQuoteById } from "@/lib/quote/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// GET: 견적서 xlsx 다운로드 — 내부 보관용 원본(외부 발송은 PDF만 — 확정 사항 2).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    await requirePermission("approval.view");
    const { quoteId } = await params;
    const quote = await getQuoteById(quoteId);
    if (!quote) return NextResponse.json({ error: "견적을 찾을 수 없습니다." }, { status: 404 });
    const fileName = `(${quote.quoteNo ?? "미채번"})${quote.title ?? "견적서"}.xlsx`;

    let bytes: Uint8Array | null = null;
    if (quote.xlsxKey) {
      bytes = await readStorageObject(quote.xlsxKey).catch(() => null);
    }
    if (!bytes) {
      const artifacts = await generateQuoteArtifacts(quote.docId, { persist: false });
      bytes = artifacts.xlsxBytes;
    }
    if (!bytes) return NextResponse.json({ error: "xlsx 원본이 없습니다." }, { status: 404 });
    return binaryResponse(bytes, XLSX_MIME, fileName);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
