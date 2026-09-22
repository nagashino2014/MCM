import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as nodeModule from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

/** A displayed location, not a tax or authenticity decision. No external URL, password or OCR. */
export interface PdfRegion {
  regionId: string;
  pageNumber: number;
  rect: { x: number; y: number; width: number; height: number };
  role: 'context' | 'detail';
  wholeRefs: { documentId: string; portionId: string; observationId: string }[];
}
export interface PdfPageMetadata { pageNumber: number; width: number; height: number; rotation: number }
export interface PdfMetadata { adapterVersion: string; documentHash: string; pageCount: number; pages: PdfPageMetadata[] }
export interface PdfInspection extends Omit<PdfMetadata, 'pages'> {
  schemaVersion: 'supply-group-pdf-v1';
  pages: (PdfPageMetadata & { renderWidth: number; renderHeight: number; imageHash: string })[];
  regions: {
    regionId: string;
    locator: { kind: 'pdf-region'; coordinateSystem: 'rotated-top-left-normalized-v1'; pageNumber: number; x: number; y: number; width: number; height: number };
    contentHash: string;
    textStatus: 'text' | 'no_text';
    textHash: string;
    previewHash: string;
  }[];
  verificationLevel: 'human_review';
}
export const GROUP_PDF_ADAPTER_VERSION = 'unpdf-1.6.2/pdfjs-5.6.205/pdf-lib-1.17.1/canvas-0.1.97/region-v1';
export const GROUP_PDF_MAX_PAGES = 20;
export const GROUP_PDF_MAX_REGIONS = 64;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 1600;
const sha = (v: Uint8Array | string) => createHash('sha256').update(v).digest('hex');
const fail = (code: string, message: string, status = 400) => Object.assign(new Error(message), { code, status });
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200 && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function exact(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!object(v) || Object.keys(v).sort().join('|') !== [...keys].sort().join('|')) throw fail('pdf_region_invalid', '원문 위치 입력을 확인하세요.');
}
export function validatePdfRegions(value: unknown): PdfRegion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > GROUP_PDF_MAX_REGIONS) throw fail('pdf_region_invalid', `원문 확인 영역은 1~${GROUP_PDF_MAX_REGIONS}개를 선택하세요.`);
  const seen = new Set<string>();
  return value.map(v => {
    exact(v, ['regionId', 'pageNumber', 'rect', 'role', 'wholeRefs']);
    exact(v.rect, ['x', 'y', 'width', 'height']);
    if (!id(v.regionId) || seen.has(v.regionId) || !Number.isSafeInteger(v.pageNumber) || Number(v.pageNumber) < 1 || (v.role !== 'context' && v.role !== 'detail')) throw fail('pdf_region_invalid', '중복되지 않는 원문 위치와 페이지를 선택하세요.');
    seen.add(v.regionId);
    const r = v.rect;
    if (![r.x, r.y, r.width, r.height].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) || Number(r.width) <= 0 || Number(r.height) <= 0 || Number(r.x) + Number(r.width) > 1 || Number(r.y) + Number(r.height) > 1) throw fail('pdf_region_invalid', '페이지 안에 있는 넓이와 높이가 있는 영역을 선택하세요.');
    if (!Array.isArray(v.wholeRefs) || !v.wholeRefs.length || v.wholeRefs.length > 21) throw fail('pdf_region_invalid', '원문 위치에 대응하는 문서를 선택하세요.');
    const refs = new Set<string>();
    for (const ref of v.wholeRefs) {
      exact(ref, ['documentId', 'portionId', 'observationId']);
      const key = String(ref.documentId);
      if (![ref.documentId, ref.portionId, ref.observationId].every(id) || refs.has(key)) throw fail('pdf_region_invalid', '원문 위치의 문서 참조가 올바르지 않습니다.');
      refs.add(key);
    }
    return structuredClone(v) as unknown as PdfRegion;
  });
}

