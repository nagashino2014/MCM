import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { getS3Client } from "@/lib/storage/logo-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?key=<storageKey> : 게시판 첨부 다운로드(로그인 사용자면 열람 가능 — 사내 공지 특성).
export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const key = String(req.nextUrl.searchParams.get("key") ?? "");
    if (!key) return NextResponse.json({ error: "key 가 필요합니다." }, { status: 400 });

    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(`SELECT file_name, content_type FROM board_attachments WHERE storage_key = $1 LIMIT 1`, [key])
    );
    if (!rows.length) return NextResponse.json({ error: "첨부를 찾을 수 없습니다." }, { status: 404 });
    const fileName = String(rows[0].file_name);
    const contentType = rows[0].content_type != null ? String(rows[0].content_type) : "application/octet-stream";

    const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
    if (!bucket) return NextResponse.json({ error: "스토리지 미설정" }, { status: 500 });
    const out = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = out.Body as unknown as ReadableStream<Uint8Array> | undefined;
    if (!body) return NextResponse.json({ error: "본문 없음" }, { status: 404 });

    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        ...(typeof out.ContentLength === "number" ? { "Content-Length": String(out.ContentLength) } : {}),
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
