import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getEdiAmounts } from "@/lib/payroll/edi";
import { overtimeAmounts } from "@/lib/payroll/overtime";
import { activeRulesFor } from "@/lib/payroll/rules";
import { NON_TAXABLE_ITEMS, calcEmploymentIns, getInsuranceRate, lookupIncomeTax } from "@/lib/payroll/tax";

/** 귀속월 말일 기준 만 나이 — 생일 월이 지나야 도달(같은 달이면 도달로 간주) */
function fullAge(birthDate: string, payYear: number, payMonth: number): number | null {
  const m = birthDate.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  return payYear - Number(m[1]) - (payMonth < Number(m[2]) ? 1 : 0);
}

/**
 * 신규 급여대장 생성 엔진 (PL-P4, 블루프린트 §4-1·§6·§6-2 C)
 * 플로우: 전월 복사(고정 지급 항목) → 수당 규칙 반영 → 초과근무수당 자동(§6)
 *        → EDI 고지액(국민연금·건강·요양·정산) → 고용보험·소득세·지방세 산출 → draft → 편집 → 확정.
 * 공제 소스(실증): EDI=nps·nhis·ltc·정산 / 산식=ei·ltc검증·소득세·지방세 / 규칙=학자금 등.
 */

/** 전월에서 복사하지 않는 변동 지급 항목 — 자동 산출(overtime)·수기 입력 대상 */
const VOLATILE_PAY_ITEMS = new Set([
  "overtime", "overtime-meal", "annual-leave", "incentive", "prev-unpaid", "bonus",
  "misc-pay", "trip", "expense-settle", "key-talent", "unlabeled-pay",
]);

export interface GeneratedLine {
  itemId: string;
  amount: number;
  source: "copy" | "rule" | "overtime" | "edi" | "calc";
}

export interface GeneratedEntry {
  employeeId: string;
  name: string;
  deptName: string | null;
  positionName: string | null;
  lines: GeneratedLine[];
  payTotal: number;
  deductionTotal: number;
  netPay: number;
  warnings: string[];
}

