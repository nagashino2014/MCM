/**
 * 영수증 수집 대장(ledger)
 * - 수집 결과를 CSV 로 누적한다. 부가세 신고 시 "어떤 주문의 영수증이 어느 파일인지" 대사하는 용도.
 * - 재실행하면 이미 저장된 주문은 건너뛴다(주문번호 + 영수증종류 조합이 키).
 * - 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM 을 붙인다.
 */

import path from "node:path";
import fs from "node:fs";

import { siteDir, ensureSiteDir } from "./session";

export interface LedgerRow {
  site: string;
  orderNo: string;
  orderDate: string;
  title: string;
  amount: string;
  receiptType: string;
  /** PDF 를 만든 방식(page.pdf / cdp.printToPDF / html-snapshot) */
  method: string;
  files: string;
  collectedAt: string;
  /** 카드 원장 매칭 키 — 전표에 찍힌 승인번호·카드 끝4 (없으면 빈 값) */
  approvalNum?: string;
  cardLast4?: string;
}

// 매칭 키 컬럼은 끝에 덧붙였다 — 옛 대장(9열)도 위치가 어긋나지 않고, 없는 칸은 빈 값으로 읽힌다.
const HEADER = [
  "site", "orderNo", "orderDate", "title", "amount", "receiptType", "method", "files", "collectedAt",
  "approvalNum", "cardLast4",
];
const BOM = "﻿";

export function ledgerFile(site: string): string {
  return path.join(siteDir(site), "ledger.csv");
}

function csvCell(v: string): string {
  const s = (v ?? "").toString();
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV 한 줄 분해.
 * - 금액은 `"32,000원"` 처럼 인용부호 안에 콤마가 들어가므로 단순 split 으로는 컬럼이 밀린다.
 *   (그 탓에 재실행 시 중복 판정이 어긋났었다)
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }

  out.push(cur);
  return out;
}

/** 이미 수집된 키(`주문번호::영수증종류`) 집합 — 재실행 시 skip 판정용 */
export function loadCollectedKeys(site: string): Set<string> {
  const file = ledgerFile(site);
  const keys = new Set<string>();
  if (!fs.existsSync(file)) return keys;

  const lines = fs.readFileSync(file, "utf-8").replace(/^\ufeff/, "").split(/\r?\n/);
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const orderNo = cols[HEADER.indexOf("orderNo")] || "";
    const receiptType = cols[HEADER.indexOf("receiptType")] || "";
    if (orderNo) keys.add(`${orderNo}::${receiptType}`);
  }
  return keys;
}

export function appendLedger(site: string, row: LedgerRow): void {
  ensureSiteDir(site);
  const file = ledgerFile(site);

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, BOM + HEADER.join(",") + "\n", "utf-8");
  } else {
    upgradeHeaderIfNeeded(file);
  }

  const line = HEADER.map((k) => csvCell((row as unknown as Record<string, string>)[k] ?? "")).join(",");
  fs.appendFileSync(file, line + "\n", "utf-8");
}

/** 매칭 키 컬럼이 생기기 전의 대장이면 머리글만 새 것으로 바꾼다(값 칸은 빈 채 읽혀도 안전). */
function upgradeHeaderIfNeeded(file: string): void {
  const content = fs.readFileSync(file, "utf-8");
  const body = content.replace(/^\ufeff/, "");
  const firstLine = body.slice(0, body.indexOf("\n"));
  if (firstLine.trim() === HEADER.join(",")) return;
  fs.writeFileSync(file, BOM + HEADER.join(",") + body.slice(body.indexOf("\n")), "utf-8");
}

export function summarize(site: string): void {
  const file = ledgerFile(site);
  if (!fs.existsSync(file)) {
    console.log(`[${site}] 대장이 아직 없습니다: ${file}`);
    return;
  }

  const lines = fs.readFileSync(file, "utf-8").replace(/^﻿/, "").trim().split(/\r?\n/).slice(1);
  const byMethod = new Map<string, number>();
  const byMonth = new Map<string, number>();

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const orderDate = cols[HEADER.indexOf("orderDate")] || "";
    const method = cols[HEADER.indexOf("method")] || "";
    byMethod.set(method, (byMethod.get(method) || 0) + 1);
    const month = orderDate.slice(0, 7);
    if (month) byMonth.set(month, (byMonth.get(month) || 0) + 1);
  }

  console.log(`[${site}] 수집 건수: ${lines.length}`);
  console.log(`[${site}] 저장 방식별: ${[...byMethod].map(([k, v]) => `${k}=${v}`).join(", ") || "-"}`);
  console.log(`[${site}] 월별: ${[...byMonth].sort().map(([k, v]) => `${k}=${v}`).join(", ") || "-"}`);
  console.log(`[${site}] 대장 파일: ${file}`);
}

/**
 * 이미 수집한 건들의 품목·금액을 뒤늦게 채운다.
 * `--with-text` 로 함께 저장해 둔 전표 텍스트를 읽어 대장의 빈 칸만 메운다(값이 있는 행은 건드리지 않는다).
 */
export function enrichLedger(
  site: string,
  extract: (text: string) => { title: string; amount: string; approvalNum?: string; cardLast4?: string }
): { filled: number; skipped: number } {
  const file = ledgerFile(site);
  if (!fs.existsSync(file)) {
    console.log(`[${site}] 대장이 없습니다: ${file}`);
    return { filled: 0, skipped: 0 };
  }

  const lines = fs.readFileSync(file, "utf-8").replace(/^\ufeff/, "").trim().split(/\r?\n/);
  const out: string[] = [HEADER.join(",")];
  let filled = 0;
  let skipped = 0;

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;

    const cols = parseCsvLine(line);
    const titleIdx = HEADER.indexOf("title");
    const amountIdx = HEADER.indexOf("amount");
    const approvalIdx = HEADER.indexOf("approvalNum");
    const cardIdx = HEADER.indexOf("cardLast4");

    // 이미 값이 있으면 그대로 둔다(매칭 키만 비어 있어도 다시 본다).
    if ((cols[titleIdx] || cols[amountIdx]) && cols[approvalIdx]) {
      out.push(line);
      continue;
    }

    const textRel = (cols[HEADER.indexOf("files")] || "").split(" | ").find((f) => f.trim().endsWith(".txt"));
    if (!textRel) {
      out.push(line);
      skipped++;
      continue;
    }

    const textPath = path.join(siteDir(site), textRel.trim());
    if (!fs.existsSync(textPath)) {
      out.push(line);
      skipped++;
      continue;
    }

    const fields = extract(fs.readFileSync(textPath, "utf-8"));
    if (!fields.title && !fields.amount && !fields.approvalNum) {
      out.push(line);
      skipped++;
      continue;
    }

    cols[titleIdx] = cols[titleIdx] || fields.title;
    cols[amountIdx] = cols[amountIdx] || fields.amount;
    cols[approvalIdx] = cols[approvalIdx] || fields.approvalNum || "";
    cols[cardIdx] = cols[cardIdx] || fields.cardLast4 || "";
    out.push(HEADER.map((_, i) => csvCell(cols[i] || "")).join(","));
    filled++;
  }

  fs.writeFileSync(file, BOM + out.join("\n") + "\n", "utf-8");
  console.log(`[${site}] 품목·금액 ${filled}건 보강 / ${skipped}건은 근거 텍스트가 없어 건너뜀`);
  console.log(`[${site}]   텍스트가 없으면 'collect ... --with-text' 로 다시 받아야 채울 수 있습니다.`);
  return { filled, skipped };
}
