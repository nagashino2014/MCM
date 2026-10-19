import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { assertContractsVisible, requireVisibleContracts } from "@/lib/auth/scope-guards";
import { getAgreementByDocId } from "@/lib/agreement/store";
import { generateAgreementArtifacts } from "@/lib/agreement/generate";
import { readStorageObject, sanitizeDownloadName } from "@/lib/contracts/document-bundle";

// GET: 계약서 PDF — S3 보관본 프록시, 없으면 on-demand 렌더(공문 pdf 라우트 관례).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const { visible } = await requireVisibleContracts("contract.view");
    const { docId } = await params;
    const row = await getAgreementByDocId(docId);
    if (row) assertContractsVisible(visible, [row.contractId]); // 연동 계약 가시 범위(2026-10-19 §7.7)
    let bytes: Uint8Array | null = null;
    let fileName = "계약서.pdf";
    if (row?.pdfKey) {
      bytes = await readStorageObject(row.pdfKey).catch(() => null);
      fileName = row.pdfKey.split("/").pop() ?? fileName;
    }
    if (!bytes) {
      const artifacts = await generateAgreementArtifacts(docId, { persist: false });
      bytes = artifacts.pdfBytes;
      fileName = `${artifacts.fileBase}.pdf`;
    }
    const disposition = req.nextUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment";
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(sanitizeDownloadName(fileName))}`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
