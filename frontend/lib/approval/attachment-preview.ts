// 첨부 미리보기 공용 — 문서 뷰어(docId 경로)와 기안 화면(key 경로)이 같은 로직을 쓴다.
// pdf·이미지는 원본 그대로, hwpx·docx·xlsx·pptx 는 converter 컨테이너(LibreOffice)로 변환한다.
// 원래 app/api/approval/docs/[docId]/attachments/[index]/route.ts 안에 있던 것을 그대로 옮겼다.

import { resolve4 } from "node:dns/promises";
import { NextResponse } from "next/server";
import { attachmentContentType } from "@/lib/approval/attachments";

/** 변환 PDF 캐시 키 — 원본 옆에 같은 이름으로 둔다(첨부가 지워지면 함께 정리 대상). */
export const previewKey = (key: string) => `${key}.preview.pdf`;

export function pdfResponse(pdf: Buffer, name: string, download: boolean): NextResponse {
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

/** 원본 그대로 반환(inline/attachment) — pdf·이미지는 브라우저가 바로 렌더한다. */
export function rawResponse(body: Buffer, name: string, download: boolean): NextResponse {
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": attachmentContentType(name),
      "Content-Length": String(body.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

/**
 * 문서 변환 서비스(converter) 호출 — LibreOffice 전용 경량 컨테이너.
 * OCR 백엔드는 비용 절감으로 상시 가동하지 않으므로 변환은 별도 서비스로 분리돼 있다.
 * 미설정·연결 실패는 503 으로 구분해 뷰어가 "내려받아 확인" 으로 안내하게 한다.
 */
export async function convertToPdf(
  source: Buffer,
  name: string,
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
