import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDoc } from "@/lib/approval/docs";
import { resolveDocAccess } from "@/lib/approval/access";
import { attachmentPreviewKind, type DocAttachment } from "@/lib/approval/attachments";
import { convertToPdf, pdfResponse, previewKey, rawResponse } from "@/lib/approval/attachment-preview";
import { putContractDocument, readContractDocument } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * GET: 문서 첨부 1건 — 결재자가 뷰어에서 내용을 확인하기 위한 경로.
 *  - mode=raw(기본)  : 원본 그대로(inline). pdf·이미지는 브라우저가 바로 렌더한다.
 *  - mode=pdf        : 오피스·hwpx 를 PDF 로 변환해 반환(백엔드 LibreOffice). 결과는 S3 에 캐시.
 *  - download=1      : 첨부로 내려받기(Content-Disposition attachment)
 * 열람 권한은 문서 상세와 동일 규칙(resolveDocAccess).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ docId: string; index: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { docId, index } = await params;
    const doc = await getDoc(docId);
    if (!doc) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    const { allowed } = await resolveDocAccess(doc, ctx.userId);
    if (!allowed) return NextResponse.json({ error: "이 문서를 열람할 권한이 없습니다." }, { status: 403 });

    const list = (doc.fieldValues?.file_attachments ?? []) as DocAttachment[];
    const item = Array.isArray(list) ? list[Number(index)] : undefined;
    if (!item?.key) return NextResponse.json({ error: "첨부를 찾을 수 없습니다." }, { status: 404 });

    const mode = req.nextUrl.searchParams.get("mode") ?? "raw";
    const download = req.nextUrl.searchParams.get("download") === "1";

    if (mode === "pdf" && attachmentPreviewKind(item.name) === "convert") {
      const cached = await readContractDocument(previewKey(item.key));
      if (cached) return pdfResponse(cached, item.name, download);
      const source = await readContractDocument(item.key);
      if (!source) return NextResponse.json({ error: "첨부 원본을 읽을 수 없습니다." }, { status: 404 });
      const converted = await convertToPdf(source, item.name);
      if (!converted.ok) return NextResponse.json({ error: converted.error }, { status: converted.status });
      // 캐시 저장 실패는 무시 — 다음 조회에서 다시 변환하면 된다.
      await putContractDocument(previewKey(item.key), converted.pdf, "application/pdf").catch(() => {});
      return pdfResponse(converted.pdf, item.name, download);
    }

    const body = await readContractDocument(item.key);
    if (!body) return NextResponse.json({ error: "첨부 원본을 읽을 수 없습니다." }, { status: 404 });
    return rawResponse(body, item.name, download);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
