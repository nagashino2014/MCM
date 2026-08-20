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
}

const HEADER = ["site", "orderNo", "orderDate", "title", "amount", "receiptType", "method", "files", "collectedAt"];
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
  }

  const line = HEADER.map((k) => csvCell((row as unknown as Record<string, string>)[k])).join(",");
  fs.appendFileSync(file, line + "\n", "utf-8");
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
