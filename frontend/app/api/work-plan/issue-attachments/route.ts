import path from "node:path";
import { readFile } from "node:fs/promises";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { assertKeyInDeptScope, loadAttachmentIssueId, requireIssueScope, resolveIssueAttachmentDept } from "@/lib/auth/scope-guards";
import { loadUserAccess } from "@/lib/auth/rbac";
import { getS3Client } from "@/lib/storage/logo-storage";
import { deleteIssueAttachment } from "@/lib/work-plan/issues";
import { deleteContractDocument } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 이슈 첨부 다운로드 (?key=).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("work_plan.view");
    const key = req.nextUrl.searchParams.get("key")?.trim();
    if (!key || key.includes("..") || key.startsWith("/") || key.startsWith("\\")) {
      return NextResponse.json({ error: "키가 올바르지 않습니다." }, { status: 400 });
    }
    // 키 → 이슈 → 계약 수행부서/Task 담당부서로 되짚어 부서 범위 재판정. 등록되지 않은 키는 전사 범위만(2026-10-19 §7.7).
    await assertKeyInDeptScope(await loadUserAccess(ctx.userId), "work_plan.view", await resolveIssueAttachmentDept(key));
    const localRoot = process.env.CONTRACT_DOCUMENT_STORAGE_ROOT?.trim();
    if (localRoot) {
      const root = path.resolve(localRoot);
      const target = path.resolve(root, key);
      if (!target.startsWith(root + path.sep)) return NextResponse.json({ error: "키가 올바르지 않습니다." }, { status: 400 });
      const body = await readFile(target);
      return new NextResponse(body, { headers: { "Cache-Control": "private, max-age=300" } });
    }
    const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
    if (!bucket) return NextResponse.json({ error: "저장소 환경변수가 없습니다." }, { status: 500 });
    const out = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = out.Body as unknown as ReadableStream<Uint8Array> | undefined;
    if (!body) return NextResponse.json({ error: "파일을 읽을 수 없습니다." }, { status: 404 });
    return new NextResponse(body, {
      headers: {
        "Content-Type": out.ContentType ?? "application/octet-stream",
        "Content-Length": out.ContentLength != null ? String(out.ContentLength) : "",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 이슈 첨부 삭제 (?attachmentId=).
export async function DELETE(req: NextRequest) {
  try {
    const attachmentId = req.nextUrl.searchParams.get("attachmentId")?.trim();
    if (!attachmentId) return NextResponse.json({ error: "attachmentId가 필요합니다." }, { status: 400 });
    await requireIssueScope("work_plan.edit", (await loadAttachmentIssueId(attachmentId)) ?? ""); // 이슈 주제 부서 범위(2026-10-19 §7.7)
    const key = await deleteIssueAttachment(attachmentId);
    if (key) await deleteContractDocument(key); // S3/로컬 best-effort 정리
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
