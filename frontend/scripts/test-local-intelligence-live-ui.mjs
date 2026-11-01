// 발행된 실제 보고서를 조회한다. 새 보고서 생성·AI 호출·업무 자료 수정은 하지 않는다.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const base = "http://127.0.0.1:4174";
const json = async (path) => { const response = await fetch(base + path); assert(response.ok); return response.json(); };
assert.equal((await json("/api/local-demo/health")).mode, "real");
const run = (await json("/api/sales/rag/runs")).runs.find((item) => item.status === "published" && (!process.env.MCM_QUALITY_RUN_ID || item.runId === process.env.MCM_QUALITY_RUN_ID));
assert(run, "실제 AI 보고서 발행 후 화면 검증을 실행하세요.");
const output = resolve(".next/local-intelligence-demo/screenshots");
await mkdir(output, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.MCM_PLAYWRIGHT_PATH || resolve("../scraper/node_modules/playwright/index.mjs")).href);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/sales/rag?tab=scheduled&runId=${run.runId}`);
  await page.getByText("실제 수집 자료 · AI 브리핑 로컬 실증", { exact: true }).waitFor();
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).waitFor();
  assert(!await page.getByText("로컬 예시 문구", { exact: false }).count());
  await page.screenshot({ path: resolve(output, "live-report-light.png"), fullPage: true });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  const pdf = await downloaded; assert(pdf.suggestedFilename().endsWith(".pdf")); assert.equal(await pdf.failure(), null);
  await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByLabel("관심 분야", { exact: true }).selectOption(run.profileId);
  await page.getByRole("button", { name: "대상 미리보기", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({ path: resolve(output, "live-preview-light.png"), fullPage: true });
  await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).last().click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "시험 수신함", exact: true }).click();
  await page.getByRole("dialog", { name: "시험 수신함" }).getByText(`[영업 브리핑] ${run.profileName}`, { exact: true }).first().waitFor();
  await page.getByRole("dialog", { name: "시험 수신함" }).getByRole("button", { name: "닫기", exact: true }).last().click();
  await page.getByRole("dialog", { name: "시험 수신함" }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "다크 모드", exact: true }).click();
  await page.getByRole("button", { name: "열기", exact: true }).first().click();
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).waitFor();
  await page.screenshot({ path: resolve(output, "live-report-dark.png"), fullPage: true });
  if (await page.getByRole("button", { name: "투자 프로젝트 보기", exact: true }).count()) {
    await page.getByRole("button", { name: "투자 프로젝트 보기", exact: true }).first().click();
    await page.waitForURL(url => url.searchParams.get("tab") === "projects" && !!url.searchParams.get("projectId"));
    await page.getByRole("button", { name: "영업·계약 연결", exact: true }).waitFor();
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: 실제 발행본 라이트·다크 화면 / PDF 다운로드 / 대상 미리보기 / 로컬 수신함 / 프로젝트 업무 연결 / ${run.runId}`);
} finally { await browser.close(); }
