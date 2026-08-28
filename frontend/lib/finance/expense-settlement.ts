import crypto from "node:crypto";
import ExcelJS from "exceljs";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { putContractDocument } from "@/lib/storage/contract-document-storage";

/*
 * 개인카드 경비 정산(FRM-P6, 203) — 승인된 지출결의서(개인카드) 전 행 + 출장보고서의
 * 개인카드 행(_receiptId 표식)을 취합해 월 1회 일괄 정산한다.
 *  - 미정산 판정: expense_settlement_items.row_ref(전역 유니크)에 없는 행.
 *    row_ref = receipt:<receiptId>(영수증 경유 행) | row:<docId>:<rowIdx>(수기 행 — 개인카드 양식만).
 *  - 출장보고서 수기 행은 법인/개인 구분이 불가능하므로 _receiptId 있는 행만 개인카드로 인정한다.
 *  - CMS: KB 일괄이체 등록 xlsx(사용자 실파일 규격 — 헤더 없이 A:은행코드 B:계좌 C:금액 D:성명
 *    E:출금통장표기 K:입금통장표기, 시트명 'Star급여이체'). 이체 실행은 담당자가 은행에서 수동.
 */

const PERSONAL_FORM = "frm-expense-personal";
const TRIP_FORM = "frm-biz-trip-report";

export interface UnsettledItem {
  rowRef: string;
  docId: string;
  docNo: string | null;
  formId: string;
  receiptId: string | null;
  employeeId: string | null;
  userId: string | null;
  employeeName: string | null;
  usedOn: string | null;
  vendor: string | null;
  category: string | null;
  amount: number;
  detail: string | null;
}

export interface PersonTotal {
  employeeId: string | null;
  employeeName: string;
  positionName: string | null;
  bankCode: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  amount: number;
  count: number;
}

function id(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(6).toString("hex")}`;
}

function parseJson(value: unknown): Record<string, unknown> {
  try {
    const v = typeof value === "string" ? JSON.parse(value) : value;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const amountOf = (v: unknown): number => Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0;

/** 승인 문서에서 개인카드 지출 행을 추출한다(정산 여부 무관 — 호출부에서 row_ref 로 거른다). */
function extractRows(doc: Record<string, unknown>): UnsettledItem[] {
  const formId = String(doc.form_id);
  const values = parseJson(doc.field_values);
  const tableKey = formId === PERSONAL_FORM ? "expenses" : "trip_expenses";
  const rows = Array.isArray(values[tableKey]) ? (values[tableKey] as Record<string, unknown>[]) : [];
  const out: UnsettledItem[] = [];
  rows.forEach((row, idx) => {
    if (!row || typeof row !== "object") return;
    const receiptId = typeof row._receiptId === "string" && row._receiptId ? row._receiptId : null;
    // 출장보고서는 영수증 경유(개인카드 확정) 행만, 개인카드 양식은 금액 있는 전 행
    if (formId === TRIP_FORM && !receiptId) return;
    const amount = amountOf(row.amount);
    if (amount <= 0) return;
    out.push({
      rowRef: receiptId ? `receipt:${receiptId}` : `row:${String(doc.doc_id)}:${idx}`,
      docId: String(doc.doc_id),
      docNo: doc.doc_no != null ? String(doc.doc_no) : null,
      formId,
      receiptId,
      employeeId: doc.drafter_employee_id != null ? String(doc.drafter_employee_id) : null,
      userId: doc.drafter_user_id != null ? String(doc.drafter_user_id) : null,
      employeeName: doc.drafter_name != null ? String(doc.drafter_name) : null,
      usedOn: row[formId === PERSONAL_FORM ? "used_on" : "spent_on"] != null ? String(row[formId === PERSONAL_FORM ? "used_on" : "spent_on"]) : null,
      vendor: row.vendor != null ? String(row.vendor) : null,
      category: row.category != null ? String(row.category) : null,
      amount,
      detail: row.detail != null ? String(row.detail) : null,
    });
  });
  return out;
}

/** 미정산 개인카드 지출 행 — 승인 문서 전수 스캔 후 정산된 row_ref 제외. */
export async function listUnsettledItems(): Promise<UnsettledItem[]> {
  const db = await getDb();
  const docs = rowsToObjects(
    await db.exec(
      `SELECT doc_id, doc_no, form_id, drafter_user_id, drafter_employee_id, drafter_name, field_values
         FROM approval_docs WHERE status = 'approved' AND form_id IN ($1, $2)
        ORDER BY completed_at`,
      [PERSONAL_FORM, TRIP_FORM]
    )
  );
  const settled = new Set(
    rowsToObjects(await db.exec(`SELECT row_ref FROM expense_settlement_items`)).map((r) => String(r.row_ref))
  );
  return docs.flatMap(extractRows).filter((item) => !settled.has(item.rowRef));
}

/** 인별 합계(계좌 정보 포함) — 미정산 목록/정산 상세 공용. */
export async function groupByPerson(items: UnsettledItem[] | SettlementItemRow[]): Promise<PersonTotal[]> {
  const db = await getDb();
  const profiles = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, e.bank_code, e.bank_account, e.bank_account_holder, p.position_name
         FROM employee_profiles e LEFT JOIN positions p ON p.position_id = e.position_id`
    )
  );
  const byEmp = new Map(profiles.map((r) => [String(r.employee_id), r]));
  const groups = new Map<string, PersonTotal>();
  for (const item of items) {
    const key = item.employeeId ?? item.employeeName ?? "unknown";
    let g = groups.get(key);
    if (!g) {
      const prof = item.employeeId ? byEmp.get(item.employeeId) : undefined;
      g = {
        employeeId: item.employeeId,
        employeeName: item.employeeName ?? String(prof?.name ?? "미상"),
        positionName: prof?.position_name != null ? String(prof.position_name) : null,
        bankCode: prof?.bank_code != null ? String(prof.bank_code) : null,
        bankAccount: prof?.bank_account != null ? String(prof.bank_account) : null,
        accountHolder: prof?.bank_account_holder != null ? String(prof.bank_account_holder) : null,
        amount: 0,
        count: 0,
      };
      groups.set(key, g);
    }
    g.amount += item.amount;
    g.count += 1;
  }
  return [...groups.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName, "ko"));
}

