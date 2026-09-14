import { getDb, rowsToObjects } from "@/lib/db";
import { saveDoc } from "@/lib/approval/docs";
import { BONUS_PAYMENT_PLAN_FORM_ID } from "@/lib/payroll/bonus-ledger";

/**
 * 상여금 지급 계획 기안(사규 별표 4 — 명절 상여·하계휴가비 등, 2026-09-14)
 * - 급여대장 화면의 [상여금 지급 계획] 모달에서 사유·귀속월·적용 방식(일괄 동액 / 개별 차등)·대상자를 정하면
 *   지급 명세 표가 채워진 draft 문서를 만들고 기안 화면으로 보낸다(성과급 지급 계획 lib/bonus/draft.ts 관례).
 * - 결재선 = 대표이사 직결. 상신은 기안 화면에서 검토 후 사용자가 직접.
 * - 승인되면 payroll.bonus_ledger 커넥터가 귀속월 상여대장(작성 중)을 자동 생성한다.
 */

export interface BonusPlanTarget {
  employeeId: string;
  amount?: number;
  memo?: string | null;
}

export interface BonusPlanInput {
  payMonth: string; // YYYY-MM
  reason: string; // 설 명절 상여 등(양식 select 옵션)
  mode: "uniform" | "individual";
  uniformAmount?: number;
  targets: BonusPlanTarget[];
  note?: string | null;
}

async function findCeoUserId(): Promise<string | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT u.user_id
         FROM users u
         LEFT JOIN employee_profiles e1 ON e1.employee_id = u.employee_id
         LEFT JOIN employee_profiles e2 ON e2.user_id = u.user_id
        WHERE e1.position_id = 'ceo' OR e2.position_id = 'ceo'
        LIMIT 1`
    )
  );
  return rows[0]?.user_id ? String(rows[0].user_id) : null;
}

/** 대상자 후보 — 재직자 전원(부서·직함·사번). 모달 초기 목록. */
export async function listBonusPlanCandidates(): Promise<Array<{ employeeId: string; empNo: string | null; name: string; deptName: string | null; positionName: string | null }>> {
  const db = await getDb();
  return rowsToObjects(
    await db.exec(
      `SELECT p.employee_id, p.employee_no, p.name, d.dept_name, pos.position_name
         FROM employee_profiles p
         LEFT JOIN departments d ON d.dept_id = p.dept_id
         LEFT JOIN positions pos ON pos.position_id = p.position_id
        WHERE p.status = 'active'
        ORDER BY d.display_order NULLS LAST, pos.rank_order DESC NULLS LAST, p.name`
    )
  ).map((r) => ({
    employeeId: String(r.employee_id),
    empNo: r.employee_no ? String(r.employee_no) : null,
    name: String(r.name),
    deptName: r.dept_name ? String(r.dept_name) : null,
    positionName: r.position_name ? String(r.position_name) : null,
  }));
}

export async function createBonusPaymentPlanDraft(actorUserId: string, input: BonusPlanInput): Promise<{ docId: string; headcount: number; total: number }> {
  if (!/^\d{4}-\d{2}$/.test(input.payMonth)) throw Object.assign(new Error("지급 귀속월은 YYYY-MM 형식이어야 합니다."), { status: 400 });
  if (!input.targets.length) throw Object.assign(new Error("대상자를 1명 이상 선택하세요."), { status: 400 });
  if (input.mode === "uniform" && !(Number(input.uniformAmount) > 0)) {
    throw Object.assign(new Error("일괄 동액 방식은 일괄 지급액이 필요합니다."), { status: 400 });
  }
  const ceoUserId = await findCeoUserId();
  if (!ceoUserId) throw Object.assign(new Error("대표이사 계정을 찾을 수 없습니다(직급 'ceo'와 사용자 연결 필요)."), { status: 400 });

  const candidates = new Map((await listBonusPlanCandidates()).map((c) => [c.employeeId, c]));
  const fmt = (v: number) => Math.round(v).toLocaleString("ko-KR");
  const rows: Array<Record<string, string>> = [];
  let total = 0;
  for (const t of input.targets) {
    const c = candidates.get(t.employeeId);
    if (!c) continue;
    const amount = input.mode === "uniform" ? Math.round(Number(input.uniformAmount)) : Math.round(Number(t.amount ?? 0));
    if (!(amount > 0)) continue;
    total += amount;
    rows.push({
      emp_no: c.empNo ?? "",
      name: c.name,
      dept: c.deptName ?? "-",
      position: c.positionName ?? "-",
      amount: fmt(amount),
      memo: t.memo ?? "",
    });
  }
  if (!rows.length) throw Object.assign(new Error("지급액이 있는 대상자가 없습니다."), { status: 400 });

  const [y, m] = input.payMonth.split("-");
  const docId = await saveDoc({
    docId: null,
    formId: BONUS_PAYMENT_PLAN_FORM_ID,
    title: `${y}년 ${Number(m)}월 ${input.reason} 지급 계획`,
    urgent: false,
    fieldValues: {
      pay_reason: input.reason,
      pay_month: input.payMonth,
      apply_mode: input.mode === "uniform" ? "일괄 동액" : "개별 차등",
      uniform_amount: input.mode === "uniform" ? fmt(Number(input.uniformAmount)) : "",
      headcount: rows.length,
      total: fmt(total),
      rows,
      note: input.note ?? "",
    },
    line: [{ stepType: "approve", assigneeUserId: ceoUserId }],
    actorUserId,
  });
  return { docId, headcount: rows.length, total };
}
