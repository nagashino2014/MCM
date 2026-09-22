import crypto from "node:crypto";
import ExcelJS from "exceljs";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { putContractDocument } from "@/lib/storage/contract-document-storage";
import { expenseMealAction, loadExpenseMealActions } from "./expense-meal-actions";
import { lockExpenseSettlement } from "./expense-settlement-lock";

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
    if (typeof row._cardTxnId === "string" && row._cardTxnId) return;
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

/** Receipt IDs are global settlement references. Validate identity across source
 * forms without importing those forms' rows into the settlement population. */
function receiptReferenceCounts(docs: Record<string, unknown>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    const values = parseJson(doc.field_values);
    const table = values[String(doc.form_id) === TRIP_FORM ? "trip_expenses" : "expenses"];
    if (!Array.isArray(table)) continue;
    for (const row of table) {
      if (typeof row?._receiptId === "string" && row._receiptId) counts.set(row._receiptId, (counts.get(row._receiptId) ?? 0) + 1);
    }
  }
  return counts;
}

/** 미정산 개인카드 지출 행 — 승인 문서 전수 스캔 후 정산된 row_ref 제외. */
export async function listUnsettledItems(transaction?: PgDatabase): Promise<UnsettledItem[]> {
  const db = transaction ?? await getDb();
  const docs = rowsToObjects(
    await db.exec(
      `SELECT doc_id, doc_no, form_id, drafter_user_id, drafter_employee_id, drafter_name, field_values
         FROM approval_docs WHERE status = 'approved' AND form_id IN ($1, $2)
        ORDER BY completed_at${transaction ? " FOR SHARE" : ""}`,
      [PERSONAL_FORM, TRIP_FORM]
    )
  );
  const settled = new Set(
    rowsToObjects(await db.exec(`SELECT row_ref FROM expense_settlement_items`)).map((r) => String(r.row_ref))
  );
  await assertSettledExpenseSourcesUnchanged(docs.map(doc => String(doc.doc_id)), db);
  const mealActions = await loadExpenseMealActions(db, docs.map(d => ({ docId: String(d.doc_id), formId: String(d.form_id) })));
  // Validate source identity before withholding/settled filters: neither may hide
  // a second use of the same receipt under another row or document.
  const sourceItems = docs.flatMap(doc => extractRows(doc));
  if (sourceItems.some(item => item.receiptId)) {
    const receiptDocs = rowsToObjects(await db.exec(`SELECT doc_id, form_id, field_values FROM approval_docs
      WHERE status='approved' AND form_id IN ('frm-expense-personal','frm-expense-report','frm-biz-trip-report')${transaction ? " FOR SHARE" : ""}`));
    const counts = receiptReferenceCounts(receiptDocs);
    if (sourceItems.some(item => item.receiptId && counts.get(item.receiptId) !== 1)) {
      throw Object.assign(new Error("동일 영수증이 여러 지출 행에 연결되어 있습니다. 원본 연결을 정리한 뒤 정산하세요."), { status: 409 });
    }
  }
  const refs = new Set<string>();
  for (const item of sourceItems) {
    if (refs.has(item.rowRef)) throw Object.assign(new Error("동일 영수증이 여러 지출 행에 연결되어 있습니다. 원본 연결을 정리한 뒤 정산하세요."), { status: 409 });
    refs.add(item.rowRef);
  }
  return sourceItems.filter(item => {
    if (settled.has(item.rowRef)) return false;
    const doc = docs.find(doc => String(doc.doc_id) === item.docId)!;
    const values = parseJson(doc.field_values);
    const sourceRows = values[item.formId === PERSONAL_FORM ? "expenses" : "trip_expenses"] as Record<string, unknown>[];
    const idx = item.receiptId ? sourceRows.findIndex(row => row?._receiptId === item.receiptId) : Number(item.rowRef.slice(`row:${item.docId}:`.length));
    return expenseMealAction(mealActions, item.formId, item.docId, idx + 1) !== "withhold";
  });
}

