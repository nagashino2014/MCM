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

/**
 * PNG 내보내기 — targetWidth(px)를 주면 그 가로 폭으로 출력한다(세로는 비율 유지).
 * 채용 플랫폼 규격 대응(예: 사람인 최대 860×9000). 미지정 시 2배 해상도.
 */
export async function exportElementPng(el: HTMLElement, filename: string, targetWidth?: number): Promise<void> {
  const ratio = targetWidth && el.offsetWidth > 0 ? targetWidth / el.offsetWidth : PIXEL_RATIO;
  downloadUrl(await captureNode(el, ratio), filename.endsWith(".png") ? filename : `${filename}.png`);
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
