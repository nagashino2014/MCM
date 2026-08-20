import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { ATTACHMENT_ALLOWED_TEXT, attachmentContentType, attachmentPreviewKind, isAllowedAttachment } from "@/lib/approval/attachments";
import { putContractDocument, readContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { convertToPdf, pdfResponse, previewKey, rawResponse } from "@/lib/approval/attachment-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 파일 1건 상한 200MB(사용자 확정) — 공문 발송 시 메일 직접 첨부 한도(7MB) 초과분은
 *  다운로드 링크(presigned, 7일)로 자동 전환된다(lib/letter/send.ts). */
const MAX_FILE_BYTES = 200 * 1024 * 1024;

// POST: 전자결재 첨부 업로드(multipart files[]) — 공문·일반 기안 공용.
// S3 approval/attachments/{YYYYMM}/ 에 적재하고 {name,key,size} 목록을 반환한다.
// 결재자가 뷰어에서 내용을 확인할 수 있는 형식만 받는다(구형 hwp·zip 등은 거절).
export async function POST(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (!files.length) return NextResponse.json({ error: "files 가 필요합니다." }, { status: 400 });

    const ym = new Date().toISOString().slice(0, 7).replace("-", "");
    const items: { name: string; key: string; size: number }[] = [];
    for (const file of files) {
      const name = sanitizeFilename(file.name || "첨부파일");
      if (!isAllowedAttachment(name)) {
        return NextResponse.json(
          { error: `${name}: 첨부할 수 없는 형식입니다. 허용 형식 — ${ATTACHMENT_ALLOWED_TEXT}` },
          { status: 400 }
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `${name}: 파일이 200MB 를 초과합니다.` }, { status: 400 });
      }
      const key = `approval/attachments/${ym}/${crypto.randomUUID().slice(0, 8)}_${name}`;
      await putContractDocument(key, Buffer.from(await file.arrayBuffer()), attachmentContentType(name));
      items.push({ name, key, size: file.size });
    }
    return NextResponse.json({ items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/**
 * 아직 문서로 저장되지 않은 첨부(기안 화면)의 미리보기 — 스토리지 key 로 직접 읽는다.
 * 저장된 문서는 docId 경로(`/api/approval/docs/{docId}/attachments/{index}`)를 쓴다.
 * 임의 파일 열람을 막기 위해 **경로 접두어 화이트리스트**로 제한한다 — 결재 첨부, 개인카드
 * 영수증 증빙, 법인카드 전자 전표. 이 셋은 모두 approval.view 권한자가 기안에 담을 수 있는 것들이다.
 */
const READABLE_PREFIXES = ["approval/attachments/", "receipts/", "card-slips/"];

export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const key = req.nextUrl.searchParams.get("key") ?? "";
    if (!key || key.includes("..") || !READABLE_PREFIXES.some((p) => key.startsWith(p))) {
      return NextResponse.json({ error: "열람할 수 없는 경로입니다." }, { status: 400 });
    }
    const name = key.split("/").pop() || "첨부파일";
    const mode = req.nextUrl.searchParams.get("mode") ?? "raw";
    const download = req.nextUrl.searchParams.get("download") === "1";

    if (mode === "pdf" && attachmentPreviewKind(name) === "convert") {
      const cached = await readContractDocument(previewKey(key));
      if (cached) return pdfResponse(cached, name, download);
      const source = await readContractDocument(key);
      if (!source) return NextResponse.json({ error: "첨부 원본을 읽을 수 없습니다." }, { status: 404 });
      const converted = await convertToPdf(source, name);
      if (!converted.ok) return NextResponse.json({ error: converted.error }, { status: converted.status });
      await putContractDocument(previewKey(key), converted.pdf, "application/pdf").catch(() => {});
      return pdfResponse(converted.pdf, name, download);
    }

    const body = await readContractDocument(key);
    if (!body) return NextResponse.json({ error: "첨부 원본을 읽을 수 없습니다." }, { status: 404 });
    return rawResponse(body, name, download);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