/** 인별 합계(계좌 정보 포함) — 미정산 목록/정산 상세 공용. */
export async function groupByPerson(items: UnsettledItem[] | SettlementItemRow[], transaction?: PgDatabase): Promise<PersonTotal[]> {
  const db = transaction ?? await getDb();
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

export async function listSettlementItems(settlementId: string, transaction?: PgDatabase): Promise<SettlementItemRow[]> {
  const db = transaction ?? await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT * FROM expense_settlement_items WHERE settlement_id = $1 ORDER BY employee_name, used_on`, [settlementId])
  );
  return rows.map(mapSettlementItem);
}

function mapSettlementItem(r: Record<string, unknown>): SettlementItemRow {
  return {
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
  };
}

/** 일괄 정산 실행 — 미정산 전건을 스냅샷으로 확정한다. row_ref 유니크가 동시 실행을 막는다. */
export async function runSettlement(params: { actorUserId: string; note?: string | null }): Promise<SettlementRow> {
  return withDbWrite(async (txn) => {
  await lockExpenseSettlement(txn);
  const items = await listUnsettledItems(txn);
  if (!items.length) throw Object.assign(new Error("정산 대상 지출 건이 없습니다."), { status: 409 });
  const now = new Date().toISOString();
  const settledOn = now.slice(0, 10);
  const settlementId = id("est");
  const dates = items.map((i) => i.usedOn).filter((d): d is string => !!d).sort();
  const persons = new Set(items.map((i) => i.employeeId ?? i.employeeName ?? "unknown"));

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
  const rows = rowsToObjects(await txn.exec("SELECT * FROM expense_settlements WHERE settlement_id=$1", [settlementId]));
  return mapSettlement(rows[0]);
  });
}

/** Historical settlement snapshots are never silently rewritten. A withheld item
 * in a legacy snapshot must not be exported again as a payable bank instruction. */
export async function assertSettlementPayable(settlementId: string, transaction?: PgDatabase): Promise<SettlementItemRow[]> {
  const db = transaction ?? await getDb();
  const items = await listSettlementItems(settlementId, db);
  if (!items.length) throw Object.assign(new Error("정산 내역이 없습니다."), { status: 404 });
  await assertExpenseSources(items, db, true);
  return items;
}

/** Prevent a changed row identity from reappearing as a fresh payment. This
 * validates source identity/content only: an unchanged legacy withheld snapshot
 * must not prevent unrelated ordinary expenses from being settled. */
export async function assertSettledExpenseSourcesUnchanged(docIds: string[], transaction?: PgDatabase): Promise<void> {
  if (!docIds.length) return;
  const db = transaction ?? await getDb();
  const items = rowsToObjects(await db.exec("SELECT * FROM expense_settlement_items WHERE doc_id=ANY($1::text[])", [[...new Set(docIds)]])).map(mapSettlementItem);
  await assertExpenseSources(items, db, false);
}

async function assertExpenseSources(items: SettlementItemRow[], db: PgDatabase, rejectWithheld: boolean): Promise<void> {
  if (!items.length) return;
  const docs = rowsToObjects(await db.exec(`SELECT doc_id, form_id, field_values FROM approval_docs
    WHERE (status='approved' AND form_id IN ('frm-expense-personal','frm-expense-report','frm-biz-trip-report'))
       OR doc_id=ANY($1::text[])`, [[...new Set(items.map(item => item.docId))]]));
  const byDoc = new Map(docs.map(doc => [String(doc.doc_id), doc]));
  const receiptCounts = receiptReferenceCounts(docs);
  const actions = rejectWithheld ? await loadExpenseMealActions(db, docs.map(doc => ({ docId: String(doc.doc_id), formId: String(doc.form_id) }))) : new Map();
  for (const item of items) {
    const doc = byDoc.get(item.docId);
    const values = parseJson(doc?.field_values);
    const sourceTable = values[item.formId === TRIP_FORM ? "trip_expenses" : "expenses"];
    const rows = Array.isArray(sourceTable) ? sourceTable as Record<string, unknown>[] : [];
    if (item.receiptId) {
      if (receiptCounts.get(item.receiptId) !== 1) throw Object.assign(new Error("정산 영수증이 없거나 여러 지출 행에 연결되어 있습니다. 원본 연결을 확인한 뒤 CMS를 다시 생성하세요."), { status: 409 });
    }
    const rowIndex = item.receiptId ? rows.findIndex(row => row?._receiptId === item.receiptId)
      : item.rowRef.startsWith(`row:${item.docId}:`) ? Number(item.rowRef.slice(`row:${item.docId}:`.length)) : -1;
    if (!doc || String(doc.form_id) !== item.formId || !Number.isInteger(rowIndex) || rowIndex < 0 || !rows[rowIndex]) {
      throw Object.assign(new Error("정산 원본 행을 확인할 수 없습니다. 정산 이력을 확인한 뒤 CMS를 다시 생성하세요."), { status: 409 });
    }
    const current = rows[rowIndex];
    const sameText = (value: unknown, snapshot: string | null) => (value == null ? null : String(value)) === snapshot;
    const currentReceipt = typeof current._receiptId === "string" && current._receiptId ? current._receiptId : null;
    if (currentReceipt !== item.receiptId || (item.receiptId && item.rowRef !== `receipt:${item.receiptId}`)
      || amountOf(current.amount) !== item.amount || !sameText(current[item.formId === TRIP_FORM ? "spent_on" : "used_on"], item.usedOn)
      || !sameText(current.vendor, item.vendor) || !sameText(current.category, item.category)
      || !sameText(current.detail, item.detail) || (typeof current._cardTxnId === "string" && current._cardTxnId)) {
      throw Object.assign(new Error("정산 당시의 지출 내용과 현재 원본이 다릅니다. 정산 이력을 확인한 뒤 CMS를 다시 생성하세요."), { status: 409 });
    }
    if (rejectWithheld && expenseMealAction(actions, item.formId, item.docId, rowIndex + 1) === "withhold") {
      throw Object.assign(new Error("기존 정산에 불지급 식대가 포함되어 CMS 생성·다운로드를 차단했습니다. 과거 정산 원본을 확인하세요."), { status: 409 });
    }
  }
}

/**
 * KB CMS 일괄이체 등록 xlsx 생성 + 저장 — 사용자 실파일 규격(헤더 없음, 시트 'Star급여이체').
 * A:은행코드 B:계좌번호 C:금액 D:수취인 성명 E:출금통장 표기 K:입금통장 표기("<성명><직급>경비지급").
 * 계좌 정보가 없는 인원은 행을 만들되 빈 값으로 두고 warnings 로 알린다(은행 업로드 전 보완).
 */
export async function buildCmsFile(settlementId: string): Promise<{ fileName: string; storageKey: string; warnings: string[] }> {
  return withDbWrite(async (txn) => {
  await lockExpenseSettlement(txn);
  const items = await assertSettlementPayable(settlementId, txn);
  const persons = await groupByPerson(items, txn);
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
  const settlementRow = rowsToObjects(await txn.exec("SELECT * FROM expense_settlements WHERE settlement_id=$1", [settlementId]))[0];
  const settlement = settlementRow ? mapSettlement(settlementRow) : null;
  const fileName = `출장 및 기타 경비 정산 ${(settlement?.settledOn ?? "").replace(/-/g, "").slice(2)}.xlsx`;
  const storageKey = `finance/expense-settlements/${settlementId}/${fileName}`;
  await putContractDocument(storageKey, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await txn.run(`UPDATE expense_settlements SET cms_file_key = $2 WHERE settlement_id = $1`, [settlementId, storageKey]);
  return { fileName, storageKey, warnings };
  });
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
