import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { ActionConnector } from "@/lib/approval/actions";
import { recalcEntryTaxes } from "@/lib/payroll/generate";

/*
 * 상여금 지급 계획(frm-bonus-payment-plan, 223) 승인 커넥터 — 지급 귀속월의 별도 상여대장(ledger_kind='bonus')을
 * 작성 중(draft)으로 자동 생성한다. 각 인원 행은 지급 명세 표(rows)에서 오고 라인은 'bonus'(상여) 1건 +
 * 고용보험·소득세·지방세는 대장 엔진의 재산출(recalcEntryTaxes)로 채운다.
 * ⚠ 상여 단독 간이세액이므로 급여 합산 방식과 차이가 날 수 있다 — 관리자가 급여대장 화면에서 검토·수정 후 확정.
 * 멱등: 같은 귀속월 상여대장이 이미 있으면 draft 이고 같은 문서(plan_doc_id)거나 계획 문서가 없을 때만 다시 만든다(확정분은 보존).
 * ⚠ docs.ts 를 import 하지 않는다(순환 참조) — 기안 생성은 lib/payroll/bonus-plan.ts.
 */

export const BONUS_PAYMENT_PLAN_FORM_ID = "frm-bonus-payment-plan";

interface PlanRow {
  empNo: string | null;
  name: string;
  amount: number;
  memo: string | null;
}

const money = (v: unknown) => Math.round(Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0);

function parseRows(raw: unknown): PlanRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        empNo: o.emp_no != null && String(o.emp_no).trim() ? String(o.emp_no).trim() : null,
        name: String(o.name ?? "").trim(),
        amount: money(o.amount),
        memo: o.memo != null && String(o.memo).trim() ? String(o.memo).trim() : null,
      };
    })
    .filter((r) => r.name && r.amount > 0);
}

