import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { ActionConnector } from "@/lib/approval/actions";

/*
 * 퇴직 정산 골격(FRM-P5, 207) — 퇴사자별 1건(severance_settlements).
 * 연차수당 지급 신청서 승인 → 커넥터가 대상자 레코드에 지급 대상액 자동 기입(upsert).
 * 퇴직금 자동 산정(평균임금·근속·퇴직소득세)은 후속 블루프린트 — 화면에서 수기 입력.
 */

export interface SeveranceRow {
  settleId: string;
  employeeId: string;
  employeeName: string | null;
  deptName: string | null;
  resignDate: string | null;
  leavePayDays: number | null;
  leavePayAmount: number | null;
  leavePayDocNo: string | null;
  severanceAmount: number | null;
  status: string;
  note: string | null;
  updatedAt: string;
}

function mapRow(r: Record<string, unknown>): SeveranceRow {
  return {
    settleId: String(r.settle_id),
    employeeId: String(r.employee_id),
    employeeName: r.employee_name != null ? String(r.employee_name) : null,
    deptName: r.dept_name != null ? String(r.dept_name) : null,
    resignDate: r.resign_date != null ? String(r.resign_date) : null,
    leavePayDays: r.leave_pay_days != null ? Number(r.leave_pay_days) : null,
    leavePayAmount: r.leave_pay_amount != null ? Number(r.leave_pay_amount) : null,
    leavePayDocNo: r.leave_pay_doc_no != null ? String(r.leave_pay_doc_no) : null,
    severanceAmount: r.severance_amount != null ? Number(r.severance_amount) : null,
    status: String(r.status),
    note: r.note != null ? String(r.note) : null,
    updatedAt: String(r.updated_at),
  };
}

export async function listSeveranceSettlements(): Promise<SeveranceRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT s.*, d.dept_name FROM severance_settlements s
         LEFT JOIN employee_profiles e ON e.employee_id = s.employee_id
         LEFT JOIN departments d ON d.dept_id = e.dept_id
        ORDER BY s.resign_date DESC NULLS LAST, s.updated_at DESC`
    )
  );
  return rows.map(mapRow);
}

/** 퇴직금 수기 입력·정산 상태 갱신 — 재무 퇴직 정산 화면. */
export async function updateSeveranceSettlement(params: {
  settleId: string;
  severanceAmount?: number | null;
  note?: string | null;
  status?: "draft" | "confirmed";
  actorUserId: string;
}): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(
      `UPDATE severance_settlements
          SET severance_amount = COALESCE($2, severance_amount),
              note = COALESCE($3, note),
              status = COALESCE($4, status),
              updated_by = $5, updated_at = $6
        WHERE settle_id = $1`,
      [params.settleId, params.severanceAmount ?? null, params.note ?? null, params.status ?? null, params.actorUserId, new Date().toISOString()]
    );
  });
}

/* ---------- FRM-P0 커넥터 ---------- */

/** 연차수당 승인 → 대상자 퇴직 정산 레코드 upsert(연차수당 기입). */
export const recordLeavePayConnector: ActionConnector = {
  kind: "hr.record_leave_pay",
  label: "퇴직 정산 연차수당 기입",
  description: "승인된 연차수당 지급 신청서의 지급 대상액을 대상자 퇴직 정산 자료에 기록합니다.",
  slots: [
    { key: "person", label: "대상자", required: true, hint: "user_select — {employeeId,name}[]" },
    { key: "resign_date", label: "퇴사(예정)일" },
    { key: "days", label: "잔여 연차일수" },
    { key: "amount", label: "지급 대상액", required: true },
  ],
  async run(ctx) {
    const personRaw = ctx.slot("person");
    const person = Array.isArray(personRaw) ? (personRaw[0] as { employeeId?: string; name?: string } | undefined) : undefined;
    const employeeId = person?.employeeId ? String(person.employeeId) : null;
    if (!employeeId) throw new Error("대상자 정보를 해석하지 못했습니다.");
    const amount = Math.round(Number(String(ctx.slot("amount") ?? "").replace(/[^\d.-]/g, "")) || 0);
    if (amount <= 0) throw new Error("지급 대상액이 올바르지 않습니다.");
    const days = Number(String(ctx.slot("days") ?? "").replace(/[^\d.]/g, "")) || null;
    const resignDate = String(ctx.slot("resign_date") ?? "").slice(0, 10) || null;
    const now = new Date().toISOString();
    await withDbWrite(async (txn) => {
      await txn.run(
        `INSERT INTO severance_settlements
           (settle_id, employee_id, employee_name, resign_date, leave_pay_days, leave_pay_amount, leave_pay_doc_id, leave_pay_doc_no, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $9)
         ON CONFLICT (employee_id) DO UPDATE SET
           employee_name = EXCLUDED.employee_name,
           resign_date = COALESCE(EXCLUDED.resign_date, severance_settlements.resign_date),
           leave_pay_days = EXCLUDED.leave_pay_days,
           leave_pay_amount = EXCLUDED.leave_pay_amount,
           leave_pay_doc_id = EXCLUDED.leave_pay_doc_id,
           leave_pay_doc_no = EXCLUDED.leave_pay_doc_no,
           updated_at = EXCLUDED.updated_at`,
        [
          `svs-${crypto.randomBytes(6).toString("hex")}`,
          employeeId,
          person?.name ? String(person.name) : null,
          resignDate,
          days,
          amount,
          ctx.docId,
          ctx.docNo,
          now,
        ]
      );
    });
    return {
      detail: `퇴직 정산 기입 — ${person?.name ?? employeeId} 연차수당 ${amount.toLocaleString("ko-KR")}원${days ? ` (${days}일)` : ""}`,
      result: { employeeId, amount },
    };
  },
};
