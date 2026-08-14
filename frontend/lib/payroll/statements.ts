import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { sendMail } from "@/lib/mail/send";
import { getOvertimeRates, ordinaryHourlyWages } from "@/lib/payroll/overtime";
import { resolveEmployeeId } from "@/lib/payroll/sign";
import type { PayslipPdfInput } from "@/lib/payroll/statement-pdf";

/**
 * 급여명세서 개인 발송 (블루프린트 §4-1 후속, 근로기준법 제48조② 교부)
 * - 대상: 확정(confirmed) 대장의 직원 매칭 행. 명세서 PDF는 라인에서 온디맨드 렌더(파일 무저장).
 * - 교부: 앱 홈 "내 급여명세서" 카드에서 열람(사내 전산망 교부) + 메일은 도착 알림만
 *   (임금 기밀 — 계약서 발송과 동일 기조, §8-7).
 */

export interface StatementTarget {
  entryId: string;
  employeeId: string | null;
  name: string;
  deptName: string | null;
  email: string | null;
  netPay: number;
  sentAt: string | null;
}

export interface MyPayslip {
  entryId: string;
  payYear: number;
  payMonth: number;
  payTotal: number;
  deductionTotal: number;
  netPay: number;
  sentAt: string | null;
}

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** 지급일 — 해당 월 말일(급여 말일 지급 관행, §8-6) */
function payDateOf(payYear: number, payMonth: number): string {
  const last = new Date(Date.UTC(payYear, payMonth, 0)).getUTCDate();
  return `${payYear}-${String(payMonth).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/** 확정 대장의 명세서 발송 대상·이력 */
export async function listStatementTargets(ledgerId: string): Promise<{
  ledger: { ledgerId: string; payYear: number; payMonth: number; status: string } | null;
  targets: StatementTarget[];
}> {
  const db = await getDb();
  const lg = rowsToObjects(
    await db.exec(
      `SELECT ledger_id, pay_year, pay_month, status FROM payroll_ledgers WHERE ledger_id = $1`,
      [ledgerId]
    )
  )[0];
  if (!lg) return { ledger: null, targets: [] };
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.entry_id, e.employee_id, e.name, e.dept_name, e.net_pay, e.statement_sent_at, p.email
         FROM payroll_entries e
         LEFT JOIN employee_profiles p ON p.employee_id = e.employee_id
        WHERE e.ledger_id = $1
        ORDER BY e.row_order`,
      [ledgerId]
    )
  );
  return {
    ledger: {
      ledgerId: String(lg.ledger_id),
      payYear: Number(lg.pay_year),
      payMonth: Number(lg.pay_month),
      status: String(lg.status),
    },
    targets: rows.map((r) => ({
      entryId: String(r.entry_id),
      employeeId: r.employee_id ? String(r.employee_id) : null,
      name: String(r.name),
      deptName: r.dept_name ? String(r.dept_name) : null,
      email: r.email ? String(r.email) : null,
      netPay: toNum(r.net_pay),
      sentAt: r.statement_sent_at ? String(r.statement_sent_at) : null,
    })),
  };
}

