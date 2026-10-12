import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { createLargeAttachmentUpload } from "@/lib/mail/large-attachments";
import { assertAttachmentsAllowed } from "@/lib/security/attachment-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 대용량 첨부 업로드 발급 — { fileName, contentType, byteSize } → { uploadId, url(presigned PUT) }.
// 원문 첨부 한도(25MB)를 넘는 파일만 작성 화면이 이 경로로 보낸다(261).
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => null)) as { fileName?: unknown; contentType?: unknown; byteSize?: unknown } | null;
    await assertAttachmentsAllowed(ctx.userId, [typeof body?.fileName === "string" ? body.fileName : ""]);
    const out = await createLargeAttachmentUpload(ctx.userId, {
      fileName: typeof body?.fileName === "string" ? body.fileName : "file",
      contentType: typeof body?.contentType === "string" ? body.contentType : "application/octet-stream",
      byteSize: typeof body?.byteSize === "number" ? body.byteSize : 0,
    });
    return NextResponse.json(out);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