export interface GeneratePreview {
  payYear: number;
  payMonth: number;
  baseLedger: { ledgerId: string; payYear: number; payMonth: number } | null;
  ediReady: { nhis: boolean; nps: boolean };
  entries: GeneratedEntry[];
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** 생성 계산(공통) — preview/create 양쪽에서 사용 */
export async function buildLedger(payYear: number, payMonth: number): Promise<GeneratePreview> {
  const db = await getDb();
  // 기준(전월) 대장 — 직전 salary 대장(최대 3개월 소급)
  const base = rowsToObjects(
    await db.exec(
      `SELECT ledger_id, pay_year, pay_month FROM payroll_ledgers
        WHERE ledger_kind = 'salary' AND (pay_year, pay_month) < ($1, $2)
        ORDER BY pay_year DESC, pay_month DESC LIMIT 1`,
      [payYear, payMonth]
    )
  )[0];

  const employees = rowsToObjects(
    await db.exec(
      `SELECT p.employee_id, p.name, p.birth_date, d.dept_name, pos.position_name, pos.rank_order
         FROM employee_profiles p
         LEFT JOIN departments d ON d.dept_id = p.dept_id
         LEFT JOIN positions pos ON pos.position_id = p.position_id
        WHERE p.status = 'active'
        ORDER BY d.display_order NULLS LAST, pos.rank_order DESC NULLS LAST, p.name`
    )
  );

  // 전월 라인(직원 매칭분만)
  const prevLines = new Map<string, Record<string, number>>();
  if (base) {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT e.employee_id, l.item_id, l.amount
           FROM payroll_entries e
           JOIN payroll_entry_lines l ON l.entry_id = e.entry_id
          WHERE e.ledger_id = $1 AND e.employee_id IS NOT NULL`,
        [String(base.ledger_id)]
      )
    );
    for (const r of rows) {
      const m = prevLines.get(String(r.employee_id)) ?? {};
      m[String(r.item_id)] = toNum(r.amount);
      prevLines.set(String(r.employee_id), m);
    }
  }

  const itemKinds = new Map<string, string>(
    rowsToObjects(await db.exec(`SELECT item_id, kind FROM payroll_item_defs`)).map((r) => [
      String(r.item_id), String(r.kind),
    ])
  );
  const rules = await activeRulesFor(payYear, payMonth);
  const edi = await getEdiAmounts(payYear, payMonth);
  const overtime = await overtimeAmounts(payYear, payMonth);
  const taxProfiles = new Map(
    rowsToObjects(
      await db.exec(
        `SELECT employee_id, withholding_rate, dependents, child_deduction, special_relation FROM payroll_tax_profiles`
      )
    ).map((r) => [
      String(r.employee_id),
      {
        rate: Number(r.withholding_rate ?? 100),
        dep: Number(r.dependents ?? 1),
        child: Number(r.child_deduction ?? 0),
        special: Number(r.special_relation ?? 0) === 1,
      },
    ])
  );
  const eiExemptAge = await getInsuranceRate("ei-exempt-age", payYear, payMonth).catch(() => 65);
  // 신규 입사자(전월 대장에 없음) 폴백 — 최신 계약 임금 구성
  const latestWage = new Map<string, Record<string, number>>(
    rowsToObjects(
      await db.exec(
        `SELECT DISTINCT ON (employee_id) employee_id, wage_components
           FROM labor_contracts WHERE status <> 'void' AND wage_components IS NOT NULL
          ORDER BY employee_id, contract_date DESC NULLS LAST, created_at DESC`
      )
    ).map((r) => [String(r.employee_id), (r.wage_components ?? {}) as Record<string, number>])
  );
  const itemIdByName = new Map<string, string>(
    rowsToObjects(await db.exec(`SELECT item_id, name FROM payroll_item_defs`)).map((r) => [
      String(r.name), String(r.item_id),
    ])
  );

  const entries: GeneratedEntry[] = [];
  for (const emp of employees) {
    const empId = String(emp.employee_id);
    const warnings: string[] = [];
    const lineMap = new Map<string, GeneratedLine>();
    const put = (itemId: string, amount: number, source: GeneratedLine["source"]) => {
      if (amount === 0) return;
      lineMap.set(itemId, { itemId, amount, source });
    };

    // 1) 전월 고정 지급 복사
    const prev = prevLines.get(empId);
    if (prev) {
      for (const [itemId, amount] of Object.entries(prev)) {
        if (itemKinds.get(itemId) !== "pay" || VOLATILE_PAY_ITEMS.has(itemId)) continue;
        put(itemId, amount, "copy");
      }
    } else {
      // 신규 입사자: 최신 계약 임금 구성으로 기본 지급 구성
      const wage = latestWage.get(empId);
      if (wage) {
        for (const [name, amount] of Object.entries(wage)) {
          const itemId = itemIdByName.get(name);
          if (!itemId || itemKinds.get(itemId) !== "pay") continue;
          put(itemId, toNum(amount), "copy");
        }
        warnings.push("전월 대장에 없어 최신 근로계약 임금 구성으로 생성");
      } else {
        warnings.push("전월 대장·근로계약 모두 없음 — 지급 항목 수기 입력 필요");
      }
    }

    // 2) 수당 규칙 반영(같은 항목이면 규칙이 우선)
    for (const rule of rules.get(empId) ?? []) {
      put(rule.itemId, rule.amount, "rule");
    }

    // 3) 초과근무수당 자동 — 승인된 신청서 기준(근태 있으면 대조 캡, §6)
    const ot = overtime.get(empId);
    if (ot && ot.amount > 0) {
      put("overtime", ot.amount, "overtime");
      if (ot.basis === "requested") {
        warnings.push("초과근무: 근태 기록이 없어 승인 신청 시간으로 산정");
      } else if (ot.cappedMin > 0) {
        warnings.push(`초과근무: 근태 대조로 ${Math.round(ot.cappedMin / 60 * 10) / 10}h 차감`);
      }
    } else if (ot && ot.basis === "attendance") {
      warnings.push("초과근무: 근태 기록은 있으나 승인된 신청서가 없어 미산정");
    }

    // 4) EDI 고지액(국민연금·건강·요양·정산)
    const notice = edi.get(empId) ?? edi.get(`name:${String(emp.name)}`);
    if (notice) {
      if (notice.nps) put("nps", notice.nps, "edi");
      if (notice.nhis) put("nhis", notice.nhis, "edi");
      if (notice.ltc) put("ltc", notice.ltc, "edi");
      if (notice.nhisSettle) put("settle-nhis", notice.nhisSettle, "edi");
      if (notice.ltcSettle) put("settle-ltc", notice.ltcSettle, "edi");
    } else {
      warnings.push("EDI 고지내역 없음(국민연금·건강·요양 미기입)");
    }

    // 5) 과세급여 → 고용보험·소득세·지방세
    const payLines = [...lineMap.values()].filter((l) => itemKinds.get(l.itemId) === "pay");
    const payTotalPre = payLines.reduce((a, l) => a + l.amount, 0);
    const nonTaxable = payLines
      .filter((l) => (NON_TAXABLE_ITEMS as readonly string[]).includes(l.itemId))
      .reduce((a, l) => a + l.amount, 0);
    const taxable = payTotalPre - nonTaxable;
    // 고용보험 면제: 만 65세 이상(설정 연령, 실측: 이유억 등 0원) 또는 특수관계인(가입 제외 관행)
    const tpMeta = taxProfiles.get(empId);
    const age = emp.birth_date ? fullAge(String(emp.birth_date), payYear, payMonth) : null;
    const eiExempt = (age != null && age >= eiExemptAge) || !!tpMeta?.special;
    if (taxable > 0) {
      if (tpMeta?.special) warnings.push("특수관계인 — 고용보험 산출 제외");
      else if (eiExempt) warnings.push(`만 ${eiExemptAge}세 이상 — 고용보험(실업급여분) 면제 적용`);
      if (!eiExempt) put("ei", await calcEmploymentIns(taxable, payYear, payMonth), "calc");
      const tp = taxProfiles.get(empId) ?? { rate: 100, dep: 1, child: 0 };
      const tax = await lookupIncomeTax(taxable, tp.dep, tp.child, tp.rate);
      if (tax.outOfTable) {
        warnings.push("월급여가 간이세액표 범위(1,000만원) 초과 — 소득세 수기 입력 필요");
      } else {
        if (tax.incomeTax) put("income-tax", tax.incomeTax, "calc");
        if (tax.localTax) put("local-tax", tax.localTax, "calc");
      }
      if (!taxProfiles.has(empId)) warnings.push("세액 설정 없음 — 가족수 1·비율 100% 기본 적용");
    }

    const lines = [...lineMap.values()];
    const payTotal = lines.filter((l) => itemKinds.get(l.itemId) === "pay").reduce((a, l) => a + l.amount, 0);
    const deductionTotal = lines
      .filter((l) => itemKinds.get(l.itemId) === "deduction")
      .reduce((a, l) => a + l.amount, 0);
    entries.push({
      employeeId: empId,
      name: String(emp.name),
      deptName: emp.dept_name ? String(emp.dept_name) : null,
      positionName: emp.position_name ? String(emp.position_name) : null,
      lines,
      payTotal,
      deductionTotal,
      netPay: payTotal - deductionTotal,
      warnings,
    });
  }

  const ediStatusRows = rowsToObjects(
    await db.exec(
      `SELECT insurer, count(*) AS n FROM payroll_edi_notices WHERE pay_year=$1 AND pay_month=$2 GROUP BY insurer`,
      [payYear, payMonth]
    )
  );
  const ediReady = {
    nhis: ediStatusRows.some((r) => String(r.insurer) === "nhis"),
    nps: ediStatusRows.some((r) => String(r.insurer) === "nps"),
  };

  return {
    payYear,
    payMonth,
    baseLedger: base
      ? { ledgerId: String(base.ledger_id), payYear: Number(base.pay_year), payMonth: Number(base.pay_month) }
      : null,
    ediReady,
    entries,
  };
}

/** draft 대장 생성(저장) — 동일 연월 salary 대장이 있으면 거부(draft는 삭제 후 재생성 안내) */
export async function createDraftLedger(
  payYear: number,
  payMonth: number,
  actorUserId: string
): Promise<{ ledgerId: string; headcount: number }> {
  const db = await getDb();
  const exists = rowsToObjects(
    await db.exec(
      `SELECT ledger_id, status FROM payroll_ledgers
        WHERE pay_year=$1 AND pay_month=$2 AND ledger_kind='salary'`,
      [payYear, payMonth]
    )
  )[0];
  if (exists) {
    throw Object.assign(
      new Error(
        String(exists.status) === "draft"
          ? "이미 작성 중인 대장이 있습니다. 삭제 후 다시 생성하세요."
          : "해당 월 대장이 이미 확정되어 있습니다."
      ),
      { status: 400 }
    );
  }
  const built = await buildLedger(payYear, payMonth);
  const ledgerId = newId("pled");
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.exec(
      `INSERT INTO payroll_ledgers
         (ledger_id, pay_year, pay_month, ledger_kind, title, source, status, created_by, created_at)
       VALUES ($1,$2,$3,'salary',$4,'app','draft',$5,$6)`,
      [ledgerId, payYear, payMonth, `${payYear}년 ${payMonth}월분 급상여대장`, actorUserId, now]
    );
    let order = 0;
    for (const e of built.entries) {
      const entryId = newId("pent");
      order += 1;
      await txn.exec(
        `INSERT INTO payroll_entries
           (entry_id, ledger_id, employee_id, name, dept_name, position_name,
            pay_total, deduction_total, net_pay, row_order, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          entryId, ledgerId, e.employeeId, e.name, e.deptName, e.positionName,
          e.payTotal, e.deductionTotal, e.netPay, order,
          e.warnings.length ? e.warnings.join(" / ") : null,
        ]
      );
      for (const l of e.lines) {
        await txn.exec(
          `INSERT INTO payroll_entry_lines (line_id, entry_id, item_id, amount) VALUES ($1,$2,$3,$4)`,
          [newId("plin"), entryId, l.itemId, l.amount]
        );
      }
    }
  });
  return { ledgerId, headcount: built.entries.length };
}

