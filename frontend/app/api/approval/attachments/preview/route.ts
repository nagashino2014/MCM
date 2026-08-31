import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { attachmentContentType, attachmentPreviewKind } from "@/lib/approval/attachments";
import { convertToPdf, pdfResponse, previewKey } from "@/lib/approval/attachment-preview";
import { putContractDocument, readContractDocument } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * GET: 작성 중 첨부 1건 미리보기(2026-08-25) — 아직 문서(doc)로 상신되기 전이라 docId 가 없는
 * 공문·기안 작성 화면의 첨부 목록에서 내용을 확인하기 위한 key 기반 경로.
 *  - key       : S3 저장 키(작성 화면 첨부에 실리는 출처만 허용 — 아래 화이트리스트)
 *  - name      : 표시·다운로드 파일명(생략 시 key 의 마지막 세그먼트)
 *  - mode=pdf  : 오피스·hwpx 를 PDF 로 변환해 반환(캐시는 결재 문서 뷰어와 공유)
 *  - download=1: 첨부로 내려받기
 */

/** 작성 화면 첨부에 실릴 수 있는 키 출처 — 업로드·대금청구서(산출물)·개인카드 영수증·법인카드 전표. */
const ALLOWED_KEY_PREFIXES = ["approval/attachments/", "approval/card-slips/", "deliverables/", "receipts/"];

export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const key = (req.nextUrl.searchParams.get("key") ?? "").trim();
    if (!key || key.includes("..") || key.startsWith("/") || key.startsWith("\\")) {
      return NextResponse.json({ error: "첨부 키가 올바르지 않습니다." }, { status: 400 });
    }
    if (!ALLOWED_KEY_PREFIXES.some((p) => key.startsWith(p))) {
      return NextResponse.json({ error: "미리보기를 지원하지 않는 저장 위치입니다." }, { status: 400 });
    }

    const name = (req.nextUrl.searchParams.get("name") ?? "").trim() || key.split("/").pop() || "첨부파일";
    const mode = req.nextUrl.searchParams.get("mode") ?? "raw";
    const download = req.nextUrl.searchParams.get("download") === "1";

    if (mode === "pdf" && attachmentPreviewKind(name) === "convert") {
      const cached = await readContractDocument(previewKey(key));
      if (cached) return pdfResponse(cached, name, download);
      const source = await readContractDocument(key);
      if (!source) return NextResponse.json({ error: "첨부 원본을 읽을 수 없습니다." }, { status: 404 });
      const converted = await convertToPdf(source, name);
      if (!converted.ok) return NextResponse.json({ error: converted.error }, { status: converted.status });
      // 캐시 저장 실패는 무시 — 다음 조회에서 다시 변환하면 된다.
      await putContractDocument(previewKey(key), converted.pdf, "application/pdf").catch(() => {});
      return pdfResponse(converted.pdf, name, download);
    }

    const body = await readContractDocument(key);
    if (!body) return NextResponse.json({ error: "첨부 원본을 읽을 수 없습니다." }, { status: 404 });
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": attachmentContentType(name),
        "Content-Length": String(body.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