type Proxy = Awaited<ReturnType<typeof import('pdfjs-dist/legacy/build/pdf.mjs')['getDocument']>['promise']>;
const assetFailures = new WeakSet<Proxy>();
async function open(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_BYTES) throw fail('pdf_limit', 'PDF 원문은 비어 있지 않은 10 MiB 이하 파일이어야 합니다.');
  const data = Uint8Array.from(bytes);
  if (!/^%PDF-\d\.\d/.test(Buffer.from(data.subarray(0, 8)).toString('ascii')) || !/%%EOF\s*$/.test(Buffer.from(data.subarray(-1024)).toString('latin1'))) throw fail('pdf_invalid', 'PDF 원문이 손상되었거나 PDF 형식이 아닙니다.');
  let phase: 'document' | 'renderer' | 'parse' = 'document';
  try {
    // Inspect the encryption flag without attempting to decrypt or render encrypted contents.
    const check = await PDFDocument.load(data, { ignoreEncryption: true, throwOnInvalidObject: true, updateMetadata: false });
    if (check.isEncrypted) throw fail('pdf_encrypted', '암호화된 PDF는 이 원문 위치 검토에서 지원하지 않습니다. 암호화되지 않은 원문을 보관하세요.');
    if (check.getPageCount() < 1 || check.getPageCount() > GROUP_PDF_MAX_PAGES) throw fail('pdf_limit', `원문 위치 검토는 1~${GROUP_PDF_MAX_PAGES}페이지 PDF를 지원합니다.`);
    phase = 'renderer';
    const unpdf = await import('unpdf');
    const canvas = await import('@napi-rs/canvas');
    const CanvasFactory = await unpdf.createIsomorphicCanvasFactory(async () => canvas);
    let assetPath: string;
    // Keep native resolution separate from a `.resolve('literal')` call: Webpack
    // otherwise substitutes its `(rsc)/...` module id, which is not an fs path.
    const nativeResolve = (filename: string) => {
      const createNativeRequire = Reflect.get(nodeModule, 'createRequire') as typeof nodeModule.createRequire;
      const localRequire = createNativeRequire(filename);
      const resolvePackage = Reflect.get(localRequire, 'resolve') as (name: string) => string;
      return resolvePackage('pdfjs-dist/package.json');
    };
    try { assetPath = dirname(nativeResolve(typeof __filename === 'string' && isAbsolute(__filename) ? __filename : join(process.cwd(), 'package.json'))); }
    catch { assetPath = dirname(nativeResolve(join(process.cwd(), 'package.json'))); }
    // The Node build reads fs paths, not file: URL strings. The serverless fetch factory
    // cannot read these assets and can silently draw missing glyphs.
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    let resourceFailure = false, loaded: Proxy | undefined;
    class LocalBinaryDataFactory {
      async fetch({ kind, filename }: { kind: string; filename: string }) {
        try {
          const dir = ({ standardFontDataUrl: 'standard_fonts', cMapUrl: 'cmaps' } as Record<string, string>)[kind];
          if (!dir || typeof filename !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(filename) || filename.includes('..')) throw Error('Unsupported PDF asset');
          return new Uint8Array(await readFile(join(assetPath, dir, filename)));
        } catch (e) { resourceFailure = true; if (loaded) assetFailures.add(loaded); throw e; }
      }
    }
    phase = 'parse';
    const pdf = await getDocument({ data: Uint8Array.from(data), CanvasFactory, BinaryDataFactory: LocalBinaryDataFactory, isEvalSupported: false, useSystemFonts: false, useWorkerFetch: false, stopAtErrors: true, useWasm: false,
      standardFontDataUrl: join(assetPath, 'standard_fonts').replaceAll('\\', '/') + '/', cMapUrl: join(assetPath, 'cmaps').replaceAll('\\', '/') + '/', cMapPacked: true }).promise;
    loaded = pdf; if (resourceFailure) assetFailures.add(pdf);
    if (pdf.numPages !== check.getPageCount()) { await pdf.destroy(); throw fail('pdf_invalid', 'PDF 페이지 구조를 일관되게 확인할 수 없습니다.'); }
    return { pdf, canvas, documentHash: sha(data) };
  } catch (error) {
    if ((error as { status?: number }).status) throw error;
    if (/encrypt|password/i.test(String((error as Error)?.name))) throw fail('pdf_encrypted', '암호화된 PDF는 이 원문 위치 검토에서 지원하지 않습니다.');
    if (phase === 'document' || ['InvalidPDFException', 'MissingPDFException', 'UnexpectedResponseException'].includes(String((error as Error)?.name))) throw fail('pdf_invalid', 'PDF 원문 구조를 읽을 수 없습니다. 원문 파일을 확인하세요.');
    throw fail('pdf_renderer_unavailable', 'PDF 원문 표시 도구를 사용할 수 없습니다. 잠시 후 다시 확인하세요.', 503);
  }
}
async function metadata(pdf: Proxy, pageNumber: number): Promise<PdfPageMetadata> {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) throw fail('pdf_region_invalid', 'PDF에 실제로 있는 페이지를 선택하세요.');
  const page = await pdf.getPage(pageNumber), viewport = page.getViewport({ scale: 1 });
  const rotation = ((page.rotate % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation) || ![viewport.width, viewport.height].every(n => Number.isFinite(n) && n > 0 && n <= 20000)) throw fail('pdf_limit', 'PDF의 페이지 크기 또는 회전을 지원하지 않습니다.');
  return { pageNumber, width: viewport.width, height: viewport.height, rotation };
}
async function render(pdf: Proxy, canvas: typeof import('@napi-rs/canvas'), pageNumber: number) {
  const meta = await metadata(pdf, pageNumber), page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: Math.min(2, MAX_EDGE / Math.max(meta.width, meta.height)) });
  const image = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = image.getContext('2d');
  await page.render({ canvas: image as never, canvasContext: context as never, viewport, background: 'rgb(255,255,255)' }).promise;
  if (assetFailures.has(pdf)) throw fail('pdf_renderer_unavailable', 'PDF 표시 글꼴 또는 문자표를 읽을 수 없습니다. 표시 도구를 확인하세요.', 503);
  const png = image.toBuffer('image/png');
  return { ...meta, renderWidth: image.width, renderHeight: image.height, imageHash: sha(png), png, image, page };
}
function translate(error: unknown): never {
  if ((error as { status?: number }).status) throw error;
  throw fail('pdf_invalid', 'PDF 원문 위치를 표시하거나 추출할 수 없습니다. 원문을 확인하세요.');
}
export async function inspectGroupPdfMetadata(bytes: Uint8Array): Promise<PdfMetadata> {
  const value = await open(bytes);
  try {
    const pages: PdfPageMetadata[] = [];
    for (let i = 1; i <= value.pdf.numPages; i++) pages.push(await metadata(value.pdf, i));
    return { adapterVersion: GROUP_PDF_ADAPTER_VERSION, documentHash: value.documentHash, pageCount: value.pdf.numPages, pages };
  } catch (e) { return translate(e); } finally { await value.pdf.destroy(); }
}
export async function renderGroupPdfPage(bytes: Uint8Array, pageNumber: number) {
  const value = await open(bytes);
  try {
    const p = await render(value.pdf, value.canvas, pageNumber);
    return { png: p.png, pageNumber, width: p.width, height: p.height, rotation: p.rotation, imageHash: p.imageHash };
  } catch (e) { return translate(e); } finally { await value.pdf.destroy(); }
}
export async function inspectGroupPdf(bytes: Uint8Array, input: unknown): Promise<PdfInspection> {
  const regions = validatePdfRegions(input), value = await open(bytes);
  try {
    if (regions.some(r => r.pageNumber > value.pdf.numPages)) throw fail('pdf_region_invalid', 'PDF에 없는 페이지를 원문 위치로 사용할 수 없습니다.');
    const pages: PdfInspection['pages'] = [], results: PdfInspection['regions'] = [];
    for (const number of [...new Set(regions.map(r => r.pageNumber))].sort((a, b) => a - b)) {
      const p = await render(value.pdf, value.canvas, number), text = await p.page.getTextContent();
      pages.push({ pageNumber: number, width: p.width, height: p.height, rotation: p.rotation, renderWidth: p.renderWidth, renderHeight: p.renderHeight, imageHash: p.imageHash });
      const viewport = p.page.getViewport({ scale: 1 });
      for (const region of regions.filter(r => r.pageNumber === number)) {
        const r = region.rect;
        const left = Math.floor(r.x * p.renderWidth), top = Math.floor(r.y * p.renderHeight);
        const width = Math.min(p.renderWidth, Math.ceil((r.x + r.width) * p.renderWidth)) - left, height = Math.min(p.renderHeight, Math.ceil((r.y + r.height) * p.renderHeight)) - top;
        if (width < 2 || height < 2) throw fail('pdf_region_invalid', '원문을 확인할 수 있도록 영역의 넓이와 높이를 늘리세요.');
        const crop = value.canvas.createCanvas(width, height), context = crop.getContext('2d');
        context.drawImage(p.image, left, top, width, height, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        // Text intersection is an extraction aid only; the rendered region is the visual review basis.
        const strings = text.items.flatMap(item => {
          if (!('str' in item) || !item.str) return [];
          const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
          return x >= r.x * p.width && x <= (r.x + r.width) * p.width && y >= r.y * p.height && y <= (r.y + r.height) * p.height ? [item.str] : [];
        });
        const extracted = strings.join('\n');
        results.push({ regionId: region.regionId, locator: { kind: 'pdf-region', coordinateSystem: 'rotated-top-left-normalized-v1', pageNumber: number, ...r }, contentHash: createHash('sha256').update(`${width}x${height}:`).update(pixels).digest('hex'), textStatus: extracted ? 'text' : 'no_text', textHash: sha(extracted), previewHash: sha(crop.toBuffer('image/png')) });
      }
    }
    return { schemaVersion: 'supply-group-pdf-v1', adapterVersion: GROUP_PDF_ADAPTER_VERSION, documentHash: value.documentHash, pageCount: value.pdf.numPages, pages, regions: regions.map(r => results.find(v => v.regionId === r.regionId)!), verificationLevel: 'human_review' };
  } catch (e) { return translate(e); } finally { await value.pdf.destroy(); }
}
