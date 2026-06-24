import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated, requireEditor } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { addIssueAttachment, getIssueSubject, listIssueAttachments } from "@/lib/work-plan/issues";
import { getIssueAttachmentStorageKey, putIssueAttachment } from "@/lib/storage/issue-attachment-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 30 * 1024 * 1024;

interface RouteContext {
  params: Promise<{ issueId: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requireAuthenticated();
    const { issueId } = await ctx.params;
    return NextResponse.json({ attachments: await listIssueAttachments(issueId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 이슈 첨부 업로드 — 용역/Task 별 S3 키로 저장.
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { issueId } = await ctx.params;
    const subject = await getIssueSubject(issueId);
    if (!subject) return NextResponse.json({ error: "이슈를 찾을 수 없습니다." }, { status: 404 });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "파일은 30MB 이하만 첨부할 수 있습니다." }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const { storageKey, fileName } = getIssueAttachmentStorageKey({
      subjectKind: subject.kind,
      subjectId: subject.id,
      issueId,
      fileName: file.name || "attachment",
    });
    const contentType = file.type || "application/octet-stream";
    const stored = await putIssueAttachment(storageKey, buffer, contentType);

    const attachmentId = await addIssueAttachment(actor.userId, issueId, {
      fileName,
      contentType,
      byteSize: file.size,
      sha256,
      storageProvider: stored.storageProvider,
      storageBucket: stored.storageBucket,
      storageKey: stored.storageKey,
      publicPath: stored.publicPath,
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_document_upload",
      targetTable: "work_plan_issue_attachments",
      targetId: attachmentId,
      after: { issueId, storageKey: stored.storageKey },
    });
    return NextResponse.json({ attachmentId, attachments: await listIssueAttachments(issueId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
