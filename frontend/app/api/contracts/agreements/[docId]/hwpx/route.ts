import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { assertContractsVisible, requireVisibleContracts } from "@/lib/auth/scope-guards";
import { getAgreementByDocId } from "@/lib/agreement/store";
import { generateAgreementArtifacts } from "@/lib/agreement/generate";
import { readStorageObject, sanitizeDownloadName } from "@/lib/contracts/document-bundle";

// GET: 계약서 HWPX 다운로드 — S3 보관본 프록시, 없으면 on-demand 렌더.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const { visible } = await requireVisibleContracts("contract.view");
    const { docId } = await params;
    const row = await getAgreementByDocId(docId);
    if (row) assertContractsVisible(visible, [row.contractId]); // 연동 계약 가시 범위(2026-10-19 §7.7)
    let bytes: Uint8Array | null = null;
    let fileName = "계약서.hwpx";
    if (row?.hwpxKey) {
      bytes = await readStorageObject(row.hwpxKey).catch(() => null);
      fileName = row.hwpxKey.split("/").pop() ?? fileName;
    }
    if (!bytes) {
      const artifacts = await generateAgreementArtifacts(docId, { persist: false });
      if (!artifacts.hwpxBytes) return NextResponse.json({ error: "HWPX 생성에 실패했습니다." }, { status: 500 });
      bytes = artifacts.hwpxBytes;
      fileName = `${artifacts.fileBase}.hwpx`;
    }
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/vnd.hancom.hwpx",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(sanitizeDownloadName(fileName))}`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
