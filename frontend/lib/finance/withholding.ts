// 원천세 신고 자료 (블루프린트 P7-②) — 확정 급여대장에서 원천징수이행상황신고서 월별 수치 집계.
// 간이세액(A01) = 당월 급여·상여 인원/총지급액/소득세, 연말정산(A04)·중도정산 라인 분리,
// 지방소득세는 별도 지방세 신고분으로 별계. 신고·납부 기한 = 지급월 익월 10일.
// 조정환급 등 신고서 최종 조정은 세무 판단 영역 — 여기서는 대장 실측 집계를 제공한다(§7 T5).

import ExcelJS from "exceljs";
import { getDb, rowsToObjects } from "@/lib/db";
import { incomeWithholdingByMonth } from "@/lib/finance/income-ledger";

export interface WithholdingMonth {
  year: number;
  month: number;
  dueDate: string; // 익월 10일
  headcount: number;
  payTotal: number; // 총지급액(대장 지급합계)
  incomeTax: number; // 간이세액 소득세
  settleIncomeTax: number; // 중도·수정 정산분
  yearendIncomeTax: number; // 연말정산분
  farmTax: number; // 농특세(당월+연말정산)
  // 사업(A25)·기타(A42) 소득 — 전문가활용비 승인 적재분(205 income_payment_ledger, FRM-P4)
  bizHeadcount: number;
  bizPayTotal: number;
  bizIncomeTax: number; // A25 사업소득 3%
  otherHeadcount: number;
  otherPayTotal: number;
  otherIncomeTax: number; // A42 기타소득 20%
  incomeTaxTotal: number; // 소득세 계열 납부 대상 합(A01+정산+연말+농특+A25+A42)
  localTax: number; // 지방소득세(당월+연말정산+정산+사업·기타) — 지방세 별도 신고
  ledgerCount: number;
}

const DED_GROUPS: Record<string, string[]> = {
  income: ["income-tax"],
  settleIncome: ["settle-income"],
  yearendIncome: ["yearend-income"],
  farm: ["farm-tax", "yearend-farm"],
  local: ["local-tax", "settle-local", "yearend-local"],
};

