import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { convertToPdf, pdfResponse, previewKey } from "@/lib/approval/attachment-preview";
import { MAIL_PREVIEW_IMAGE_TYPES, mailAttachmentExt, mailAttachmentPreviewKind } from "@/lib/mail/attachment-preview-kind";
import { getAttachmentForUser } from "@/lib/mail/messages";
import { putContractDocument, readContractDocument } from "@/lib/storage/contract-document-storage";
import { getS3Client } from "@/lib/storage/logo-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 오피스·한글 변환(preview=pdf)은 수십 초 걸릴 수 있다 — 결재 첨부 미리보기와 같은 한도.
export const maxDuration = 180;

/** 글자 미리보기 상한 — 넘으면 앞부분만 보여 주고 X-Preview-Truncated 로 알린다. */
const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;

/**
 * 글자 파일 디코딩 — UTF-8 이 아니면 국내 메일에 흔한 EUC-KR(CP949)로 읽는다.
 * stream: true 는 상한에서 잘린 마지막 글자(불완전한 UTF-8 바이트)를 오류로 보지 않게 한다.
 */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
  } catch {
    try {
      return new TextDecoder("euc-kr").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

// GET ?id=<attachmentId> : 메일 첨부 다운로드(소유권 검증 후 app_data 버킷에서 스트리밍).
//   &preview=raw  : 내려받지 않고 화면에 표시(이미지·PDF 만, 형식은 확장자로 고정)
//   &preview=pdf  : 한글·오피스 첨부를 문서 변환 서비스로 PDF 로 바꿔 표시(S3 `{원본key}.preview.pdf` 캐시)
//   &preview=text : txt·csv·html 등을 UTF-8 글자로(html 은 화면이 sandbox iframe 에 그린다)
// 미리보기도 같은 getAttachmentForUser 소유권 검증을 거친다(남의 메일 첨부는 404).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const id = String(req.nextUrl.searchParams.get("id") ?? "");
    if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    const att = await getAttachmentForUser(ctx.userId, id);
    if (!att) return NextResponse.json({ error: "첨부를 찾을 수 없습니다." }, { status: 404 });

    const preview = req.nextUrl.searchParams.get("preview");
    if (preview) return previewResponse(att, preview);

    const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
    if (!bucket) return NextResponse.json({ error: "스토리지 미설정" }, { status: 500 });
    const out = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: att.s3Key }));
    const body = out.Body as unknown as ReadableStream<Uint8Array> | undefined;
    if (!body) return NextResponse.json({ error: "본문 없음" }, { status: 404 });

    const filenameStar = `UTF-8''${encodeURIComponent(att.filename)}`;
    return new NextResponse(body, {
      headers: {
        "Content-Type": att.contentType || out.ContentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=${filenameStar}`,
        ...(typeof out.ContentLength === "number" ? { "Content-Length": String(out.ContentLength) } : {}),
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

async function previewResponse(att: { filename: string; s3Key: string }, preview: string): Promise<NextResponse> {
  const kind = mailAttachmentPreviewKind(att.filename);
  const unsupported = () =>
    NextResponse.json({ error: "미리보기를 지원하지 않는 형식입니다. 내려받아 확인해 주세요." }, { status: 415 });
  const filenameStar = `filename*=UTF-8''${encodeURIComponent(att.filename)}`;

  if (preview === "pdf") {
    if (kind !== "convert") return unsupported();
    const cached = await readContractDocument(previewKey(att.s3Key));
    if (cached) return pdfResponse(cached, att.filename, false);
    const source = await readContractDocument(att.s3Key);
    if (!source) return NextResponse.json({ error: "첨부 원본을 읽을 수 없습니다." }, { status: 404 });
    const converted = await convertToPdf(source, att.filename);
    if (!converted.ok) return NextResponse.json({ error: converted.error }, { status: converted.status });
    // 캐시 저장 실패는 무시 — 다음 조회에서 다시 변환하면 된다.
    await putContractDocument(previewKey(att.s3Key), converted.pdf, "application/pdf").catch(() => {});
    return pdfResponse(converted.pdf, att.filename, false);
  }

  if (preview === "raw") {
    if (kind !== "image" && kind !== "pdf") return unsupported();
    const body = await readContractDocument(att.s3Key);
    if (!body) return NextResponse.json({ error: "첨부 원본을 읽을 수 없습니다." }, { status: 404 });
    const type = kind === "pdf" ? "application/pdf" : MAIL_PREVIEW_IMAGE_TYPES[mailAttachmentExt(att.filename)];
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": type,
        "Content-Length": String(body.length),
        "Content-Disposition": `inline; ${filenameStar}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (preview === "text") {
    if (kind !== "text" && kind !== "html") return unsupported();
    const body = await readContractDocument(att.s3Key);
    if (!body) return NextResponse.json({ error: "첨부 원본을 읽을 수 없습니다." }, { status: 404 });
    const truncated = body.length > TEXT_PREVIEW_MAX_BYTES;
    const text = decodeText(truncated ? body.subarray(0, TEXT_PREVIEW_MAX_BYTES) : body);
    // 항상 text/plain 으로 내려 이 주소를 직접 열어도 html 이 앱 도메인에서 실행되지 않게 한다.
    return new NextResponse(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `inline; ${filenameStar}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        ...(truncated ? { "X-Preview-Truncated": "1" } : {}),
      },
    });
  }

  return NextResponse.json({ error: "preview 값이 올바르지 않습니다." }, { status: 400 });
}
