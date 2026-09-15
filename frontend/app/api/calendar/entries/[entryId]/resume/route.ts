// 면접 일정 이력서(PDF) — POST 업로드(multipart file, 면접 관리자) / GET 열람(참석자·등록자·면접 관리자) / DELETE.
// 열람은 inline 스트리밍 — 웹은 iframe 뷰어, 모바일은 openAttachment(캐시 다운로드 → 공유 시트).

import { NextRequest, NextResponse } from "next/server";
import { S3ServiceException } from "@aws-sdk/client-s3";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { canEditEntry, canViewInterview, getEntryRow, loadEntryAccess, setEntryResume } from "@/lib/calendar/entries";
import { buildResumeStorageKey, deleteResume, getResume, putResume } from "@/lib/storage/calendar-resume-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;

type Ctx = { params: Promise<{ entryId: string }> };

function contentDisposition(filename: string, disposition: "inline" | "attachment"): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireSession();
    const { entryId } = await params;
    const access = await loadEntryAccess(ctx.userId);
    const row = await getEntryRow(entryId);
    if (!row || row.kind !== "interview") return NextResponse.json({ error: "면접 일정을 찾을 수 없습니다." }, { status: 404 });
    if (!canEditEntry(row, access)) return NextResponse.json({ error: "이력서를 첨부할 권한이 없습니다." }, { status: 403 });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "file 이 필요합니다." }, { status: 400 });
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) return NextResponse.json({ error: "PDF 파일만 첨부할 수 있습니다." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "이력서는 20MB 이하만 첨부할 수 있습니다." }, { status: 400 });

    const { storageKey, fileName } = buildResumeStorageKey({ entryId, originalFilename: file.name || "이력서.pdf" });
    await putResume(storageKey, Buffer.from(await file.arrayBuffer()), "application/pdf");
    if (row.extra.resume?.storageKey) await deleteResume(row.extra.resume.storageKey);
    const resume = { storageKey, fileName, contentType: "application/pdf", size: file.size };
    await setEntryResume(entryId, resume);
    return NextResponse.json({ resume });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireSession();
    const { entryId } = await params;
    const access = await loadEntryAccess(ctx.userId);
    const row = await getEntryRow(entryId);
    if (!row || row.kind !== "interview" || !row.extra.resume) return NextResponse.json({ error: "이력서가 없습니다." }, { status: 404 });
    if (!canViewInterview(row, access)) return NextResponse.json({ error: "이력서를 열람할 권한이 없습니다." }, { status: 403 });
    const disposition = req.nextUrl.searchParams.get("disposition") === "attachment" ? "attachment" : "inline";
    const obj = await getResume(row.extra.resume.storageKey);
    if (!obj.body) return NextResponse.json({ error: "이력서를 찾을 수 없습니다." }, { status: 404 });
    const headers = new Headers();
    headers.set("Content-Type", "application/pdf");
    headers.set("Content-Disposition", contentDisposition(row.extra.resume.fileName, disposition));
    headers.set("Cache-Control", "private, no-store");
    if (obj.contentLength != null) headers.set("Content-Length", String(obj.contentLength));
    return new NextResponse(obj.body, { status: 200, headers });
  } catch (err) {
    if (err instanceof S3ServiceException && (err.name === "NoSuchKey" || err.name === "NotFound")) {
      return NextResponse.json({ error: "이력서를 찾을 수 없습니다." }, { status: 404 });
    }
    return authErrorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireSession();
    const { entryId } = await params;
    const access = await loadEntryAccess(ctx.userId);
    const row = await getEntryRow(entryId);
    if (!row || row.kind !== "interview") return NextResponse.json({ error: "면접 일정을 찾을 수 없습니다." }, { status: 404 });
    if (!canEditEntry(row, access)) return NextResponse.json({ error: "이력서를 삭제할 권한이 없습니다." }, { status: 403 });
    if (row.extra.resume?.storageKey) await deleteResume(row.extra.resume.storageKey);
    await setEntryResume(entryId, null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