export interface SettlementRow {
  settlementId: string;
  settledOn: string;
  periodFrom: string | null;
  periodTo: string | null;
  totalAmount: number;
  itemCount: number;
  personCount: number;
  cmsFileKey: string | null;
  vatBundleSentAt: string | null;
  vatBundleSentTo: string | null;
  note: string | null;
  createdAt: string;
}

export interface SettlementItemRow extends UnsettledItem {
  itemId: string;
  settlementId: string;
}

function mapSettlement(r: Record<string, unknown>): SettlementRow {
  return {
    settlementId: String(r.settlement_id),
    settledOn: String(r.settled_on),
    periodFrom: r.period_from != null ? String(r.period_from) : null,
    periodTo: r.period_to != null ? String(r.period_to) : null,
    totalAmount: Number(r.total_amount ?? 0),
    itemCount: Number(r.item_count ?? 0),
    personCount: Number(r.person_count ?? 0),
    cmsFileKey: r.cms_file_key != null ? String(r.cms_file_key) : null,
    vatBundleSentAt: r.vat_bundle_sent_at != null ? String(r.vat_bundle_sent_at) : null,
    vatBundleSentTo: r.vat_bundle_sent_to != null ? String(r.vat_bundle_sent_to) : null,
    note: r.note != null ? String(r.note) : null,
    createdAt: String(r.created_at),
  };
}

export async function listSettlements(): Promise<SettlementRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM expense_settlements ORDER BY settled_on DESC, created_at DESC`));
  return rows.map(mapSettlement);
}

export async function listSettlementItems(settlementId: string): Promise<SettlementItemRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT * FROM expense_settlement_items WHERE settlement_id = $1 ORDER BY employee_name, used_on`, [settlementId])
  );
  return rows.map((r) => ({
    itemId: String(r.item_id),
    settlementId: String(r.settlement_id),
    rowRef: String(r.row_ref),
    docId: String(r.doc_id),
    docNo: r.doc_no != null ? String(r.doc_no) : null,
    formId: String(r.form_id),
    receiptId: r.receipt_id != null ? String(r.receipt_id) : null,
    employeeId: r.employee_id != null ? String(r.employee_id) : null,
    userId: r.user_id != null ? String(r.user_id) : null,
    employeeName: r.employee_name != null ? String(r.employee_name) : null,
    usedOn: r.used_on != null ? String(r.used_on) : null,
    vendor: r.vendor != null ? String(r.vendor) : null,
    category: r.category != null ? String(r.category) : null,
    amount: Number(r.amount ?? 0),
    detail: r.detail != null ? String(r.detail) : null,
  }));
}

