#!/usr/bin/env npx ts-node
/**
 * IEPS 게시판 사이트 구조 정찰 스크립트.
 *
 * 사용법:
 *   npx ts-node scripts/cli-recon.ts
 *
 * 동작:
 *   1) `data/scraper-targets.json`의 board.list_url을 fetch
 *   2) 페이지의 후보 selector(table.board_list, tbody tr 등)와 첨부 패턴(onclick=fnDownload 등)을
 *      탐지해 콘솔에 출력
 *   3) 결과 HTML 일부와 후보 selector를 `data/ieps/recon-<boardId>.json`으로 저장
 */

import path from "node:path";
import fs from "node:fs";
import * as cheerio from "cheerio";

import { loadTargets, findBoard } from "./scraper-runner";

const SCRAPER_ROOT = path.resolve(__dirname, "..");
const MCM_ROOT = path.resolve(SCRAPER_ROOT, "..");
const RECON_DIR = path.join(MCM_ROOT, "data", "ieps");
fs.mkdirSync(RECON_DIR, { recursive: true });

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.text();
}

function probeSelectors($: cheerio.CheerioAPI): Record<string, number> {
  const candidates = [
    "table.board_list",
    "table.list_table",
    "table.tbl_list",
    "table.tbl_board",
    "table",
    "ul.board_list",
    "ul.list",
    "div.board_list",
    "div.list",
  ];
  const result: Record<string, number> = {};
  for (const sel of candidates) {
    const count = $(sel).length;
    if (count > 0) result[sel] = count;
  }
  return result;
}

function probeRows($: cheerio.CheerioAPI, container: string): Record<string, number> {
  const rowSelectors = ["tbody tr", "tr", "li", ".item", ".list_item"];
  const result: Record<string, number> = {};
  const $container = $(container);
  for (const sel of rowSelectors) {
    const count = $container.find(sel).length;
    if (count > 0) result[`${container} ${sel}`] = count;
  }
  return result;
}

function probeLinks($: cheerio.CheerioAPI): Array<{ href?: string; onclick?: string; text: string }> {
  const samples: Array<{ href?: string; onclick?: string; text: string }> = [];
  $("a").each((_, el) => {
    if (samples.length >= 10) return false;
    const $a = $(el);
    const onclick = ($a.attr("onclick") || "").trim();
    const href = ($a.attr("href") || "").trim();
    const text = ($a.text() || "").trim().slice(0, 40);
    if (text && (onclick || (href && href !== "#"))) {
      samples.push({ href, onclick, text });
    }
    return undefined;
  });
  return samples;
}

function probePagination(html: string): string[] {
  const matches = new Set<string>();
  const patterns = [
    /pageIndex/gi,
    /currentPage/gi,
    /page=\d+/gi,
    /pgno/gi,
    /goPage\(/gi,
    /movePage\(/gi,
  ];
  for (const re of patterns) {
    if (re.test(html)) matches.add(re.source);
  }
  return Array.from(matches);
}

function probeAttachmentHints(html: string): string[] {
  const hints = [
    "fnDownload",
    "fileDown",
    "atchFileDown",
    "atchFile",
    "downloadFile",
    "AttachDown",
    "javascript:download",
  ];
  return hints.filter((h) => html.toLowerCase().includes(h.toLowerCase()));
}

async function main() {
  const targets = loadTargets(path.join(SCRAPER_ROOT, "data"));
  const boardId = process.argv[2] || "ieps-integrated-permit";
  const board = findBoard(targets, boardId);
  if (!board || !board.list_url) {
    console.error(`board ${boardId} 또는 list_url을 찾지 못했습니다.`);
    process.exit(1);
  }
  console.log(`[recon] fetching ${board.list_url}`);
  const html = await fetchHtml(board.list_url);

  const $ = cheerio.load(html);
  const containerCandidates = probeSelectors($);
  const top = Object.entries(containerCandidates).sort((a, b) => b[1] - a[1])[0];
  const rowCandidates = top ? probeRows($, top[0]) : {};
  const linkSamples = probeLinks($);
  const paginationHints = probePagination(html);
  const attachmentHints = probeAttachmentHints(html);

  const result = {
    fetchedAt: new Date().toISOString(),
    boardId,
    listUrl: board.list_url,
    htmlBytes: Buffer.byteLength(html, "utf8"),
    containerCandidates,
    rowCandidates,
    linkSamples,
    paginationHints,
    attachmentHints,
  };

  console.log(JSON.stringify(result, null, 2));
  const outPath = path.join(RECON_DIR, `recon-${boardId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  const htmlPath = path.join(RECON_DIR, `recon-${boardId}.html`);
  fs.writeFileSync(htmlPath, html, "utf8");
  console.log(`[recon] saved → ${outPath}`);
  console.log(`[recon] html  → ${htmlPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
