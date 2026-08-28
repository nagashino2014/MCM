import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getS3Client } from "@/lib/storage/logo-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 다운로드 파일명 헤더(2026-08-24 사용자 요청) — 저장 키의 마지막 세그먼트가 이미
 * "(계약일)계약명 계약서.pdf" 규약이라 그대로 파일명으로 쓴다. inline 이므로 뷰어에는
 * 그대로 열리고, 브라우저 PDF 뷰어의 다운로드 버튼이 이 이름으로 저장한다.
 * 한글은 RFC 5987(filename*=UTF-8'') — encodeURIComponent 가 남기는 ( ) ' * 도
 * attr-char 가 아니라 수동 이스케이프한다(mime.ts RFC2231 괄호 미인코딩 SES 거부 교훈).
 */
function contentDisposition(key: string): string {
  const base = key.split("/").pop() || "document.pdf";
  const encoded = encodeURIComponent(base).replace(/[()'*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `inline; filename="document.pdf"; filename*=UTF-8''${encoded}`;
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission("contract.view");
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
          "Content-Disposition": contentDisposition(key),
          // 계산서 재캡처 등 같은 키로 교체되는 문서가 5분 캐시로 옛것을 보여줬다(2026-08-26)
          // — 문서 열람은 빈도가 낮아 캐시 이득이 없다. 항상 새로 받는다.
          "Cache-Control": "private, no-store",
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
        "Content-Disposition": contentDisposition(key),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