/** 명세서 PDF 입력 구성 — 항목 정렬은 항목 사전 display_order 기준 */
export async function buildPayslipInput(entryId: string): Promise<PayslipPdfInput> {
  const db = await getDb();
  const head = rowsToObjects(
    await db.exec(
      // 부서·직급은 매칭 직원이면 현재 프로필 값을 우선한다(대장 스냅샷은 공란·구값이 잦음, PL-P1 관례).
      `SELECT e.entry_id, e.employee_id, e.name, e.emp_no,
              COALESCE(d.dept_name, e.dept_name) AS dept_name,
              COALESCE(pos.position_name, e.position_name) AS position_name,
              e.pay_total, e.deduction_total, e.net_pay,
              lg.pay_year, lg.pay_month, lg.status,
              p.employee_no
         FROM payroll_entries e
         JOIN payroll_ledgers lg ON lg.ledger_id = e.ledger_id
         LEFT JOIN employee_profiles p ON p.employee_id = e.employee_id
         LEFT JOIN departments d ON d.dept_id = p.dept_id
         LEFT JOIN positions pos ON pos.position_id = p.position_id
        WHERE e.entry_id = $1`,
      [entryId]
    )
  )[0];
  if (!head) throw Object.assign(new Error("명세서 대상을 찾을 수 없습니다."), { status: 404 });

  const lines = rowsToObjects(
    await db.exec(
      `SELECT d.name, d.kind, l.amount
         FROM payroll_entry_lines l
         JOIN payroll_item_defs d ON d.item_id = l.item_id
        WHERE l.entry_id = $1 AND l.amount <> 0
        ORDER BY d.display_order, d.name`,
      [entryId]
    )
  );
  const payLines = lines
    .filter((l) => String(l.kind) === "pay")
    .map((l) => ({ name: String(l.name), amount: toNum(l.amount) }));
  const dedLines = lines
    .filter((l) => String(l.kind) === "deduction")
    .map((l) => ({ name: String(l.name), amount: toNum(l.amount) }));

  const payYear = Number(head.pay_year);
  const payMonth = Number(head.pay_month);

  // 계산 방법(법정 기재) — 초과근무수당은 귀속 구간 근태 시간과 통상시급으로 산출식을 명시한다.
  const notes: string[] = [];
  const overtimeLine = payLines.find((l) => l.name === "초과근무수당");
  if (overtimeLine && head.employee_id) {
    const rates = await getOvertimeRates();
    const from = new Date(Date.UTC(payYear, payMonth - 2, 26)).toISOString().slice(0, 10);
    const to = `${payYear}-${String(payMonth).padStart(2, "0")}-25`;
    const att = rowsToObjects(
      await db.exec(
        `SELECT sum(overtime_day_minutes) AS day_min, sum(overtime_night_minutes) AS night_min
           FROM attendance_weekly
          WHERE employee_id = $1 AND (week_start + 6) >= $2::date AND (week_start + 6) <= $3::date`,
        [String(head.employee_id), from, to]
      )
    )[0];
    const hourly = (await ordinaryHourlyWages(rates.divisorHours)).get(String(head.employee_id));
    const dayH = toNum(att?.day_min) / 60;
    const nightH = toNum(att?.night_min) / 60;
    if (hourly && dayH + nightH > 0) {
      notes.push(
        `초과근무수당 = 통상시급 ${Math.round(hourly).toLocaleString("ko-KR")}원 × ` +
          `(연장 ${dayH.toFixed(1)}h × ${rates.rateDay} + 야간 ${nightH.toFixed(1)}h × ${rates.rateNight})` +
          ` — 산정 기간 ${from} ~ ${to}`
      );
      notes.push(`통상시급 = 통상임금 월액 ÷ ${rates.divisorHours}시간(월 소정근로시간)`);
    } else {
      // 근태·계약 데이터가 없어 상세 산출식을 만들 수 없는 경우에도 계산방법은 반드시 기재한다(법정 필수).
      notes.push(
        `초과근무수당 = 통상시급(통상임금 월액 ÷ ${rates.divisorHours}시간) × ` +
          `(연장 근로시간 × ${rates.rateDay} + 야간 근로시간 × ${rates.rateNight})` +
          ` — 산정 기간 ${from} ~ ${to}`
      );
    }
  }
  if (dedLines.some((l) => l.name === "소득세")) {
    notes.push("소득세 = 근로소득 간이세액표(월 과세급여·공제대상 가족수 기준), 지방소득세 = 소득세의 10%");
  }
  if (dedLines.some((l) => ["국민연금", "건강보험", "장기요양보험료"].includes(l.name))) {
    notes.push("국민연금·건강보험·장기요양보험료는 공단 고지 금액을 반영했습니다.");
  }
  notes.push("문의: 경영지원팀 — 명세서 내용에 이견이 있으면 지급일로부터 14일 이내에 알려주시기 바랍니다.");

  return {
    payYear,
    payMonth,
    employeeName: String(head.name),
    empNo: (head.employee_no ?? head.emp_no) ? String(head.employee_no ?? head.emp_no) : null,
    deptName: head.dept_name ? String(head.dept_name) : null,
    positionName: head.position_name ? String(head.position_name) : null,
    payDate: payDateOf(payYear, payMonth),
    payLines,
    dedLines,
    payTotal: toNum(head.pay_total),
    deductionTotal: toNum(head.deduction_total),
    netPay: toNum(head.net_pay),
    notes,
  };
}

