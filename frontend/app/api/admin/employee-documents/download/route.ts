import { NextRequest, NextResponse } from "next/server";
import { S3ServiceException } from "@aws-sdk/client-s3";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import { findEmployeeDocumentByKey } from "@/lib/admin/employee-records";
import { getEmployeeDocument } from "@/lib/storage/employee-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("staffing.view", { fallbackRoles: ["admin"] });
    const key = new URL(req.url).searchParams.get("key");
    if (!key) return NextResponse.json({ error: "key가 필요합니다." }, { status: 400 });
    const metadata = await findEmployeeDocumentByKey(key);
    if (!metadata) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    // 접속기록(PR-P1) — 타인 인사서류 다운로드.
    await recordAccessLog({
      actorUserId: ctx.userId,
      action: "download",
      targetKind: "employee_doc",
      targetId: String(metadata.documentId ?? key),
      detail: { fileName: metadata.originalFilename || metadata.displayName, employeeId: metadata.employeeId ?? null },
    });
    const obj = await getEmployeeDocument(key);
    if (!obj.body) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    const headers = new Headers();
    headers.set("Content-Type", obj.contentType);
    headers.set("Content-Disposition", contentDisposition(metadata.originalFilename || metadata.displayName));
    headers.set("Cache-Control", "private, max-age=86400");
    if (obj.contentLength != null) headers.set("Content-Length", String(obj.contentLength));
    if (obj.etag) headers.set("ETag", obj.etag);
    if (obj.lastModified) headers.set("Last-Modified", obj.lastModified.toUTCString());
    return new NextResponse(obj.body, { status: 200, headers });
  } catch (err) {
    if (err instanceof S3ServiceException) {
      if (err.name === "NoSuchKey" || err.name === "NotFound") {
        return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
      }
    }
    return authErrorToResponse(err);
  }
}
