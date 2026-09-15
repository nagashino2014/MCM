import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { parseFields } from "@/lib/approval/fields";
import { compareWithRefDoc, type RefMismatch } from "@/lib/approval/ref-link";
import { parsePeriod } from "@/lib/approval/trip";
import {
  LODGING_TRIP_CLASS, TRIP_REPORT_FORM_ID, employeeRankOrder, listTripLodgingRules, previewLodgingAllowance,
  type LodgingAllowanceSnapshot,
} from "@/lib/payroll/trip-allowance";

/*
 * 선행 문서 연계 정합성(2026-09-15 사용자 요청) — 상신 시점 판정을 field_values 에 고정 저장한다
 * (초과근무 _over_limit·식대 _meal_check 와 같은 스냅샷 패턴, 결재 화면 배너의 근거).
 *  - _ref_check      : 선행 문서와의 불일치 목록(ref-link.ts compareWithRefDoc — 기안 화면과 같은 규칙).
 *                      상신 차단은 하지 않는다(기안 화면에서 confirm 을 거친 값) — 결재자가 보고 판단.
 *  - _lodging_allowance : 출장보고서의 선행 출장신청서가 '숙박 출장'이면 숙박출장수당 산정 내역
 *                      (일수 × 직급 단가, 귀속 급여월 분할). 급여대장은 승인 후 trip-allowance.ts 가 재산정한다.
 */

export interface RefCheckSnapshot {
  refDocId: string;
  refDocNo: string | null;
  refFormName: string;
  checkedAt: string;
  mismatches: RefMismatch[];
}

export async function assessRefLinkOnSubmit(txn: PgDatabase, docId: string): Promise<void> {
  const rows = rowsToObjects(
    await txn.exec(
      `SELECT d.form_id, d.field_values, d.drafter_employee_id, f.fields,
              rd.doc_id AS ref_doc_id, rd.doc_no AS ref_doc_no, rd.field_values AS ref_values, rf.name AS ref_form_name
         FROM approval_docs d
         JOIN approval_forms f ON f.form_id = d.form_id
         LEFT JOIN approval_docs rd ON rd.doc_id = d.ref_doc_id
         LEFT JOIN approval_forms rf ON rf.form_id = rd.form_id
        WHERE d.doc_id = $1`,
      [docId]
    )
  );
  if (!rows.length) return;
  const r = rows[0];
  const parse = (v: unknown): Record<string, unknown> => {
    try {
      const o = typeof v === "string" ? JSON.parse(v) : v;
      return o && typeof o === "object" ? (o as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const fv = parse(r.field_values);
  const next = { ...fv };
  delete next._ref_check;
  delete next._lodging_allowance;

  if (r.ref_doc_id != null && String(r.ref_doc_id)) {
    const refValues = parse(r.ref_values);
    const mismatches = compareWithRefDoc(parseFields(r.fields), fv, refValues, String(r.form_id));
    if (mismatches.length) {
      const snapshot: RefCheckSnapshot = {
        refDocId: String(r.ref_doc_id),
        refDocNo: r.ref_doc_no != null ? String(r.ref_doc_no) : null,
        refFormName: String(r.ref_form_name ?? ""),
        checkedAt: new Date().toISOString(),
        mismatches,
      };
      next._ref_check = snapshot;
    }
    // 출장보고서 — 선행 출장신청서가 숙박 출장이면 수당 산정 내역을 스냅샷(결재자 안내용).
    if (String(r.form_id) === TRIP_REPORT_FORM_ID && String(refValues.trip_class ?? "") === LODGING_TRIP_CLASS) {
      const period = parsePeriod(refValues.trip_period);
      const employeeId = r.drafter_employee_id != null ? String(r.drafter_employee_id) : null;
      if (period && employeeId) {
        const rules = await listTripLodgingRules();
        const rank = await employeeRankOrder(employeeId);
        const snap: LodgingAllowanceSnapshot | null = previewLodgingAllowance(period, rules, rank);
        if (snap) next._lodging_allowance = snap;
      }
    }
  }
  await txn.run(`UPDATE approval_docs SET field_values = $2::jsonb WHERE doc_id = $1`, [docId, JSON.stringify(next)]);
}
