import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getChatAttachmentForUser } from "@/lib/chat/queries";
import { getS3Client } from "@/lib/storage/logo-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?id=<attachmentId> : 채팅 첨부 다운로드 — 방 멤버십 검증 후 S3 스트리밍(mail 첨부 패턴).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    }
    const att = await getChatAttachmentForUser(ctx.userId, id);
    if (!att) return NextResponse.json({ error: "첨부를 찾을 수 없습니다." }, { status: 404 });

    const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
    if (!bucket) return NextResponse.json({ error: "스토리지 미설정" }, { status: 500 });
    const out = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: att.storageKey }));
    const body = out.Body as unknown as ReadableStream<Uint8Array> | undefined;
    if (!body) return NextResponse.json({ error: "본문 없음" }, { status: 404 });

    const isImage = (att.contentType ?? "").startsWith("image/");
    const filenameStar = `UTF-8''${encodeURIComponent(att.fileName)}`;
    return new NextResponse(body, {
      headers: {
        "Content-Type": att.contentType || out.ContentType || "application/octet-stream",
        // 이미지는 버블 인라인 렌더용 — inline. 그 외 파일은 다운로드.
        "Content-Disposition": `${isImage ? "inline" : "attachment"}; filename*=${filenameStar}`,
        ...(typeof out.ContentLength === "number" ? { "Content-Length": String(out.ContentLength) } : {}),
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
