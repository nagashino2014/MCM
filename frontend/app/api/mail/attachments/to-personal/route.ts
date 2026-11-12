import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listMessageAttachmentsForUser } from "@/lib/mail/messages";
import { uploadPersonalDoc } from "@/lib/files/personal";
import { getS3Client } from "@/lib/storage/logo-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 메일 첨부 → 개인문서함 복사(2026-11-12 사용자 요청) — 첨부 칸의 '개인문서함으로 저장'을 켜면 내 PC 대신 여기로 저장한다.
// 소유권은 ZIP·단일 다운로드와 같다(이 유저 mailbox 의 메시지만). 인라인(cid) 이미지는 뺀다.
// 용량·파일당 200MB 한도는 개인문서함 업로드(uploadPersonalDoc)가 그대로 검사하고, 넘는 파일은 건너뛰어 사유를 돌려준다.

// POST { messageId, attachmentIds?: string[] } — attachmentIds 가 없으면 그 메일의 일반 첨부 전부.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { messageId?: unknown; attachmentIds?: unknown };
    const messageId = typeof body.messageId === "string" ? body.messageId : "";
    if (!messageId) return NextResponse.json({ error: "messageId 가 필요합니다." }, { status: 400 });
    const found = await listMessageAttachmentsForUser(ctx.userId, messageId);
    if (!found) return NextResponse.json({ error: "메일을 찾을 수 없습니다." }, { status: 404 });
    const wanted = Array.isArray(body.attachmentIds) ? new Set(body.attachmentIds.map(String)) : null;
    const files = wanted ? found.files.filter((f) => wanted.has(f.attachmentId)) : found.files;
    if (!files.length) return NextResponse.json({ error: "저장할 첨부가 없습니다." }, { status: 404 });

    const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
    if (!bucket) return NextResponse.json({ error: "스토리지 미설정" }, { status: 500 });
    const s3 = getS3Client();
    const saved: { fileName: string; documentId: string }[] = [];
    const failed: { fileName: string; reason: string }[] = [];
    for (const f of files) {
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: f.s3Key }));
        if (!out.Body) throw new Error("파일을 읽지 못했습니다.");
        const buffer = Buffer.from(await out.Body.transformToByteArray());
        const row = await uploadPersonalDoc(ctx.userId, {
          fileName: f.filename,
          contentType: f.contentType || "application/octet-stream",
          buffer,
        });
        saved.push({ fileName: row.fileName, documentId: row.documentId });
      } catch (err) {
        failed.push({ fileName: f.filename, reason: err instanceof Error ? err.message : "저장하지 못했습니다." });
      }
    }
    return NextResponse.json({ saved, failed }, { status: saved.length ? 200 : 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