/** 일괄 정산 실행 — 미정산 전건을 스냅샷으로 확정한다. row_ref 유니크가 동시 실행을 막는다. */
export async function runSettlement(params: { actorUserId: string; note?: string | null }): Promise<SettlementRow> {
  const items = await listUnsettledItems();
  if (!items.length) throw new Error("정산 대상 지출 건이 없습니다.");
  const now = new Date().toISOString();
  const settledOn = now.slice(0, 10);
  const settlementId = id("est");
  const dates = items.map((i) => i.usedOn).filter((d): d is string => !!d).sort();
  const persons = new Set(items.map((i) => i.employeeId ?? i.employeeName ?? "unknown"));

  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO expense_settlements
         (settlement_id, settled_on, period_from, period_to, total_amount, item_count, person_count, note, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        settlementId,
        settledOn,
        dates[0] ?? null,
        dates[dates.length - 1] ?? null,
        items.reduce((a, i) => a + i.amount, 0),
        items.length,
        persons.size,
        params.note ?? null,
        params.actorUserId,
        now,
      ]
    );
    for (const item of items) {
      await txn.run(
        `INSERT INTO expense_settlement_items
           (item_id, settlement_id, row_ref, doc_id, doc_no, form_id, receipt_id, employee_id, user_id, employee_name,
            used_on, vendor, category, amount, detail, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          id("esi"),
          settlementId,
          item.rowRef,
          item.docId,
          item.docNo,
          item.formId,
          item.receiptId,
          item.employeeId,
          item.userId,
          item.employeeName,
          item.usedOn,
          item.vendor,
          item.category,
          item.amount,
          item.detail,
          now,
        ]
      );
    }
  });
  const rows = await listSettlements();
  return rows.find((r) => r.settlementId === settlementId)!;
}

/**
 * KB CMS 일괄이체 등록 xlsx 생성 + 저장 — 사용자 실파일 규격(헤더 없음, 시트 'Star급여이체').
 * A:은행코드 B:계좌번호 C:금액 D:수취인 성명 E:출금통장 표기 K:입금통장 표기("<성명><직급>경비지급").
 * 계좌 정보가 없는 인원은 행을 만들되 빈 값으로 두고 warnings 로 알린다(은행 업로드 전 보완).
 */
export async function buildCmsFile(settlementId: string): Promise<{ fileName: string; storageKey: string; warnings: string[] }> {
  const items = await listSettlementItems(settlementId);
  if (!items.length) throw new Error("정산 내역이 없습니다.");
  const persons = await groupByPerson(items);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Star급여이체");
  const warnings: string[] = [];
  for (const p of persons) {
    if (!p.bankCode || !p.bankAccount) warnings.push(`${p.employeeName}: 계좌 정보 미등록 — 파일에서 직접 채워야 합니다.`);
    const label = `${p.employeeName}${p.positionName ?? ""}경비지급`;
    const row = ws.addRow([
      p.bankCode ?? "",
      p.bankAccount ?? "",
      p.amount,
      p.accountHolder || p.employeeName,
      label,
    ]);
    row.getCell(11).value = label; // K열 — 입금통장 표기
  }
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const settlement = (await listSettlements()).find((r) => r.settlementId === settlementId);
  const fileName = `출장 및 기타 경비 정산 ${(settlement?.settledOn ?? "").replace(/-/g, "").slice(2)}.xlsx`;
  const storageKey = `finance/expense-settlements/${settlementId}/${fileName}`;
  await putContractDocument(storageKey, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await withDbWrite(async (txn) => {
    await txn.run(`UPDATE expense_settlements SET cms_file_key = $2 WHERE settlement_id = $1`, [settlementId, storageKey]);
  });
  return { fileName, storageKey, warnings };
}

export interface MonthlyTrendRow {
  month: string; // YYYY-MM
  amount: number;
  count: number;
}

/** 월별 개인카드 지출 추이 — 정산 완료 items 기준(사용일 없는 건은 정산일 귀속). */
export async function monthlyTrend(year: number): Promise<MonthlyTrendRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT substr(COALESCE(NULLIF(i.used_on, ''), s.settled_on), 1, 7) AS month,
              SUM(i.amount) AS amount, COUNT(*) AS count
         FROM expense_settlement_items i JOIN expense_settlements s ON s.settlement_id = i.settlement_id
        WHERE substr(COALESCE(NULLIF(i.used_on, ''), s.settled_on), 1, 4) = $1
     GROUP BY 1 ORDER BY 1`,
      [String(year)]
    )
  );
  return rows.map((r) => ({ month: String(r.month), amount: Number(r.amount ?? 0), count: Number(r.count ?? 0) }));
}
