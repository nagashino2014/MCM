/*
 * PDF 쪽 → 그림(JPEG·PNG) — 서버 전용. 회사소개서 그림형 PPT(사용자 요청 2026-11-17)용.
 *   pdfjs(legacy, Node) + @napi-rs/canvas. 글꼴은 PDF 에 심은 것을 경로로 그린다(시스템 글꼴 안 씀).
 *   표준 글꼴·문자표(cmaps)는 pdfjs-dist 패키지 안 파일을 fs 로 읽는다 — lib/finance/supply-group-pdf.ts 와 같은 방식
 *   (Webpack 이 require.resolve 를 모듈 id 로 바꾸지 않게 createRequire 를 Reflect 로 꺼내 쓴다).
 */
import { readFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import { dirname, isAbsolute, join } from "node:path";

export interface RasterPage {
  /** 1부터 */
  pageNumber: number;
  /** 쪽 크기(pt) */
  width: number;
  height: number;
  data: Buffer;
  type: "jpeg" | "png";
}

export interface RasterOptions {
  /** 1pt 당 화소(기본 2.5 ≈ 180dpi) */
  scale?: number;
  format?: "jpeg" | "png";
  /** JPEG 품질 0~100(기본 88) */
  quality?: number;
  /** 쪽마다 불러 준다(진행 기록용) */
  onPage?: (pageNumber: number, total: number) => void;
}

function pdfjsAssetPath(): string {
  const nativeResolve = (filename: string) => {
    const createNativeRequire = Reflect.get(nodeModule, "createRequire") as typeof nodeModule.createRequire;
    const localRequire = createNativeRequire(filename);
    const resolvePackage = Reflect.get(localRequire, "resolve") as (name: string) => string;
    return resolvePackage("pdfjs-dist/package.json");
  };
  try {
    return dirname(nativeResolve(typeof __filename === "string" && isAbsolute(__filename) ? __filename : join(process.cwd(), "package.json")));
  } catch {
    return dirname(nativeResolve(join(process.cwd(), "package.json")));
  }
}

/** PDF 의 모든 쪽을 그림으로 — 쪽 순서대로 */
export async function rasterizePdf(bytes: Uint8Array, opts: RasterOptions = {}): Promise<RasterPage[]> {
  const scale = opts.scale ?? 2.5;
  const format = opts.format ?? "jpeg";
  const quality = opts.quality ?? 88;
  const unpdf = await import("unpdf");
  const canvas = await import("@napi-rs/canvas");
  const CanvasFactory = await unpdf.createIsomorphicCanvasFactory(async () => canvas);
  const assetPath = pdfjsAssetPath();
  class LocalBinaryDataFactory {
    async fetch({ kind, filename }: { kind: string; filename: string }) {
      const dir = ({ standardFontDataUrl: "standard_fonts", cMapUrl: "cmaps" } as Record<string, string>)[kind];
      if (!dir || typeof filename !== "string" || !/^[A-Za-z0-9_.-]+$/.test(filename)) throw Error("Unsupported PDF asset");
      return new Uint8Array(await readFile(join(assetPath, dir, filename)));
    }
  }
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({
    data: Uint8Array.from(bytes),
    CanvasFactory,
    BinaryDataFactory: LocalBinaryDataFactory,
    isEvalSupported: false,
    useSystemFonts: false,
    useWorkerFetch: false,
    useWasm: false,
    standardFontDataUrl: join(assetPath, "standard_fonts").replaceAll("\\", "/") + "/",
    cMapUrl: join(assetPath, "cmaps").replaceAll("\\", "/") + "/",
    cMapPacked: true,
  } as Parameters<typeof getDocument>[0]).promise;
  try {
    const out: RasterPage[] = [];
    // 캔버스 하나를 모든 쪽에 다시 쓴다 — 쪽마다 새로 만들면 네이티브 메모리(쪽당 약 12MB)가 GC 전에 쌓여
    // next 작업(1GB)이 메모리 부족으로 죽었다(2026-11-17 502). 쪽 크기가 다를 때만 크기를 바꾼다.
    let image: import("@napi-rs/canvas").Canvas | null = null;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale });
      const w = Math.ceil(viewport.width);
      const h = Math.ceil(viewport.height);
      if (!image) image = canvas.createCanvas(w, h);
      else if (image.width !== w || image.height !== h) {
        image.width = w;
        image.height = h;
      }
      const img = image;
      const context = img.getContext("2d");
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, w, h);
      await page.render({ canvas: img as never, canvasContext: context as never, viewport, background: "rgb(255,255,255)" } as never).promise;
      const data = format === "png" ? img.toBuffer("image/png") : img.toBuffer("image/jpeg", quality);
      out.push({ pageNumber: i, width: base.width, height: base.height, data, type: format });
      page.cleanup();
      // 쪽 그림(이미지 해독본)·글꼴 캐시를 8쪽마다 비운다 — 쪽마다 비우면 글꼴을 다시 읽느라 고점이 오히려 오른다(실측 357MB → 609MB)
      if (i % 8 === 0) await pdf.cleanup();
      opts.onPage?.(i, pdf.numPages);
    }
    return out;
  } finally {
    await pdf.destroy();
  }
}

/** 그림(PNG 등) → JPEG — 큰 바탕 그림을 PPT 에 가볍게 넣는다 */
export async function toJpeg(data: Buffer, quality = 90): Promise<{ data: Buffer; width: number; height: number }> {
  const canvas = await import("@napi-rs/canvas");
  const img = await canvas.loadImage(data);
  const c = canvas.createCanvas(img.width, img.height);
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, img.width, img.height);
  g.drawImage(img, 0, 0);
  return { data: c.toBuffer("image/jpeg", quality), width: img.width, height: img.height };
}
