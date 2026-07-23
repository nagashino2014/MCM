import { NextRequest, NextResponse } from "next/server";
import { S3ServiceException } from "@aws-sdk/client-s3";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { findNoticeAttachment } from "@/lib/approval/leave-promotion";
import { getNoticeAttachment } from "@/lib/storage/leave-notice-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// GET: 서면 사후 등록 스캔본 다운로드(admin) — ?key= (leave_notices.attachments 참조 검증).
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const key = new URL(req.url).searchParams.get("key");
    if (!key) return NextResponse.json({ error: "key가 필요합니다." }, { status: 400 });
    const meta = await findNoticeAttachment(key);
    if (!meta) return NextResponse.json({ error: "첨부를 찾을 수 없습니다." }, { status: 404 });
    const obj = await getNoticeAttachment(key);
    if (!obj.body) return NextResponse.json({ error: "첨부를 찾을 수 없습니다." }, { status: 404 });
    const headers = new Headers();
    headers.set("Content-Type", meta.contentType || obj.contentType);
    headers.set("Content-Disposition", contentDisposition(meta.name));
    headers.set("Cache-Control", "private, max-age=86400");
    if (obj.contentLength != null) headers.set("Content-Length", String(obj.contentLength));
    return new NextResponse(obj.body, { status: 200, headers });
  } catch (err) {
    if (err instanceof S3ServiceException && (err.name === "NoSuchKey" || err.name === "NotFound")) {
      return NextResponse.json({ error: "첨부를 찾을 수 없습니다." }, { status: 404 });
    }
    return authErrorToResponse(err);
  }
}
