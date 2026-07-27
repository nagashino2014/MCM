import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getAttachmentForUser } from "@/lib/mail/messages";
import { getS3Client } from "@/lib/storage/logo-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?id=<attachmentId> : 메일 첨부 다운로드(소유권 검증 후 app_data 버킷에서 스트리밍).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const id = String(req.nextUrl.searchParams.get("id") ?? "");
    if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    const att = await getAttachmentForUser(ctx.userId, id);
    if (!att) return NextResponse.json({ error: "첨부를 찾을 수 없습니다." }, { status: 404 });

    const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
    if (!bucket) return NextResponse.json({ error: "스토리지 미설정" }, { status: 500 });
    const out = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: att.s3Key }));
    const body = out.Body as unknown as ReadableStream<Uint8Array> | undefined;
    if (!body) return NextResponse.json({ error: "본문 없음" }, { status: 404 });

    const filenameStar = `UTF-8''${encodeURIComponent(att.filename)}`;
    return new NextResponse(body, {
      headers: {
        "Content-Type": att.contentType || out.ContentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=${filenameStar}`,
        ...(typeof out.ContentLength === "number" ? { "Content-Length": String(out.ContentLength) } : {}),
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