/** 발송 — 확정 대장만. 직원 매칭 행 대상, 메일은 도착 알림(열람 링크)만. */
export async function sendStatements(
  ledgerId: string,
  actorUserId: string,
  appBaseUrl: string,
  options?: { resend?: boolean }
): Promise<{ sent: number; skipped: Array<{ name: string; reason: string }> }> {
  const { ledger, targets } = await listStatementTargets(ledgerId);
  if (!ledger) throw Object.assign(new Error("대장을 찾을 수 없습니다."), { status: 404 });
  if (ledger.status !== "confirmed") {
    throw Object.assign(new Error("확정된 대장만 명세서를 발송할 수 있습니다."), { status: 400 });
  }
  const now = new Date().toISOString();
  const label = `${ledger.payYear}년 ${ledger.payMonth}월분`;
  let sent = 0;
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const t of targets) {
    if (!t.employeeId) {
      skipped.push({ name: t.name, reason: "직원 미매칭(퇴사자 등)" });
      continue;
    }
    if (t.sentAt && !options?.resend) continue; // 재발송이 아니면 기존 발송분은 건너뜀
    await withDbWrite(async (db) => {
      await db.exec(`UPDATE payroll_entries SET statement_sent_at = $2 WHERE entry_id = $1`, [t.entryId, now]);
    });
    sent += 1;
    if (!t.email) {
      skipped.push({ name: t.name, reason: "이메일 미등록(앱 수신함으로만 교부)" });
      continue;
    }
    const res = await sendMail({
      userId: actorUserId,
      to: [{ name: t.name, address: t.email }],
      subject: `[한국환경안전연구원] ${label} 급여명세서`,
      bodyHtml: `<p>${t.name} 님, ${label} 급여명세서가 발행되었습니다.</p>
<p>MCM 홈 화면의 <b>내 급여명세서</b> 카드에서 내용을 확인하고 내려받을 수 있습니다.</p>
<p><a href="${appBaseUrl}/home">급여명세서 확인하기</a></p>
<p style="color:#888;font-size:12px">본 메일에는 보안상 명세서 파일이 첨부되지 않습니다. 앱에서 열람해 주세요.</p>`,
      idempotencyKey: `payslip-send:${t.entryId}:${now.slice(0, 10)}`,
    });
    if (!res.ok) skipped.push({ name: t.name, reason: `메일 실패: ${res.error ?? ""}` });
  }
  return { sent, skipped };
}

/** 본인 명세서 목록(발송분만) — 홈 수신함 카드 */
export async function listMyPayslips(userId: string): Promise<{ rows: MyPayslip[]; linked: boolean }> {
  const employeeId = await resolveEmployeeId(userId);
  if (!employeeId) return { rows: [], linked: false };
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.entry_id, lg.pay_year, lg.pay_month, e.pay_total, e.deduction_total, e.net_pay, e.statement_sent_at
         FROM payroll_entries e
         JOIN payroll_ledgers lg ON lg.ledger_id = e.ledger_id
        WHERE e.employee_id = $1 AND e.statement_sent_at IS NOT NULL
        ORDER BY lg.pay_year DESC, lg.pay_month DESC
        LIMIT 24`,
      [employeeId]
    )
  );
  return {
    linked: true,
    rows: rows.map((r) => ({
      entryId: String(r.entry_id),
      payYear: Number(r.pay_year),
      payMonth: Number(r.pay_month),
      payTotal: toNum(r.pay_total),
      deductionTotal: toNum(r.deduction_total),
      netPay: toNum(r.net_pay),
      sentAt: r.statement_sent_at ? String(r.statement_sent_at) : null,
    })),
  };
}

/** 본인 명세서 열람 권한 확인 — 발송된 본인 행만 */
export async function assertOwnPayslip(userId: string, entryId: string): Promise<void> {
  const employeeId = await resolveEmployeeId(userId);
  if (!employeeId) throw Object.assign(new Error("직원 연결이 없는 계정입니다."), { status: 403 });
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT 1 FROM payroll_entries
        WHERE entry_id = $1 AND employee_id = $2 AND statement_sent_at IS NOT NULL`,
      [entryId, employeeId]
    )
  );
  if (!rows.length) throw Object.assign(new Error("본인에게 발행된 명세서만 열람할 수 있습니다."), { status: 403 });
}
