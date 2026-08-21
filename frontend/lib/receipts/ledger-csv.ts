/**
 * 수집 대장(ledger.csv) 읽기
 *
 * 대장을 만드는 쪽은 scraper 라 코드를 공유할 수 없어(별도 패키지) 읽는 쪽만 여기 둔다.
 * 금액이 `"32,000원"` 처럼 인용부호 안에 콤마를 담고 있어 단순 split 으로는 열이 밀린다.
 */

export interface LedgerRow {
  site: string;
  orderNo: string;
  orderDate: string;
  title: string;
  amount: string;
  receiptType: string;
  method: string;
  files: string;
  collectedAt: string;
  /** 카드 원장 매칭 키 — 구버전 대장에는 없어 빈 값이 된다 */
  approvalNum: string;
  cardLast4: string;
}

const HEADER = [
  "site", "orderNo", "orderDate", "title", "amount", "receiptType", "method", "files", "collectedAt",
  "approvalNum", "cardLast4",
];

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }

  cells.push(cell);
  return cells;
}

export function parseLedgerCsv(text: string): LedgerRow[] {
  const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/);
  if (lines.length <= 1) return [];

  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const cols = parseCsvLine(line);
      const row: Record<string, string> = {};
      HEADER.forEach((key, i) => (row[key] = (cols[i] ?? "").trim()));
      return row as unknown as LedgerRow;
    });
}

/** files 칸("receipts/2026-07/x.pdf | receipts/2026-07/x.txt")에서 PDF 상대경로만 */
export function pdfPathOf(row: LedgerRow): string {
  return (row.files || "")
    .split("|")
    .map((f) => f.trim())
    .find((f) => f.toLowerCase().endsWith(".pdf")) ?? "";
}
