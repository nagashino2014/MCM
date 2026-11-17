/*
 * 회사소개서 PPT 받기(사용자 요청 2026-11-17) — 생성본·발행본 PDF 로 PPTX 를 만든다. 서버 전용.
 *   그림형: PDF 쪽마다 그림 한 장(쪽 크기 슬라이드). 글은 고칠 수 없지만 PDF 와 똑같다.
 *   갑지 편집형: 첫 슬라이드 = 표지. converter 로 표지 한 쪽만 다시 그리며(pptx-measure.ts) 글자 줄을 재고 글 없는 바탕을 캡처해,
 *     바탕 그림(잠금) 위에 같은 자리·서체·굵기·크기·색·자간의 글상자를 놓는다. PDF 의 표지 그림은 바로 뒤에 숨긴 슬라이드로 둔다.
 *   표지는 지금 데이터·지금 편집본으로 다시 그리므로 오래된 발행본이면 글이 PDF 와 다를 수 있다(받기 창에 안내).
 * 잰 글자 줄 → 글상자 계산은 pptx-layout.ts(순수 함수).
 */
import { readFile } from "node:fs/promises";
import { MASTER_DOC_ID } from "@/lib/catalog/projects";
import { loadStudioDoc } from "@/lib/catalog/studio/store";
import { PRINT_ORIGIN, renderHtmlPdf, type PrintAsset } from "@/lib/print-kit/converter";
import { rasterizePdf, toJpeg } from "@/lib/print-kit/pdf-raster";
import { buildPptx, type PptxPicture, type PptxSlide } from "@/lib/print-kit/pptx";
import { loadCatalogRenderData } from "./data";
import { getCatalogEditionFile, type CatalogEditionSummary } from "./editions";
import { buildCatalogHtml } from "./html";
import { measuredToTextBoxes } from "./pptx-layout";
import { PPTX_MEASURE_SCRIPT, PPTX_TEXT_KIND, type MeasuredSheet } from "./pptx-measure";
import type { RenderOptions } from "./types";

/** 잰 그림(로고 등) → 슬라이드 그림. 자산을 PNG 로 다시 써서(webp·svg 도 PowerPoint 가 열도록) 따로 옮길 수 있게 넣는다 */
export async function measuredToPictures(sheet: MeasuredSheet, slideW: number, slideH: number, assets: PrintAsset[]): Promise<PptxPicture[]> {
  const kx = slideW / (sheet.width || 842);
  const ky = slideH / (sheet.height || 595);
  const byPath = new Map(assets.map((a) => [a.path, a]));
  const canvas = await import("@napi-rs/canvas");
  const out: PptxPicture[] = [];
  for (const p of sheet.pictures ?? []) {
    const path = p.src.startsWith(PRINT_ORIGIN) ? decodeURIComponent(p.src.slice(PRINT_ORIGIN.length)) : "";
    const asset = byPath.get(path);
    if (!asset) continue;
    try {
      const img = await canvas.loadImage(asset.data);
      const c = canvas.createCanvas(img.width, img.height);
      c.getContext("2d").drawImage(img, 0, 0);
      out.push({ x: p.left * kx, y: p.top * ky, w: p.width * kx, h: p.height * ky, data: c.toBuffer("image/png"), type: "png", name: p.alt ? p.alt.slice(0, 40) : "그림", descr: p.alt });
    } catch {
      // 읽지 못한 그림은 건너뛴다(바탕에서는 이미 감춰져 빈자리) — 아래 호출부가 바탕을 다시 쓰지 않으므로 드물게 빈칸이 생길 수 있다
    }
  }
  return out;
}

/** 표지 한 쪽을 converter 로 다시 그려 글자 줄 측정값과 글 없는 바탕 PNG 를 받는다. 표지가 없으면(숨김) null */
export async function renderCoverForPptx(
  opts: RenderOptions,
  docId = MASTER_DOC_ID
): Promise<{ sheet: MeasuredSheet; background: Buffer; assets: PrintAsset[] } | null> {
  const [data, studio] = await Promise.all([loadCatalogRenderData({ ...opts, docId }), loadStudioDoc(docId)]);
  const built = await buildCatalogHtml(data, { ...opts, target: "print", pages: studio?.pages ?? [], onlyTypes: ["C01"], extraScript: PPTX_MEASURE_SCRIPT });
  if (!/class="[^"]*pk-sheet/.test(built.html)) return null;
  const rendered = await renderHtmlPdf({ html: built.html, assets: built.assets, png: true, pngScale: 3 });
  const hit = rendered.warnings.find((w) => w.kind === PPTX_TEXT_KIND);
  if (!hit || !rendered.pngs[0]) throw new Error("표지 글자를 재지 못했습니다.");
  const sheet = JSON.parse(hit.message) as MeasuredSheet & { error?: string };
  if (sheet.error || !Array.isArray(sheet.lines)) throw new Error(`표지 글자를 재지 못했습니다: ${sheet.error ?? "형식 오류"}`);
  return { sheet, background: rendered.pngs[0], assets: built.assets };
}

