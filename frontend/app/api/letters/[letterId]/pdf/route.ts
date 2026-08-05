import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { binaryResponse, readStorageObject, sanitizeDownloadName } from "@/lib/contracts/document-bundle";
import { generateLetterArtifacts } from "@/lib/letter/generate";
import { getLetterById } from "@/lib/letter/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: 공문 PDF — S3 보관본 프록시(동일 오리진 관례). 시스템 문서가 아직 미생성이면
// on-demand 렌더(저장 안 함 — 결재 진행 중 열람용). ?disposition=inline 은 팝업 미리보기용.
export async function GET(req: NextRequest, { params }: { params: Promise<{ letterId: string }> }) {
  try {
    await requirePermission("approval.view");
    const { letterId } = await params;
    const letter = await getLetterById(letterId);
    if (!letter) return NextResponse.json({ error: "공문을 찾을 수 없습니다." }, { status: 404 });
    const inline = req.nextUrl.searchParams.get("disposition") === "inline";
    const fileName = `(${letter.letterNo ?? "미채번"})${letter.title ?? "공문"}.pdf`;

    let bytes: Uint8Array | null = null;
    if (letter.pdfKey) {
      bytes = await readStorageObject(letter.pdfKey).catch(() => null);
    }
    if (!bytes && letter.docId) {
      const artifacts = await generateLetterArtifacts(letter.docId, { persist: false });
      bytes = artifacts.pdfBytes;
    }
    if (!bytes) return NextResponse.json({ error: "PDF 원본이 없습니다(과거 이관 문서는 hwp 원본을 확인하세요)." }, { status: 404 });

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