export async function withholdingByMonth(year: number): Promise<WithholdingMonth[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT pl.pay_month,
              count(DISTINCT pl.ledger_id) AS ledger_count,
              count(DISTINCT pe.entry_id) AS headcount,
              COALESCE(SUM(pe.pay_total), 0) AS pay_total
         FROM payroll_ledgers pl JOIN payroll_entries pe ON pe.ledger_id = pl.ledger_id
        WHERE pl.status = 'confirmed' AND pl.pay_year = $1
        GROUP BY pl.pay_month ORDER BY pl.pay_month`,
      [year],
    ),
  );
  const lineRows = rowsToObjects(
    await db.exec(
      `SELECT pl.pay_month, pel.item_id, COALESCE(SUM(pel.amount), 0) AS amount
         FROM payroll_ledgers pl
         JOIN payroll_entries pe ON pe.ledger_id = pl.ledger_id
         JOIN payroll_entry_lines pel ON pel.entry_id = pe.entry_id
        WHERE pl.status = 'confirmed' AND pl.pay_year = $1
          AND pel.item_id = ANY($2::text[])
        GROUP BY pl.pay_month, pel.item_id`,
      [year, Object.values(DED_GROUPS).flat()],
    ),
  );
  const byMonth = new Map<number, Map<string, number>>();
  for (const r of lineRows) {
    const m = Number(r.pay_month);
    if (!byMonth.has(m)) byMonth.set(m, new Map());
    byMonth.get(m)!.set(String(r.item_id), Number(r.amount || 0));
  }
  const sumGroup = (m: number, group: string[]) =>
    Math.round(group.reduce((acc, id) => acc + (byMonth.get(m)?.get(id) ?? 0), 0));

  // 사업(A25)·기타(A42) 소득 월별 집계 — 급여 대장 없는 달에도 지급이 있으면 행을 만든다.
  const incomeRows = await incomeWithholdingByMonth(year);
  const incomeByMonth = new Map<number, { biz: { headcount: number; gross: number; tax: number; local: number }; other: { headcount: number; gross: number; tax: number; local: number } }>();
  for (const r of incomeRows) {
    const slot = incomeByMonth.get(r.month) ?? {
      biz: { headcount: 0, gross: 0, tax: 0, local: 0 },
      other: { headcount: 0, gross: 0, tax: 0, local: 0 },
    };
    const side = r.kind === "business" ? slot.biz : slot.other;
    side.headcount += r.headcount;
    side.gross += r.grossTotal;
    side.tax += r.incomeTax;
    side.local += r.localTax;
    incomeByMonth.set(r.month, slot);
  }
  const months = [...new Set([...rows.map((r) => Number(r.pay_month)), ...incomeByMonth.keys()])].sort((a, b) => a - b);
  const rowByMonth = new Map(rows.map((r) => [Number(r.pay_month), r]));

  return months.map((month) => {
    const r = rowByMonth.get(month);
    const nextY = month === 12 ? year + 1 : year;
    const nextM = month === 12 ? 1 : month + 1;
    const incomeTax = sumGroup(month, DED_GROUPS.income);
    const settleIncomeTax = sumGroup(month, DED_GROUPS.settleIncome);
    const yearendIncomeTax = sumGroup(month, DED_GROUPS.yearendIncome);
    const farmTax = sumGroup(month, DED_GROUPS.farm);
    const inc = incomeByMonth.get(month) ?? {
      biz: { headcount: 0, gross: 0, tax: 0, local: 0 },
      other: { headcount: 0, gross: 0, tax: 0, local: 0 },
    };
    return {
      year,
      month,
      dueDate: `${nextY}-${String(nextM).padStart(2, "0")}-10`,
      headcount: Number(r?.headcount || 0),
      payTotal: Math.round(Number(r?.pay_total || 0)),
      incomeTax,
      settleIncomeTax,
      yearendIncomeTax,
      farmTax,
      bizHeadcount: inc.biz.headcount,
      bizPayTotal: inc.biz.gross,
      bizIncomeTax: inc.biz.tax,
      otherHeadcount: inc.other.headcount,
      otherPayTotal: inc.other.gross,
      otherIncomeTax: inc.other.tax,
      incomeTaxTotal: incomeTax + settleIncomeTax + yearendIncomeTax + farmTax + inc.biz.tax + inc.other.tax,
      localTax: sumGroup(month, DED_GROUPS.local) + inc.biz.local + inc.other.local,
      ledgerCount: Number(r?.ledger_count || 0),
    };
  });
}

export async function buildWithholdingWorkbook(year: number): Promise<Buffer> {
  const months = await withholdingByMonth(year);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("원천징수 집계");
  ws.addRow([`원천징수이행상황신고 기초자료 (${year}년) — 확정 급여대장 + 사업·기타소득 대장 집계`]).font = { bold: true, size: 13 };
  ws.addRow(["지급월", "신고·납부 기한", "인원", "총지급액", "간이세액 소득세", "정산분", "연말정산분", "농특세", "사업소득 A25(인원/지급액/세액)", "", "", "기타소득 A42(인원/지급액/세액)", "", "", "소득세 계열 합계", "지방소득세(별도 신고)"]).font = { bold: true };
  for (const m of months) {
    ws.addRow([
      `${m.year}.${String(m.month).padStart(2, "0")}`,
      m.dueDate,
      m.headcount,
      m.payTotal,
      m.incomeTax,
      m.settleIncomeTax,
      m.yearendIncomeTax,
      m.farmTax,
      m.bizHeadcount,
      m.bizPayTotal,
      m.bizIncomeTax,
      m.otherHeadcount,
      m.otherPayTotal,
      m.otherIncomeTax,
      m.incomeTaxTotal,
      m.localTax,
    ]);
  }
  const t = (fn: (m: WithholdingMonth) => number) => months.reduce((acc, m) => acc + fn(m), 0);
  ws.addRow(["합계", "", "", t((m) => m.payTotal), t((m) => m.incomeTax), t((m) => m.settleIncomeTax), t((m) => m.yearendIncomeTax), t((m) => m.farmTax), "", t((m) => m.bizPayTotal), t((m) => m.bizIncomeTax), "", t((m) => m.otherPayTotal), t((m) => m.otherIncomeTax), t((m) => m.incomeTaxTotal), t((m) => m.localTax)]).font = { bold: true };
  ws.columns.forEach((col, i) => (col.width = [10, 14, 8, 16, 15, 12, 13, 10, 8, 14, 12, 8, 14, 12, 15, 16][i] ?? 12));
  for (let c = 4; c <= 16; c += 1) ws.getColumn(c).numFmt = "#,##0";
  return Buffer.from(await wb.xlsx.writeBuffer());
}
