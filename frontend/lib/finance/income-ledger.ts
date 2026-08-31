import crypto from "node:crypto";
import ExcelJS from "exceljs";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { decryptPii, encryptPii } from "@/lib/security/pii-crypto";
import type { ActionConnector } from "@/lib/approval/actions";

/*
 * 사업·기타소득 지급 대장(FRM-P4, 205) — 전문가활용비 승인 시 커넥터가 세액을 계산해 적재한다.
 * 세액 산식(실무 대장 엑셀 실측):
 *  - 기타소득: 필요경비 80% → 과세소득의 20% 소득세 + 지방세 10%. 과세소득 5만원 이하 소액부징수(0).
 *  - 사업소득: 지급총액의 3% 소득세 + 지방세 10%. 소득세 1,000원 미만 소액부징수(0).
 *  - 세액은 10원 미만 절사(원천징수 관행).
 * 결산 연동: regenerateJournal 의 income_doc 소스가 이 대장을 스캔해 자동분개한다(journal.ts).
 * 원천세 신고: withholding.ts 가 A25(사업)/A42(기타) 라인으로 월별 집계한다.
 */

export type IncomeKind = "business" | "other";

export interface IncomeTaxCalc {
  necessaryExpense: number;
  taxableIncome: number;
  incomeTax: number;
  localTax: number;
  withheldTotal: number;
  netAmount: number;
}

const floor10 = (n: number) => Math.floor(n / 10) * 10;

/** 소득 구분별 원천세 계산 — 대장 엑셀 산식 그대로. */
export function calcIncomeTax(kind: IncomeKind, gross: number): IncomeTaxCalc {
  if (kind === "other") {
    const necessary = Math.round(gross * 0.8);
    const taxable = gross - necessary;
    // 기타소득 과세소득(=기타소득금액) 5만원 이하 → 과세최저한(소득세법 84조) — 징수 없음
    const incomeTax = taxable > 50000 ? floor10(taxable * 0.2) : 0;
    const localTax = incomeTax > 0 ? floor10(incomeTax * 0.1) : 0;
    return {
      necessaryExpense: necessary,
      taxableIncome: taxable,
      incomeTax,
      localTax,
      withheldTotal: incomeTax + localTax,
      netAmount: gross - incomeTax - localTax,
    };
  }
  // 사업소득 — 3% + 지방세 10%. 소득세 1,000원 미만 소액부징수.
  let incomeTax = floor10(gross * 0.03);
  if (incomeTax < 1000) incomeTax = 0;
  const localTax = incomeTax > 0 ? floor10(incomeTax * 0.1) : 0;
  return {
    necessaryExpense: 0,
    taxableIncome: gross,
    incomeTax,
    localTax,
    withheldTotal: incomeTax + localTax,
    netAmount: gross - incomeTax - localTax,
  };
}

/* ---------- FRM-P0 커넥터 ---------- */

