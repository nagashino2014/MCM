import { resolve4 } from "node:dns/promises";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDoc } from "@/lib/approval/docs";
import { resolveDocAccess } from "@/lib/approval/access";
import { attachmentContentType, attachmentPreviewKind, type DocAttachment } from "@/lib/approval/attachments";
import { putContractDocument, readContractDocument } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** 변환 PDF 캐시 키 — 원본 옆에 같은 이름으로 둔다(첨부가 지워지면 함께 정리 대상). */
const previewKey = (key: string) => `${key}.preview.pdf`;

/**
 * GET: 문서 첨부 1건 — 결재자가 뷰어에서 내용을 확인하기 위한 경로.
 *  - mode=raw(기본)  : 원본 그대로(inline). pdf·이미지는 브라우저가 바로 렌더한다.
 *  - mode=pdf        : 오피스·hwpx 를 PDF 로 변환해 반환(백엔드 LibreOffice). 결과는 S3 에 캐시.
 *  - download=1      : 첨부로 내려받기(Content-Disposition attachment)
 * 열람 권한은 문서 상세와 동일 규칙(resolveDocAccess).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ docId: string; index: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { docId, index } = await params;
    const doc = await getDoc(docId);
    if (!doc) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    const { allowed } = await resolveDocAccess(doc, ctx.userId);
    if (!allowed) return NextResponse.json({ error: "이 문서를 열람할 권한이 없습니다." }, { status: 403 });

    const list = (doc.fieldValues?.file_attachments ?? []) as DocAttachment[];
    const item = Array.isArray(list) ? list[Number(index)] : undefined;
    if (!item?.key) return NextResponse.json({ error: "첨부를 찾을 수 없습니다." }, { status: 404 });

    const mode = req.nextUrl.searchParams.get("mode") ?? "raw";
    const download = req.nextUrl.searchParams.get("download") === "1";
    const filenameStar = `filename*=UTF-8''${encodeURIComponent(item.name)}`;

    if (mode === "pdf" && attachmentPreviewKind(item.name) === "convert") {
      const cached = await readContractDocument(previewKey(item.key));
      if (cached) return pdfResponse(cached, item.name, download);
      const source = await readContractDocument(item.key);
      if (!source) return NextResponse.json({ error: "첨부 원본을 읽을 수 없습니다." }, { status: 404 });
      const converted = await convertToPdf(source, item.name);
      if (!converted.ok) return NextResponse.json({ error: converted.error }, { status: converted.status });
      // 캐시 저장 실패는 무시 — 다음 조회에서 다시 변환하면 된다.
      await putContractDocument(previewKey(item.key), converted.pdf, "application/pdf").catch(() => {});
      return pdfResponse(converted.pdf, item.name, download);
    }

    const body = await readContractDocument(item.key);
    if (!body) return NextResponse.json({ error: "첨부 원본을 읽을 수 없습니다." }, { status: 404 });
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": attachmentContentType(item.name),
        "Content-Length": String(body.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; ${filenameStar}`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function pdfResponse(pdf: Buffer, name: string, download: boolean): NextResponse {
  const pdfName = name.replace(/\.[^.]+$/, "") + ".pdf";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(pdfName)}`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

/**
 * 문서 변환 서비스(converter) 호출 — LibreOffice 전용 경량 컨테이너.
 * OCR 백엔드는 비용 절감으로 상시 가동하지 않으므로 변환은 별도 서비스로 분리돼 있다.
 * 미설정·연결 실패는 503 으로 구분해 뷰어가 "내려받아 확인" 으로 안내하게 한다.
 */
async function convertToPdf(
  source: Buffer,
  name: string
): Promise<{ ok: true; pdf: Buffer } | { ok: false; error: string; status: number }> {
  const converterUrl = (process.env.MCM_CONVERTER_URL || "").trim().replace(/\/$/, "");
  if (!converterUrl) {
    return { ok: false, error: "문서 변환 서버가 설정되지 않아 미리보기를 만들 수 없습니다. 내려받아 확인해 주세요.", status: 503 };
  }
  try {
    const target = await resolveServiceUrl(converterUrl);
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(source)], { type: attachmentContentType(name) }), name);
    const res = await fetch(`${target}/convert/pdf`, { method: "POST", body: form });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      const message = (detail as { detail?: string } | null)?.detail ?? `변환 실패(HTTP ${res.status})`;
      return { ok: false, error: message, status: res.status === 503 ? 503 : 422 };
    }
    return { ok: true, pdf: Buffer.from(await res.arrayBuffer()) };
  } catch (err) {
    // 원인 코드(ENOTFOUND/ECONNREFUSED/ETIMEDOUT)는 fetch 의 message 에 안 실린다 — cause 까지 남긴다.
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const detail = [(err as Error).message, cause?.code, cause?.message].filter(Boolean).join(" / ");
    console.error("[approval/attachments] converter 호출 실패:", converterUrl, detail);
    return { ok: false, error: `문서 변환 서버에 연결하지 못했습니다. (${detail})`, status: 503 };
  }
}

/**
 * 서비스 URL 의 호스트명을 IP 로 미리 바꾼다.
 * next 이미지는 alpine(musl) 이라 getaddrinfo 가 CloudMap 의 `*.local` 이름을 풀지 못하는
 * 경우가 있다(fetch 는 "fetch failed" 만 남기고 실패). c-ares 기반 dns.resolve4 는 같은
 * resolv.conf 를 쓰면서도 이 경로를 타지 않으므로, 해석되면 IP 로 호출하고 실패하면 원래
 * 이름을 그대로 쓴다(해석 성공 환경에서는 동작이 바뀌지 않는다).
 */
async function resolveServiceUrl(url: string): Promise<string> {
  try {
    const u = new URL(url);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname) || u.hostname === "localhost") return url;
    const [ip] = await resolve4(u.hostname);
    if (!ip) return url;
    u.hostname = ip;
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}
