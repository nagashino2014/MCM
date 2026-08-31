// HWPX → PDF 변환 — 문서 변환 서비스(converter, LibreOffice 컨테이너) 호출.
// 계약서 PDF 는 pdf-lib 직접 렌더가 아니라 HWPX 원본을 변환한다(2026-08-11 사용자 확정:
// 발주처 송부는 HWPX 이므로 PDF 는 같은 원본의 변환본이어야 함. 직접 렌더는 폴백 전용).
// 호출 패턴은 전자결재 첨부 미리보기(app/api/approval/docs/…/attachments)와 동일 —
// alpine(musl) DNS 이슈 대응 resolveServiceUrl 포함.

import { resolve4 } from "node:dns/promises";

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

/** 오피스 문서 바이트 → PDF 바이트. converter 미설정·실패 시 null(호출부가 폴백). */
export async function convertOfficeToPdf(bytes: Uint8Array, name: string, mime: string): Promise<Uint8Array | null> {
  const converterUrl = (process.env.MCM_CONVERTER_URL || "").trim().replace(/\/$/, "");
  if (!converterUrl) return null;
  try {
    const target = await resolveServiceUrl(converterUrl);
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(bytes)], { type: mime }), name);
    const res = await fetch(`${target}/convert/pdf`, { method: "POST", body: form });
    if (!res.ok) {
      console.warn(`[convert] converter 변환 실패(HTTP ${res.status}) — 폴백`);
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause;
    console.warn(`[convert] converter 연결 실패(${cause?.code ?? (err as Error).message}) — 폴백`);
    return null;
  }
}

/** HWPX 바이트 → PDF 바이트. converter 미설정·실패 시 null(호출부가 pdf-lib 폴백). */
export async function convertHwpxToPdf(hwpxBytes: Uint8Array, name: string): Promise<Uint8Array | null> {
  return convertOfficeToPdf(hwpxBytes, name, "application/vnd.hancom.hwpx");
}

/**
 * 웹 페이지 URL → PDF 캡처(converter 의 headless Chromium, 바로빌 계산서 인쇄 화면 전용).
 * converter 미설정·실패 시 null(호출부가 폴백).
 */
export async function renderUrlToPdf(url: string): Promise<Uint8Array | null> {
  const converterUrl = (process.env.MCM_CONVERTER_URL || "").trim().replace(/\/$/, "");
  if (!converterUrl) return null;
  try {
    const target = await resolveServiceUrl(converterUrl);
    const res = await fetch(`${target}/render/url-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[convert] URL 캡처 실패(HTTP ${res.status}) — 폴백`, detail.slice(0, 300));
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause;
    console.warn(`[convert] converter 연결 실패(${cause?.code ?? (err as Error).message}) — 폴백`);
    return null;
  }
}