/** draft 대장 셀 수정 — 라인 upsert(0=삭제) 후 합계 재계산 */
export async function updateEntryLine(entryId: string, itemId: string, amount: number): Promise<void> {
  await withDbWrite(async (db) => {
    const kindRows = rowsToObjects(
      await db.exec(`SELECT kind FROM payroll_item_defs WHERE item_id = $1`, [itemId])
    );
    if (!kindRows.length) throw Object.assign(new Error("알 수 없는 항목입니다."), { status: 400 });
    const guard = rowsToObjects(
      await db.exec(
        `SELECT lg.status, lg.source FROM payroll_entries e
          JOIN payroll_ledgers lg ON lg.ledger_id = e.ledger_id WHERE e.entry_id = $1`,
        [entryId]
      )
    )[0];
    if (!guard) throw Object.assign(new Error("행을 찾을 수 없습니다."), { status: 404 });
    if (String(guard.status) !== "draft") {
      throw Object.assign(new Error("확정된 대장은 수정할 수 없습니다."), { status: 400 });
    }
    await db.exec(`DELETE FROM payroll_entry_lines WHERE entry_id = $1 AND item_id = $2`, [entryId, itemId]);
    if (amount !== 0) {
      await db.exec(
        `INSERT INTO payroll_entry_lines (line_id, entry_id, item_id, amount) VALUES ($1,$2,$3,$4)`,
        [newId("plin"), entryId, itemId, amount]
      );
    }
    await db.exec(
      `UPDATE payroll_entries e SET
         pay_total = COALESCE((SELECT sum(l.amount) FROM payroll_entry_lines l
             JOIN payroll_item_defs d ON d.item_id = l.item_id
            WHERE l.entry_id = e.entry_id AND d.kind = 'pay'), 0),
         deduction_total = COALESCE((SELECT sum(l.amount) FROM payroll_entry_lines l
             JOIN payroll_item_defs d ON d.item_id = l.item_id
            WHERE l.entry_id = e.entry_id AND d.kind = 'deduction'), 0)
       WHERE e.entry_id = $1`,
      [entryId]
    );
    await db.exec(
      `UPDATE payroll_entries SET net_pay = pay_total - deduction_total WHERE entry_id = $1`,
      [entryId]
    );
  });
}

