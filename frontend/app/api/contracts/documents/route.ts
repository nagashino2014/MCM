import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getS3Client } from "@/lib/storage/logo-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const key = req.nextUrl.searchParams.get("key")?.trim();
    if (!key || key.includes("..") || key.startsWith("/") || key.startsWith("\\")) {
      return NextResponse.json({ error: "문서 키가 올바르지 않습니다." }, { status: 400 });
    }

    const localRoot = process.env.CONTRACT_DOCUMENT_STORAGE_ROOT?.trim();
    if (localRoot) {
      const root = path.resolve(localRoot);
      const target = path.resolve(root, key);
      if (!target.startsWith(root + path.sep)) {
        return NextResponse.json({ error: "문서 키가 올바르지 않습니다." }, { status: 400 });
      }
      const info = await stat(target);
      const body = await readFile(target);
      return new NextResponse(body, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(info.size),
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
    if (!bucket) {
      return NextResponse.json({ error: "문서 저장소 환경변수가 설정되지 않았습니다." }, { status: 500 });
    }
    const out = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = out.Body as unknown as ReadableStream<Uint8Array> | undefined;
    if (!body) return NextResponse.json({ error: "문서를 읽을 수 없습니다." }, { status: 404 });
    return new NextResponse(body, {
      headers: {
        "Content-Type": out.ContentType ?? "application/pdf",
        "Content-Length": out.ContentLength != null ? String(out.ContentLength) : "",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
