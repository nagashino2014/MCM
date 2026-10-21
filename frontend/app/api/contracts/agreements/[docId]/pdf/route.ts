import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { assertContractsVisible, requireVisibleContracts } from "@/lib/auth/scope-guards";
import { isDocDrafter } from "@/lib/approval/docs";
import { getAgreementByDocId } from "@/lib/agreement/store";
import { generateAgreementArtifacts } from "@/lib/agreement/generate";
import { readStorageObject, sanitizeDownloadName } from "@/lib/contracts/document-bundle";

// GET: 계약서 PDF — S3 보관본 프록시, 없으면 on-demand 렌더(공문 pdf 라우트 관례).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const { ctx, visible } = await requireVisibleContracts("contract.view");
    const { docId } = await params;
    const row = await getAgreementByDocId(docId);
    // 연동 계약 가시 범위(2026-10-19 §7.7) — 기안자 본인은 범위와 무관하게 받는다(2026-10-21)
    if (row && !(await isDocDrafter(ctx.userId, docId))) assertContractsVisible(visible, [row.contractId]);
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
