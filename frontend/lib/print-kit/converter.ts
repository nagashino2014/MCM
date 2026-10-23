import { resolve4 } from "node:dns/promises";

/*
 * converter POST /render/html-pdf 호출(서버 전용) — 블루프린트 §9.
 * HTML 과 그 HTML 이 가리키는 자산(이미지·업로드 서체)을 함께 보낸다. converter 는 https://print.local/ 을 문서 주소로 열고
 * 자산·기본 서체는 page.route 로 직접 응답하며, 그 밖의 네트워크 요청은 모두 막는다.
 */

/** converter 가 문서·자산을 응답하는 내부 주소(외부로 나가지 않는다) */
export const PRINT_ORIGIN = "https://print.local/";

export interface PrintAsset {
  /** PRINT_ORIGIN 기준 경로(예: "a/cas_123", "k/assets/logo.png") */
  path: string;
  contentType: string;
  data: Buffer;
}

export interface HtmlPdfRequest {
  html: string;
  assets: PrintAsset[];
  /** 쪽마다 PNG(검토용) */
  png?: boolean;
  pngScale?: number;
  timeoutMs?: number;
}

export interface PrintWarning {
  kind: string;
  page: number;
  anchor: string;
  message: string;
  text?: string;
}

export interface HtmlPdfResult {
  pdf: Buffer;
  pages: number;
  anchors: Record<string, [number, number]>;
  warnings: PrintWarning[];
  pngs: Buffer[];
  /** converter 안에서 걸린 시간(ms) */
  renderMs: number;
}

export class ConverterError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** next(alpine/musl)는 CloudMap `*.local` 이름을 getaddrinfo 로 못 푸는 경우가 있어 c-ares(resolve4)로 먼저 IP 를 얻는다. */
async function resolveServiceUrl(url: string): Promise<string> {
  try {
    const u = new URL(url);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname) || u.hostname === "localhost") return url.replace(/\/$/, "");
    const [ip] = await resolve4(u.hostname);
    if (!ip) return url.replace(/\/$/, "");
    u.hostname = ip;
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/\/$/, "");
  }
}

export async function renderHtmlPdf(req: HtmlPdfRequest): Promise<HtmlPdfResult> {
  const base = process.env.MCM_CONVERTER_URL?.trim();
  if (!base) throw new ConverterError("문서 변환 서버 주소(MCM_CONVERTER_URL)가 설정되어 있지 않습니다.", 503);
  const target = await resolveServiceUrl(base);
  const body = JSON.stringify({
    html: req.html,
    assets: req.assets.map((a) => ({ path: a.path, content_type: a.contentType, data_b64: a.data.toString("base64") })),
    png: Boolean(req.png),
    png_scale: req.pngScale ?? 1.5,
    timeout_ms: req.timeoutMs ?? 90_000,
  });
  let res: Response;
  try {
    res = await fetch(`${target}/render/html-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout((req.timeoutMs ?? 90_000) + 30_000),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const detail = [(err as Error).message, cause?.code, cause?.message].filter(Boolean).join(" / ");
    console.error("[print-kit] converter 호출 실패:", base, detail);
    throw new ConverterError(`문서 변환 서버에 연결하지 못했습니다. (${detail})`, 503);
  }
  const data = (await res.json().catch(() => null)) as
    | { detail?: string; pdf_b64?: string; pages?: number; anchors?: Record<string, [number, number]>; warnings?: PrintWarning[]; pngs_b64?: string[]; render_ms?: number }
    | null;
  if (!res.ok || !data?.pdf_b64) {
    throw new ConverterError(data?.detail ?? `PDF 변환 실패(HTTP ${res.status})`, res.status === 503 ? 503 : 422);
  }
  return {
    pdf: Buffer.from(data.pdf_b64, "base64"),
    pages: Number(data.pages ?? 0),
    anchors: data.anchors ?? {},
    warnings: data.warnings ?? [],
    pngs: (data.pngs_b64 ?? []).map((b) => Buffer.from(b, "base64")),
    renderMs: Number(data.render_ms ?? 0),
  };
}

export interface PreparedFont {
  outline: "truetype" | "cff" | "cff2";
  converted: boolean;
  variable: boolean;
  files: Array<{ weight: number; data: Buffer; bytes: number; glyphs: number }>;
  ms: number;
}

/**
 * converter POST /fonts/prepare — 업로드 서체를 정적 TrueType 윤곽 WOFF 로(회사소개서 서체 라이브러리 P5b).
 * CFF 윤곽은 2차 곡선으로, 가변 서체는 weights 굵기로 고정한다(Chromium PDF 가 둘 다 Type 3 으로 넣기 때문). 한글 가변 서체는 수십 초 걸린다.
 */
export async function prepareFont(data: Buffer, weights: number[] = [], timeoutMs = 180_000): Promise<PreparedFont> {
  const base = process.env.MCM_CONVERTER_URL?.trim();
  if (!base) throw new ConverterError("문서 변환 서버 주소(MCM_CONVERTER_URL)가 설정되어 있지 않습니다.", 503);
  const target = await resolveServiceUrl(base);
  let res: Response;
  try {
    res = await fetch(`${target}/fonts/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data_b64: data.toString("base64"), weights }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const detail = [(err as Error).message, cause?.code, cause?.message].filter(Boolean).join(" / ");
    console.error("[print-kit] converter 서체 변환 호출 실패:", base, detail);
    throw new ConverterError(`문서 변환 서버에 연결하지 못했습니다. (${detail})`, 503);
  }
  const body = (await res.json().catch(() => null)) as
    | { detail?: string; outline?: PreparedFont["outline"]; converted?: boolean; variable?: boolean; files?: Array<{ weight: number; data_b64: string; bytes: number; glyphs: number }>; ms?: number }
    | null;
  if (!res.ok || !body?.files?.length) {
    // 옛 converter(엔드포인트 없음)는 404 — 재배포가 필요하다
    if (res.status === 404) throw new ConverterError("문서 변환 서버에 서체 변환 기능이 없습니다(converter 재배포 필요).", 503);
    throw new ConverterError(body?.detail ?? `서체 변환 실패(HTTP ${res.status})`, res.status === 503 ? 503 : 422);
  }
  return {
    outline: body.outline ?? "truetype",
    converted: Boolean(body.converted),
    variable: Boolean(body.variable),
    files: body.files.map((f) => ({ weight: Number(f.weight), data: Buffer.from(f.data_b64, "base64"), bytes: Number(f.bytes), glyphs: Number(f.glyphs) })),
    ms: Number(body.ms ?? 0),
  };
}
