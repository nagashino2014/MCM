import { rowsToObjects, type PgDatabase } from "@/lib/db";

export type ExpenseMealAction = "withhold" | "deduct";
const MEAL_FORMS = new Set(["frm-expense-report", "frm-expense-personal"]);
const key = (formId: string, docId: string, rowNo: number) => JSON.stringify([formId, docId, rowNo]);

/** Sharing disposition identity does not combine the different forms' expense populations.
 * Trip meals are not assessed by overtime_meal_warnings. Row numbers are one-based
 * within the original document's expenses table, never receipt-table positions. */
export async function loadExpenseMealActions(db: PgDatabase, docs: Array<{ docId: string; formId: string }>): Promise<Map<string, ExpenseMealAction>> {
  const formByDoc = new Map(docs.filter(d => MEAL_FORMS.has(d.formId)).map(d => [d.docId, d.formId]));
  const actions = new Map<string, ExpenseMealAction>();
  if (!formByDoc.size) return actions;
  const rows = rowsToObjects(await db.exec(
    "SELECT doc_id, row_no, action FROM overtime_meal_warnings WHERE doc_id = ANY($1::text[]) AND action IN ('withhold','deduct')",
    [[...formByDoc.keys()]],
  ));
  for (const row of rows) {
    const docId = String(row.doc_id), rowNo = Number(row.row_no);
    if (!Number.isInteger(rowNo) || rowNo < 1) continue;
    const identity = key(formByDoc.get(docId)!, docId, rowNo);
    const action = String(row.action) as ExpenseMealAction;
    if (actions.has(identity) && actions.get(identity) !== action) {
      throw Object.assign(new Error("동일 지출 행의 식대 처분이 중복되어 있습니다. 처분 이력을 확인하세요."), { status: 409 });
    }
    actions.set(identity, action);
  }
  return actions;
}

export function expenseMealAction(actions: Map<string, ExpenseMealAction>, formId: string, docId: string, rowNo: number): ExpenseMealAction | null {
  return MEAL_FORMS.has(formId) ? actions.get(key(formId, docId, rowNo)) ?? null : null;
}