export interface CatalogPptx {
  data: Buffer;
  fileName: string;
  slides: number;
  /** 갑지 편집형 표지를 넣지 못한 이유(그림형만 들어감) */
  coverNotice: string | null;
}

/** 생성본·발행본 → PPTX(첫 슬라이드 갑지 편집형 + 쪽 그림, PDF 표지 그림은 숨긴 슬라이드) */
export async function buildCatalogPptx(summary: CatalogEditionSummary, pdf: Buffer): Promise<CatalogPptx> {
  const pages = await rasterizePdf(pdf, { scale: 2.5, quality: 88 });
  if (!pages.length) throw Object.assign(new Error("PDF 에 쪽이 없습니다."), { status: 422 });
  const slideW = pages[0].width;
  const slideH = pages[0].height;
  const full = (p: (typeof pages)[number], hidden = false, title?: string): PptxSlide => ({
    hidden,
    title,
    pictures: [{ x: 0, y: 0, w: slideW, h: slideH, data: p.data, type: p.type, name: title ?? `${p.pageNumber}쪽`, descr: `${p.pageNumber}쪽` }],
  });

  let coverSlide: PptxSlide | null = null;
  let coverNotice: string | null = null;
  try {
    const cover = await renderCoverForPptx({ edition: summary.edition, naming: summary.naming, scope: summary.scope }, summary.docId);
    if (cover) {
      const bg = await toJpeg(cover.background, 92);
      coverSlide = {
        title: "표지(편집)",
        pictures: [
          { x: 0, y: 0, w: slideW, h: slideH, data: bg.data, type: "jpeg", name: "표지 바탕(글 없음)", locked: true },
          ...(await measuredToPictures(cover.sheet, slideW, slideH, cover.assets)),
        ],
        texts: measuredToTextBoxes(cover.sheet, slideW, slideH),
      };
    } else coverNotice = "편집본에서 표지를 숨겨 갑지 편집형 슬라이드를 넣지 않았습니다.";
  } catch (e) {
    coverNotice = `표지를 글상자로 바꾸지 못해 그림으로만 넣었습니다(${(e as Error).message}).`;
  }

  const slides: PptxSlide[] = coverSlide
    ? [coverSlide, full(pages[0], true, "표지(그림·숨김)"), ...pages.slice(1).map((p) => full(p))]
    : pages.map((p) => full(p));
  const data = await buildPptx({ width: slideW, height: slideH, title: summary.fileName.replace(/\.pdf$/i, ""), author: "MCM", slides });
  const fileName = (summary.fileName || `${summary.editionId}.pdf`).replace(/\.pdf$/i, "") + ".pptx";
  return { data, fileName, slides: slides.length, coverNotice };
}

// ── 메모리 안전장치(2026-11-17 next 작업 1GB 가 PPT 만들기 중 메모리 부족으로 죽어 502) ──
//   쪽 그림은 캔버스 하나를 다시 써도 pdfjs 캐시·글꼴 경로로 약 350MB 를 더 쓴다(54쪽 실측). 평소 next 는 1GB 의 55~60% 를 쓴다.
//   모자라면 작업을 죽이지 않고 503 으로 돌려보내고, 한 번에 하나만 만든다.
/** PPT 만들기에 더 쓰는 메모리 — 실측 고점 약 350MB + 표지 바탕·PPTX 묶기 여유 */
export const PPTX_MEMORY_NEED = 450 * 1024 * 1024;
let pptxRunning = false;

/** 작업(컨테이너) 메모리 한도 — cgroup v2·v1 순. 읽지 못하면 null(검사 생략) */
async function containerMemoryLimit(): Promise<number | null> {
  for (const path of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const v = Number((await readFile(path, "utf8")).trim());
      if (Number.isFinite(v) && v > 0 && v < 2 ** 50) return v;
    } catch {
      // 없는 경로·"max" → 다음 후보
    }
  }
  return null;
}

/** 생성본·발행본 id → PPTX(없으면 null). 다른 PPT 를 만드는 중이면 429, 메모리가 모자라면 503 */
export async function buildCatalogPptxForEdition(editionId: string): Promise<(CatalogPptx & { summary: CatalogEditionSummary }) | null> {
  if (pptxRunning) throw Object.assign(new Error("다른 PPT 를 만드는 중입니다. 1분쯤 뒤에 다시 받으세요."), { status: 429 });
  const limit = await containerMemoryLimit();
  if (limit && process.memoryUsage().rss + PPTX_MEMORY_NEED > limit * 0.95) {
    throw Object.assign(new Error("서버 메모리가 모자라 지금은 PPT 를 만들 수 없습니다. 잠시 뒤 다시 받거나 PDF 를 받으세요(관리자: next 작업 메모리 확인)."), { status: 503 });
  }
  pptxRunning = true;
  try {
    const hit = await getCatalogEditionFile(editionId);
    if (!hit) return null;
    return { ...(await buildCatalogPptx(hit.summary, hit.pdf)), summary: hit.summary };
  } finally {
    pptxRunning = false;
  }
}
