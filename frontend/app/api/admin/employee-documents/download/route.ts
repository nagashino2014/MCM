import { NextRequest, NextResponse } from "next/server";
import { S3ServiceException } from "@aws-sdk/client-s3";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { requireGlobalScope } from "@/lib/auth/scope-guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import { findEmployeeDocumentByKey } from "@/lib/admin/employee-records";
import { getEmployeeDocument } from "@/lib/storage/employee-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 뷰어에서 바로 여는 형식(?inline=1). 형식은 확장자로 고정해 업로드 때 받은 값을 믿지 않는다.
const INLINE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function contentDisposition(filename: string, disposition: "inline" | "attachment" = "attachment"): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("staffing.view", { fallbackRoles: ["admin"] });
    const searchParams = new URL(req.url).searchParams;
    const key = searchParams.get("key");
    if (!key) return NextResponse.json({ error: "key가 필요합니다." }, { status: 400 });
    const metadata = await findEmployeeDocumentByKey(key);
    if (!metadata) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    // 인사 서류는 소속 부서 범위로도 열지 않는다(2026-10-19 §7.7, 인사/계좌 = 관리자 vs 그 외)
    await requireGlobalScope("staffing.sensitive.view"); // 인사 서류는 민감정보 전용 키(관리자·인사담당)만(298, C-4)
    const fileName = metadata.originalFilename || metadata.displayName;
    const inlineType = searchParams.get("inline") === "1"
      ? INLINE_TYPES[fileName.split(".").pop()?.toLowerCase() ?? ""]
      : undefined;
    // 접속기록(PR-P1) — 타인 인사서류 열람·다운로드.
    await recordAccessLog({
      actorUserId: ctx.userId,
      action: inlineType ? "view" : "download",
      targetKind: "employee_doc",
      targetId: String(metadata.documentId ?? key),
      detail: { fileName, employeeId: metadata.employeeId ?? null },
    });
    const obj = await getEmployeeDocument(key);
    if (!obj.body) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    const headers = new Headers();
    headers.set("Content-Type", inlineType ?? obj.contentType);
    headers.set("Content-Disposition", contentDisposition(fileName, inlineType ? "inline" : "attachment"));
    headers.set("X-Content-Type-Options", "nosniff");
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