function parsePayMonth(raw: unknown): { payYear: number; payMonth: number } | null {
  const m = /^(\d{4})[-./]?(\d{1,2})/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const payYear = Number(m[1]);
  const payMonth = Number(m[2]);
  if (payMonth < 1 || payMonth > 12) return null;
  return { payYear, payMonth };
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 지급 명세 행 → 재직자 매칭(사번 우선, 없으면 성명 — 동명이인이면 미매칭 처리). */
async function matchEmployees(rows: PlanRow[]): Promise<Map<PlanRow, { employeeId: string; name: string; deptName: string | null; positionName: string | null } | null>> {
  const db = await getDb();
  const emps = rowsToObjects(
    await db.exec(
      `SELECT p.employee_id, p.employee_no, p.name, d.dept_name, pos.position_name
         FROM employee_profiles p
         LEFT JOIN departments d ON d.dept_id = p.dept_id
         LEFT JOIN positions pos ON pos.position_id = p.position_id
        WHERE p.status = 'active'`
    )
  );
  const byNo = new Map(emps.filter((e) => e.employee_no).map((e) => [String(e.employee_no), e]));
  const byName = new Map<string, Record<string, unknown>[]>();
  for (const e of emps) {
    const list = byName.get(String(e.name)) ?? [];
    list.push(e);
    byName.set(String(e.name), list);
  }
  const out = new Map<PlanRow, { employeeId: string; name: string; deptName: string | null; positionName: string | null } | null>();
  for (const r of rows) {
    let e: Record<string, unknown> | undefined;
    if (r.empNo && byNo.has(r.empNo)) e = byNo.get(r.empNo);
    else {
      const cands = byName.get(r.name) ?? [];
      if (cands.length === 1) e = cands[0];
    }
    out.set(
      r,
      e
        ? { employeeId: String(e.employee_id), name: String(e.name), deptName: e.dept_name ? String(e.dept_name) : null, positionName: e.position_name ? String(e.position_name) : null }
        : null
    );
  }
  return out;
}

export const bonusLedgerConnector: ActionConnector = {
  kind: "payroll.bonus_ledger",
  label: "상여대장 자동 생성",
  description: "승인된 상여금 지급 계획의 지급 명세로 해당 귀속월 상여대장(작성 중)을 만듭니다. 세액은 대장 엔진이 산출하며 급여대장 화면에서 검토·확정합니다.",
  slots: [
    { key: "pay_month", label: "지급 귀속월", required: true, hint: "text — YYYY-MM" },
    { key: "rows", label: "지급 명세", required: true, hint: "table — 사번·성명·지급액" },
    { key: "reason", label: "지급 사유" },
  ],
  async preview(ctx) {
    const ym = parsePayMonth(ctx.slot("pay_month"));
    if (!ym) return "지급 귀속월(YYYY-MM)을 해석하지 못해 실행이 실패합니다 — 슬롯 매핑을 확인하세요.";
    const rows = parseRows(ctx.slot("rows"));
    if (!rows.length) return "지급 명세에 금액이 있는 행이 없어 실행이 실패합니다.";
    const matched = await matchEmployees(rows);
    const miss = rows.filter((r) => !matched.get(r)).map((r) => r.name);
    const total = rows.reduce((a, r) => a + r.amount, 0);
    return `${ym.payYear}년 ${ym.payMonth}월 상여대장(작성 중)이 생성됩니다 — ${rows.length}명 · 총 ${total.toLocaleString("ko-KR")}원` +
      (miss.length ? ` / 재직자 미매칭 ${miss.length}명(${miss.join(", ")})은 제외됩니다.` : "");
  },
  async run(ctx) {
    const ym = parsePayMonth(ctx.slot("pay_month"));
    if (!ym) throw new Error("지급 귀속월(YYYY-MM)을 해석하지 못했습니다.");
    const rows = parseRows(ctx.slot("rows"));
    if (!rows.length) throw new Error("지급 명세에 금액이 있는 행이 없습니다.");
    const reason = String(ctx.slot("reason") ?? "상여").trim() || "상여";
    const matched = await matchEmployees(rows);
    const db = await getDb();
    const existing = rowsToObjects(
      await db.exec(
        `SELECT ledger_id, status, plan_doc_id FROM payroll_ledgers WHERE pay_year = $1 AND pay_month = $2 AND ledger_kind = 'bonus'`,
        [ym.payYear, ym.payMonth]
      )
    )[0];
    if (existing) {
      if (String(existing.status) !== "draft") {
        throw new Error(`${ym.payYear}년 ${ym.payMonth}월 상여대장이 이미 확정되어 있어 자동 생성하지 않았습니다(급여대장 화면에서 수기 처리).`);
      }
      if (existing.plan_doc_id && String(existing.plan_doc_id) !== ctx.docId) {
        throw new Error(`${ym.payYear}년 ${ym.payMonth}월 상여대장(작성 중)이 다른 지급 계획 문서로 만들어져 있습니다 — 먼저 삭제하세요.`);
      }
    }
    const ledgerId = existing ? String(existing.ledger_id) : newId("pled");
    const now = new Date().toISOString();
    const entryIds: string[] = [];
    const skipped: string[] = [];
    await withDbWrite(async (txn) => {
      if (existing) await txn.exec(`DELETE FROM payroll_ledgers WHERE ledger_id = $1`, [ledgerId]);
      await txn.exec(
        `INSERT INTO payroll_ledgers
           (ledger_id, pay_year, pay_month, ledger_kind, title, source, status, note, plan_doc_id, created_by, created_at)
         VALUES ($1,$2,$3,'bonus',$4,'app','draft',$5,$6,$7,$8)`,
        [
          ledgerId, ym.payYear, ym.payMonth,
          `${ym.payYear}년 ${ym.payMonth}월분 상여대장(${reason})`,
          `상여금 지급 계획 ${ctx.docNo ?? ctx.docId} 승인으로 자동 생성 — 세액 검토 후 확정`,
          ctx.docId, ctx.drafterUserId, now,
        ]
      );
      let order = 0;
      for (const r of rows) {
        const emp = matched.get(r);
        if (!emp) {
          skipped.push(r.name);
          continue;
        }
        const entryId = newId("pent");
        order += 1;
        await txn.exec(
          `INSERT INTO payroll_entries
             (entry_id, ledger_id, employee_id, name, dept_name, position_name, pay_total, deduction_total, net_pay, row_order, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,0,$7,$8,$9)`,
          [entryId, ledgerId, emp.employeeId, emp.name, emp.deptName, emp.positionName, r.amount, order, r.memo]
        );
        await txn.exec(`INSERT INTO payroll_entry_lines (line_id, entry_id, item_id, amount) VALUES ($1,$2,'bonus',$3)`, [newId("plin"), entryId, r.amount]);
        entryIds.push(entryId);
      }
    });
    // 세액 산출(고용보험·소득세·지방세) — 행별, 실패해도 대장은 남는다(관리자 재계산 가능).
    let taxed = 0;
    for (const entryId of entryIds) {
      try {
        await recalcEntryTaxes(entryId);
        taxed += 1;
      } catch {
        // 무시 — 검토 시 재계산
      }
    }
    return {
      detail:
        `${ym.payYear}년 ${ym.payMonth}월 상여대장(작성 중) 생성 — ${entryIds.length}명, 세액 산출 ${taxed}명` +
        (skipped.length ? ` / 재직자 미매칭 제외: ${skipped.join(", ")}` : "") +
        ". 급여대장 화면에서 소득세(상여 단독 간이세액)를 검토·확정하세요.",
      result: { ledgerId, entries: entryIds.length, skipped },
    };
  },
};
