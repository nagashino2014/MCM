/**
 * 영수증 페이지 → PDF 저장 (3단 폴백)
 *
 * 배경: Playwright 의 page.pdf() 는 **headless Chromium 에서만** 동작한다.
 *   그런데 쇼핑몰은 headless 를 탐지해 막는 경우가 있어 headed 로 돌려야 할 때가 있다.
 *   그래서 아래 순서로 시도하고, 성공한 방식을 기록해 둔다(어느 방식이 통하는지가 이 스파이크의 관측 대상).
 *
 *   1) page.pdf()            — headless 일 때만. 가장 깔끔.
 *   2) CDP Page.printToPDF   — headed 에서도 동작할 가능성이 있는 경로. 실측 대상.
 *   3) HTML + 전체 스크린샷  — 위 둘이 다 막혀도 증빙 원본은 남긴다(항상 성공).
 *
 * 3) 로 떨어지면 PDF 가 아니므로, 제출용 PDF 가 필요하면 저장된 HTML 을 별도 headless 렌더로
 *    한 번 더 돌리거나 스크린샷을 PDF 로 묶는 후처리가 필요하다.
 */

import path from "node:path";
import fs from "node:fs";
import { Page } from "playwright";

export type PdfMethod = "page.pdf" | "cdp.printToPDF" | "html-snapshot";

export interface SaveResult {
  method: PdfMethod;
  files: string[];
  /** 시도했다가 실패한 방식과 사유(진단용) */
  attempts: { method: PdfMethod; error: string }[];
}

const PDF_OPTIONS = {
  format: "A4",
  printBackground: true,
  margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
} as const;

/**
 * 인쇄 시 화면에서만 보이는 요소가 빠지는 것을 막기 위해 print 미디어 대신 screen 미디어로 렌더한다.
 * (영수증은 대개 인쇄 전용 레이아웃이라 print 가 나은 경우도 있어, 실측 후 조정 여지를 남긴다)
 */
async function prepare(page: Page): Promise<void> {
  await page.emulateMedia({ media: "screen" }).catch(() => {});
  // 이미지·웹폰트가 덜 뜬 상태로 굳는 것을 막는 최소 대기
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

export async function savePageAsPdf(page: Page, outBase: string): Promise<SaveResult> {
  fs.mkdirSync(path.dirname(outBase), { recursive: true });
  await prepare(page);

  const attempts: { method: PdfMethod; error: string }[] = [];
  const pdfPath = `${outBase}.pdf`;

  // 1) page.pdf() — headless 전용
  try {
    await page.pdf({ path: pdfPath, ...PDF_OPTIONS });
    return { method: "page.pdf", files: [pdfPath], attempts };
  } catch (e) {
    attempts.push({ method: "page.pdf", error: String(e).slice(0, 200) });
  }

  // 2) CDP Page.printToPDF — headed 에서도 되는지 실측
  try {
    const cdp = await page.context().newCDPSession(page);
    const { data } = (await cdp.send("Page.printToPDF", {
      printBackground: true,
      paperWidth: 8.27, // A4
      paperHeight: 11.69,
      marginTop: 0.4,
      marginBottom: 0.4,
      marginLeft: 0.4,
      marginRight: 0.4,
    })) as { data: string };
    await cdp.detach().catch(() => {});

    fs.writeFileSync(pdfPath, Buffer.from(data, "base64"));
    return { method: "cdp.printToPDF", files: [pdfPath], attempts };
  } catch (e) {
    attempts.push({ method: "cdp.printToPDF", error: String(e).slice(0, 200) });
  }

  // 3) HTML + 전체 스크린샷 — 최후 보루(증빙 원본 보존)
  const htmlPath = `${outBase}.html`;
  const pngPath = `${outBase}.png`;

  const html = await page.content();
  fs.writeFileSync(htmlPath, html, "utf-8");

  const files = [htmlPath];
  try {
    await page.screenshot({ path: pngPath, fullPage: true });
    files.push(pngPath);
  } catch (e) {
    attempts.push({ method: "html-snapshot", error: `screenshot 실패: ${String(e).slice(0, 200)}` });
  }

  return { method: "html-snapshot", files, attempts };
}

/** 파일명에 쓸 수 없는 문자 정리 (lib/daou/fetch-docs.ts 의 safeName 과 동일 규칙) */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\r\n]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
}
