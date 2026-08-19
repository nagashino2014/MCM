import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getS3Client } from "@/lib/storage/logo-storage";
import { readContractDocument } from "@/lib/storage/contract-document-storage";
import { attachmentContentType } from "@/lib/approval/attachments";
import { resolveLibraryFile } from "@/lib/files/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/files/open?id={source}:{키} — 파일함 행 클릭 열기(인라인 스트리밍).
// 브라우저가 렌더하는 형식(pdf·이미지)은 새 탭에서 열리고, 그 외는 다운로드된다.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("files.manage");
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const target = await resolveLibraryFile(id);
    if (!target) {
      return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
    }

    // 열람 감사로그 — 타 소스(메신저 등) 첨부 실물 접근이므로 접속기록을 남긴다(개보법 접속기록 축).
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "file_library_open",
      targetTable: "file_library",
      targetId: id,
      after: { fileName: target.fileName },
    });

    const contentType = target.contentType || attachmentContentType(target.fileName);
    const filenameStar = `UTF-8''${encodeURIComponent(target.fileName)}`;
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename*=${filenameStar}`,
    };

    // 로컬 개발(CONTRACT_DOCUMENT_STORAGE_ROOT) 폴백 — 공용 read 유틸 재사용.
    if (process.env.CONTRACT_DOCUMENT_STORAGE_ROOT?.trim()) {
      const buf = await readContractDocument(target.storageKey);
      if (!buf) return NextResponse.json({ error: "파일 본문이 없습니다." }, { status: 404 });
      return new NextResponse(new Uint8Array(buf), { headers });
    }

    const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
    if (!bucket) return NextResponse.json({ error: "스토리지 미설정" }, { status: 500 });
    const out = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: target.storageKey }));
    const body = out.Body as unknown as ReadableStream<Uint8Array> | undefined;
    if (!body) return NextResponse.json({ error: "파일 본문이 없습니다." }, { status: 404 });
    if (typeof out.ContentLength === "number") headers["Content-Length"] = String(out.ContentLength);
    return new NextResponse(body, { headers });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
