import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 파일 1건 상한 200MB(사용자 확정) — 메일 직접 첨부 한도(7MB) 초과분은 발송 시
 *  다운로드 링크(presigned, 7일)로 자동 전환된다(lib/letter/send.ts). */
const MAX_FILE_BYTES = 200 * 1024 * 1024;

// POST: 공문 동봉 첨부 업로드(multipart files[]) — S3 letters/drafts/{YYYYMM}/ 에 적재하고
// {name,key,size} 목록을 반환한다. field_values.file_attachments 로 문서에 실려 발송 메일에 동봉.
export async function POST(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (!files.length) return NextResponse.json({ error: "files 가 필요합니다." }, { status: 400 });

    const ym = new Date().toISOString().slice(0, 7).replace("-", "");
    const items: { name: string; key: string; size: number }[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `${file.name}: 파일이 200MB 를 초과합니다.` }, { status: 400 });
      }
      const name = sanitizeFilename(file.name || "첨부파일");
      const key = `letters/drafts/${ym}/${crypto.randomUUID().slice(0, 8)}_${name}`;
      await putContractDocument(key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
      items.push({ name, key, size: file.size });
    }
    return NextResponse.json({ items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
