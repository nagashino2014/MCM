import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getS3Client } from "@/lib/storage/logo-storage";
import { readContractDocument } from "@/lib/storage/contract-document-storage";
import { attachmentContentType } from "@/lib/approval/attachments";
import { getPersonalDoc } from "@/lib/files/personal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/personal-docs/open?id={documentId} — 본인 문서 열기(인라인 스트리밍).
// 메일 작성창 첨부 프리필(?attach=)의 blob 소스로도 쓰인다.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const doc = await getPersonalDoc(ctx.userId, id);
    if (!doc) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });

    const contentType = doc.contentType || attachmentContentType(doc.fileName);
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
    };
    if (process.env.CONTRACT_DOCUMENT_STORAGE_ROOT?.trim()) {
      const buf = await readContractDocument(doc.storageKey);
      if (!buf) return NextResponse.json({ error: "파일 본문이 없습니다." }, { status: 404 });
      return new NextResponse(new Uint8Array(buf), { headers });
    }
    const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
    if (!bucket) return NextResponse.json({ error: "스토리지 미설정" }, { status: 500 });
    const out = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: doc.storageKey }));
    const body = out.Body as unknown as ReadableStream<Uint8Array> | undefined;
    if (!body) return NextResponse.json({ error: "파일 본문이 없습니다." }, { status: 404 });
    if (typeof out.ContentLength === "number") headers["Content-Length"] = String(out.ContentLength);
    return new NextResponse(body, { headers });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
