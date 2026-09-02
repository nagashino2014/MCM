/**
 * 공고 문서 내보내기 — **브라우저 전용**. PNG(채용 플랫폼 게시용 세로 긴 이미지) + PDF(인쇄·공유용).
 * PNG 는 html-to-image 캡처, PDF 는 그 PNG 를 pdf-lib 단일 페이지에 임베드한다(문서 비율 그대로).
 */
import { toPng } from "html-to-image";

const PIXEL_RATIO = 2; // PDF 임베드용 기본 2배 해상도

async function captureNode(el: HTMLElement, pixelRatio: number): Promise<string> {
  return toPng(el, {
    pixelRatio,
    cacheBust: true,
    backgroundColor: "#ffffff",
  });
}

function downloadUrl(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("캡처 이미지를 읽지 못했습니다."));
    img.src = src;
  });
}

/**
 * 고품질 다운스케일 — 목표 크기로 캔버스 축소. 2.4배를 넘는 축소는 절반씩 단계적으로
 * 줄여 계단 현상을 막는다(브라우저 스무딩은 큰 비율 축소에서 품질이 급락).
 */
async function downscaleToDataUrl(
  dataUrl: string,
  targetW: number,
  targetH: number,
  format: "png" | "jpeg"
): Promise<string> {
  let src: CanvasImageSource = await loadImage(dataUrl);
  let curW = (src as HTMLImageElement).width;
  let curH = (src as HTMLImageElement).height;
  while (curW / targetW > 2.4) {
    curW = Math.round(curW / 2);
    curH = Math.round(curH / 2);
    const step = document.createElement("canvas");
    step.width = curW;
    step.height = curH;
    const ctx = step.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, curW, curH);
    src = step;
  }
  const out = document.createElement("canvas");
  out.width = targetW;
  out.height = targetH;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (format === "jpeg") {
    ctx.fillStyle = "#ffffff"; // JPG 는 투명을 지원하지 않으므로 흰 바탕
    ctx.fillRect(0, 0, targetW, targetH);
  }
  ctx.drawImage(src, 0, 0, targetW, targetH);
  return out.toDataURL(format === "jpeg" ? "image/jpeg" : "image/png", 0.92);
}

/**
 * 이미지 내보내기 — targetWidth(px)를 주면 그 가로 폭으로 출력한다(세로는 비율 유지).
 * 화질: 목표 폭이 문서 2배보다 작으면 2배로 슈퍼샘플링 캡처 후 고품질 축소 —
 * 1 미만 비정수 배율로 직접 렌더할 때 생기는 텍스트 뭉개짐(사람인 860px 사례)을 막는다.
 */
export async function exportElementPng(
  el: HTMLElement,
  filename: string,
  targetWidth?: number,
  format: "png" | "jpeg" = "png"
): Promise<void> {
  const ext = format === "jpeg" ? ".jpg" : ".png";
  const name = /\.(png|jpe?g)$/i.test(filename) ? filename : `${filename}${ext}`;
  if (!targetWidth || el.offsetWidth <= 0) {
    downloadUrl(await captureNode(el, PIXEL_RATIO), name);
    return;
  }
  const supersample = targetWidth < el.offsetWidth * 2;
  const captureRatio = (supersample ? targetWidth * 2 : targetWidth) / el.offsetWidth;
  const dataUrl = await captureNode(el, captureRatio);
  const targetH = Math.round((el.offsetHeight * targetWidth) / el.offsetWidth);
  const finalUrl =
    supersample || format === "jpeg" ? await downscaleToDataUrl(dataUrl, targetWidth, targetH, format) : dataUrl;
  downloadUrl(finalUrl, name);
}

export async function exportElementPdf(el: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await captureNode(el, PIXEL_RATIO);
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const png = await pdf.embedPng(dataUrl);
  const w = png.width / PIXEL_RATIO;
  const h = png.height / PIXEL_RATIO;
  const page = pdf.addPage([w, h]);
  page.drawImage(png, { x: 0, y: 0, width: w, height: h });
  const bytes = await pdf.save();
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