/** 지급 항목 수정 후 산식 공제(고용보험·소득세·지방세) 재산출 — EDI 고지·수기 공제는 유지 */
export async function recalcEntryTaxes(entryId: string): Promise<void> {
  const db = await getDb();
  const meta = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, lg.pay_year, lg.pay_month, lg.status, p.birth_date
         FROM payroll_entries e
         JOIN payroll_ledgers lg ON lg.ledger_id = e.ledger_id
         LEFT JOIN employee_profiles p ON p.employee_id = e.employee_id
        WHERE e.entry_id = $1`,
      [entryId]
    )
  )[0];
  if (!meta) throw Object.assign(new Error("행을 찾을 수 없습니다."), { status: 404 });
  if (String(meta.status) !== "draft") {
    throw Object.assign(new Error("확정된 대장은 재계산할 수 없습니다."), { status: 400 });
  }
  const payYear = Number(meta.pay_year);
  const payMonth = Number(meta.pay_month);
  const lines = rowsToObjects(
    await db.exec(
      `SELECT l.item_id, l.amount, d.kind FROM payroll_entry_lines l
        JOIN payroll_item_defs d ON d.item_id = l.item_id WHERE l.entry_id = $1`,
      [entryId]
    )
  );
  const payLines = lines.filter((l) => String(l.kind) === "pay");
  const taxable =
    payLines.reduce((a, l) => a + toNum(l.amount), 0) -
    payLines
      .filter((l) => (NON_TAXABLE_ITEMS as readonly string[]).includes(String(l.item_id)))
      .reduce((a, l) => a + toNum(l.amount), 0);

  const tp = rowsToObjects(
    await db.exec(
      `SELECT withholding_rate, dependents, child_deduction, special_relation FROM payroll_tax_profiles WHERE employee_id = $1`,
      [meta.employee_id ? String(meta.employee_id) : ""]
    )
  )[0];
  const eiExemptAge = await getInsuranceRate("ei-exempt-age", payYear, payMonth).catch(() => 65);
  const age = meta.birth_date ? fullAge(String(meta.birth_date), payYear, payMonth) : null;
  const eiExempt = (age != null && age >= eiExemptAge) || Number(tp?.special_relation ?? 0) === 1;
  const ei = taxable > 0 && !eiExempt ? await calcEmploymentIns(taxable, payYear, payMonth) : 0;
  const tax =
    taxable > 0
      ? await lookupIncomeTax(
          taxable,
          Number(tp?.dependents ?? 1),
          Number(tp?.child_deduction ?? 0),
          Number(tp?.withholding_rate ?? 100)
        )
      : null;

  await withDbWrite(async (txn) => {
    for (const [itemId, amount] of [
      ["ei", ei],
      ["income-tax", tax && !tax.outOfTable ? tax.incomeTax : 0],
      ["local-tax", tax && !tax.outOfTable ? tax.localTax : 0],
    ] as Array<[string, number]>) {
      await txn.exec(`DELETE FROM payroll_entry_lines WHERE entry_id = $1 AND item_id = $2`, [entryId, itemId]);
      if (amount > 0) {
        await txn.exec(
          `INSERT INTO payroll_entry_lines (line_id, entry_id, item_id, amount) VALUES ($1,$2,$3,$4)`,
          [newId("plin"), entryId, itemId, amount]
        );
      }
    }
    await txn.exec(
      `UPDATE payroll_entries e SET
         pay_total = COALESCE((SELECT sum(l.amount) FROM payroll_entry_lines l
             JOIN payroll_item_defs d ON d.item_id = l.item_id
            WHERE l.entry_id = e.entry_id AND d.kind = 'pay'), 0),
         deduction_total = COALESCE((SELECT sum(l.amount) FROM payroll_entry_lines l
             JOIN payroll_item_defs d ON d.item_id = l.item_id
            WHERE l.entry_id = e.entry_id AND d.kind = 'deduction'), 0)
       WHERE e.entry_id = $1`,
      [entryId]
    );
    await txn.exec(`UPDATE payroll_entries SET net_pay = pay_total - deduction_total WHERE entry_id = $1`, [entryId]);
  });
}

/** 확정 — draft → confirmed */
export async function confirmLedger(ledgerId: string): Promise<void> {
  await withDbWrite(async (db) => {
    const r = rowsToObjects(
      await db.exec(`SELECT status, source FROM payroll_ledgers WHERE ledger_id = $1`, [ledgerId])
    )[0];
    if (!r) throw Object.assign(new Error("대장을 찾을 수 없습니다."), { status: 404 });
    if (String(r.status) !== "draft") throw Object.assign(new Error("작성 중 대장이 아닙니다."), { status: 400 });
    await db.exec(`UPDATE payroll_ledgers SET status = 'confirmed' WHERE ledger_id = $1`, [ledgerId]);
  });
}

/** 삭제 — 앱 생성 draft 대장만 */
export async function deleteDraftLedger(ledgerId: string): Promise<void> {
  await withDbWrite(async (db) => {
    const r = rowsToObjects(
      await db.exec(`SELECT status, source FROM payroll_ledgers WHERE ledger_id = $1`, [ledgerId])
    )[0];
    if (!r) throw Object.assign(new Error("대장을 찾을 수 없습니다."), { status: 404 });
    if (String(r.source) !== "app" || String(r.status) !== "draft") {
      throw Object.assign(new Error("앱에서 작성 중인 대장만 삭제할 수 있습니다."), { status: 400 });
    }
    await db.exec(`DELETE FROM payroll_ledgers WHERE ledger_id = $1`, [ledgerId]);
  });
}
