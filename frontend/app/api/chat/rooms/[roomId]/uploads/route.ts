import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getRoomDetail } from "@/lib/chat/queries";
import { getChatAttachmentStorageKey } from "@/lib/storage/chat-attachment-storage";
import { getS3Client } from "@/lib/storage/logo-storage";
import { assertAttachmentsAllowed } from "@/lib/security/attachment-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** presigned 대용량 상한(MSG-P2) — 파일 선택(탐색기) 기준 파일당 2GB(2026-09-17 사용자 요청, 종전 200MB).
 *  끌어다 놓기·붙여넣기 30MB 제한은 클라이언트가 건다. */
const MAX_PRESIGNED_BYTES = 2 * 1024 * 1024 * 1024;
const PRESIGN_EXPIRES_SEC = 600;

// presigned PUT 발급 — { fileName, contentType, byteSize } → { url, storageKey }.
// 25MB 이하는 messages POST multipart 경로를 그대로 쓴다(클라가 자동 분기).
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  try {
    const { userId } = await requireSession();
    const roomId = Number((await ctx.params).roomId);
    if (!Number.isInteger(roomId) || roomId <= 0) {
      return NextResponse.json({ error: "잘못된 대화방입니다." }, { status: 400 });
    }
    if (!(await getRoomDetail(roomId, userId))) {
      return NextResponse.json({ error: "대화방 멤버가 아닙니다." }, { status: 403 });
    }
    const body = (await req.json().catch(() => null)) as
      | { fileName?: unknown; contentType?: unknown; byteSize?: unknown }
      | null;
    const fileName = typeof body?.fileName === "string" && body.fileName ? body.fileName : "file";
    const contentType =
      typeof body?.contentType === "string" && body.contentType ? body.contentType : "application/octet-stream";
    const byteSize = typeof body?.byteSize === "number" ? body.byteSize : 0;
    if (byteSize <= 0 || byteSize > MAX_PRESIGNED_BYTES) {
      return NextResponse.json({ error: "첨부는 파일당 2GB 까지 보낼 수 있습니다." }, { status: 413 });
    }
    await assertAttachmentsAllowed(userId, [fileName]); // 첨부 확장자 정책(262)
    const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
    if (!bucket) return NextResponse.json({ error: "스토리지 미설정" }, { status: 500 });

    const { storageKey, fileName: safeName } = getChatAttachmentStorageKey({ roomId, fileName });
    const url = await getSignedUrl(
      getS3Client(),
      new PutObjectCommand({ Bucket: bucket, Key: storageKey, ContentType: contentType }),
      { expiresIn: PRESIGN_EXPIRES_SEC }
    );
    return NextResponse.json({ url, storageKey, fileName: safeName });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