/** 전문가활용비 승인 → 대장 적재(doc_id 유니크 멱등). 소득 구분 라벨 → kind 해석. */
export const incomeLedgerAppendConnector: ActionConnector = {
  kind: "finance.income_ledger_append",
  label: "사업·기타소득 대장 적재",
  description: "승인된 전문가활용비 문서의 지급 내역을 세액 자동 계산과 함께 소득대장에 기록합니다.",
  slots: [
    { key: "kind", label: "소득 구분", required: true, hint: "radio — '기타소득'/'사업소득' 포함 라벨" },
    { key: "name", label: "소득자 성명", required: true },
    { key: "rrn", label: "주민등록번호" },
    { key: "date", label: "지급일", required: true },
    { key: "gross", label: "지급총액", required: true },
    { key: "reason", label: "지급 내역(비고)" },
  ],
  async run(ctx) {
    const kindLabel = String(ctx.slot("kind") ?? "");
    const kind: IncomeKind = kindLabel.includes("사업") ? "business" : "other";
    const gross = Math.round(Number(String(ctx.slot("gross") ?? "").replace(/[^\d.-]/g, "")) || 0);
    if (gross <= 0) throw new Error("지급총액이 올바르지 않습니다.");
    const payDate = String(ctx.slot("date") ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) throw new Error("지급일이 올바르지 않습니다.");
    const rrnDigits = String(ctx.slot("rrn") ?? "").replace(/\D/g, "");
    const calc = calcIncomeTax(kind, gross);
    const now = new Date().toISOString();
    const entryId = `inc-${crypto.randomBytes(6).toString("hex")}`;
    await withDbWrite(async (txn) => {
      await txn.run(
        `INSERT INTO income_payment_ledger
           (entry_id, income_kind, pay_date, payee_name, payee_rrn_encrypted, payee_rrn_masked,
            gross_amount, necessary_expense, taxable_income, income_tax, local_tax, withheld_total, net_amount,
            note, doc_id, doc_no, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (doc_id) DO NOTHING`,
        [
          entryId,
          kind,
          payDate,
          String(ctx.slot("name")),
          rrnDigits.length === 13 ? encryptPii(rrnDigits) : null,
          rrnDigits.length === 13 ? `${rrnDigits.slice(0, 6)}-${rrnDigits.slice(6, 7)}******` : null,
          gross,
          calc.necessaryExpense,
          calc.taxableIncome,
          calc.incomeTax,
          calc.localTax,
          calc.withheldTotal,
          calc.netAmount,
          ctx.slot("reason") != null ? String(ctx.slot("reason")) : null,
          ctx.docId,
          ctx.docNo,
          ctx.drafterUserId,
          now,
        ]
      );
    });
    const kindKo = kind === "business" ? "사업소득" : "기타소득";
    return {
      detail: `${kindKo} 대장 적재 — 지급총액 ${gross.toLocaleString("ko-KR")}원, 징수세액 ${calc.withheldTotal.toLocaleString("ko-KR")}원, 차감지급액 ${calc.netAmount.toLocaleString("ko-KR")}원`,
      result: { entryId, kind, gross, withheldTotal: calc.withheldTotal, netAmount: calc.netAmount },
    };
  },
};

/* ---------- 조회·대장 출력 ---------- */

export interface IncomeLedgerRow {
  entryId: string;
  incomeKind: IncomeKind;
  payDate: string;
  payeeName: string;
  payeeRrnMasked: string | null;
  grossAmount: number;
  necessaryExpense: number;
  taxableIncome: number;
  incomeTax: number;
  localTax: number;
  withheldTotal: number;
  netAmount: number;
  note: string | null;
  docNo: string | null;
  createdAt: string;
}

export async function listIncomeLedger(year: number, kind?: IncomeKind): Promise<IncomeLedgerRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    kind
      ? await db.exec(
          `SELECT * FROM income_payment_ledger WHERE substr(pay_date, 1, 4) = $1 AND income_kind = $2 ORDER BY pay_date, created_at`,
          [String(year), kind]
        )
      : await db.exec(`SELECT * FROM income_payment_ledger WHERE substr(pay_date, 1, 4) = $1 ORDER BY pay_date, created_at`, [String(year)])
  );
  return rows.map((r) => ({
    entryId: String(r.entry_id),
    incomeKind: String(r.income_kind) as IncomeKind,
    payDate: String(r.pay_date),
    payeeName: String(r.payee_name),
    payeeRrnMasked: r.payee_rrn_masked != null ? String(r.payee_rrn_masked) : null,
    grossAmount: Number(r.gross_amount ?? 0),
    necessaryExpense: Number(r.necessary_expense ?? 0),
    taxableIncome: Number(r.taxable_income ?? 0),
    incomeTax: Number(r.income_tax ?? 0),
    localTax: Number(r.local_tax ?? 0),
    withheldTotal: Number(r.withheld_total ?? 0),
    netAmount: Number(r.net_amount ?? 0),
    note: r.note != null ? String(r.note) : null,
    docNo: r.doc_no != null ? String(r.doc_no) : null,
    createdAt: String(r.created_at),
  }));
}

/** 원천세 신고용 월별 집계 — withholding.ts 의 A25(사업)/A42(기타) 라인 소스. */
export async function incomeWithholdingByMonth(year: number): Promise<
  Array<{ month: number; kind: IncomeKind; headcount: number; grossTotal: number; incomeTax: number; localTax: number }>
> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT substr(pay_date, 6, 2) AS mm, income_kind,
              COUNT(DISTINCT COALESCE(payee_rrn_masked, payee_name)) AS headcount,
              SUM(gross_amount) AS gross_total, SUM(income_tax) AS income_tax, SUM(local_tax) AS local_tax
         FROM income_payment_ledger WHERE substr(pay_date, 1, 4) = $1
        GROUP BY 1, 2 ORDER BY 1`,
      [String(year)]
    )
  );
  return rows.map((r) => ({
    month: Number(r.mm),
    kind: String(r.income_kind) as IncomeKind,
    headcount: Number(r.headcount ?? 0),
    grossTotal: Number(r.gross_total ?? 0),
    incomeTax: Number(r.income_tax ?? 0),
    localTax: Number(r.local_tax ?? 0),
  }));
}

/** 대장 엑셀 다운로드 — 실무 대장(기타소득 & 사업소득대장) 열 구성 그대로 2시트.
 *  세무 제출용이라 주민등록번호는 복호화해 전체 표기한다(finance.manage 전용 다운로드). */
export async function buildIncomeLedgerWorkbook(year: number): Promise<Buffer> {
  const rows = await listIncomeLedger(year);
  // 주민번호 복호화 맵(엑셀 전용 — 화면·API 응답에는 마스킹만 나간다)
  const db = await getDb();
  const rrnRows = rowsToObjects(
    await db.exec(`SELECT entry_id, payee_rrn_encrypted FROM income_payment_ledger WHERE substr(pay_date, 1, 4) = $1`, [String(year)])
  );
  const rrnById = new Map<string, string>();
  for (const r of rrnRows) {
    if (r.payee_rrn_encrypted == null) continue;
    const digits = decryptPii(String(r.payee_rrn_encrypted));
    if (digits && digits.length === 13) rrnById.set(String(r.entry_id), `${digits.slice(0, 6)}-${digits.slice(6)}`);
  }
  const wb = new ExcelJS.Workbook();

  const addSheet = (kind: IncomeKind) => {
    const isOther = kind === "other";
    const ws = wb.addWorksheet(isOther ? "기타소득대장 - 거주자" : "사업소득대장 - 거주자");
    ws.addRow([isOther ? "기 타 소 득 세 대 장 (거주자)" : "사 업 소 득 대 장 (거주자)"]).font = { bold: true, size: 14 };
    ws.addRow([`회사 : ㈜한국환경안전연구원`, "", "", "", `귀속 : ${year}`]);
    const header = isOther
      ? ["일련번호", "지급일", "소득자 성명", "주민등록번호", "지급총액", "필요경비(80%)", "과세소득", "소득세(20%)", "주민세(10%)", "징수세액", "차감지급액", "비고(지급내역)"]
      : ["일련번호", "지급일", "소득자 성명", "주민등록번호", "지급총액", "소득세(3%)", "주민세(10%)", "징수세액", "차감지급액", "비고(지급내역)"];
    ws.addRow(header).font = { bold: true };
    const list = rows.filter((r) => r.incomeKind === kind);
    list.forEach((r, i) => {
      const rrn = rrnById.get(r.entryId) ?? r.payeeRrnMasked ?? "-";
      ws.addRow(
        isOther
          ? [i + 1, r.payDate, r.payeeName, rrn, r.grossAmount, r.necessaryExpense, r.taxableIncome, r.incomeTax, r.localTax, r.withheldTotal, r.netAmount, r.note ?? ""]
          : [i + 1, r.payDate, r.payeeName, rrn, r.grossAmount, r.incomeTax, r.localTax, r.withheldTotal, r.netAmount, r.note ?? ""]
      );
    });
    const t = (fn: (r: IncomeLedgerRow) => number) => list.reduce((a, r) => a + fn(r), 0);
    ws.addRow(
      isOther
        ? ["계", "", "", "", t((r) => r.grossAmount), t((r) => r.necessaryExpense), t((r) => r.taxableIncome), t((r) => r.incomeTax), t((r) => r.localTax), t((r) => r.withheldTotal), t((r) => r.netAmount), ""]
        : ["계", "", "", "", t((r) => r.grossAmount), t((r) => r.incomeTax), t((r) => r.localTax), t((r) => r.withheldTotal), t((r) => r.netAmount), ""]
    ).font = { bold: true };
    ws.columns.forEach((col, i) => (col.width = i === 0 ? 8 : i <= 3 ? 14 : 13));
    for (let c = 5; c <= header.length - 1; c += 1) ws.getColumn(c).numFmt = "#,##0";
  };
  addSheet("other");
  addSheet("business");
  return Buffer.from(await wb.xlsx.writeBuffer());
}
