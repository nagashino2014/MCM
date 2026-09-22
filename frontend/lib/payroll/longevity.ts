import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";

/**
 * 장기근속 포상(사규 별표 9, 2026.04.08 개정 — 마이그 223 longevity_reward_rules 시드)
 *   5년: 휴가 2일 + 휴가비 500,000 / 10년: 3일 + 1,000,000 / 20년: 3일 + 1,000,000
 * - 휴가비: 근속 만 N년 도달 월의 급여대장에 'longevity'(장기근속휴가수당) 라인으로 자동 산정(generate.ts).
 * - 휴가: 그 대장이 확정될 때 특별휴가 원장(special_leave_ledger, kind='longevity')에 자동 부여
 *   (source='auto_longevity', ref_key='longevity:{years}' — 재확정·재실행에도 중복 부여 없음).
 * 예전 수당 규칙(payroll_pay_rules.longevity)은 223에서 비활성 처리해 이중 지급을 막는다.
 */

export interface LongevityRule {
  years: number;
  leaveDays: number;
  allowanceAmount: number;
  isActive: boolean;
  note: string | null;
}

export interface LongevityDue {
  employeeId: string;
  name: string;
  years: number;
  hiredAt: string;
  anniversary: string; // YYYY-MM-DD
  leaveDays: number;
  amount: number;
}

const toNum = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function mapRule(r: Record<string, unknown>): LongevityRule {
  return {
    years: Number(r.years),
    leaveDays: toNum(r.leave_days),
    allowanceAmount: Math.round(toNum(r.allowance_amount)),
    isActive: toNum(r.is_active) === 1,
    note: r.note != null ? String(r.note) : null,
  };
}

export async function listLongevityRules(database?: PgDatabase): Promise<LongevityRule[]> {
  const db = database ?? await getDb();
  return rowsToObjects(await db.exec(`SELECT * FROM longevity_reward_rules ORDER BY years`)).map(mapRule);
}

export async function saveLongevityRule(rule: LongevityRule): Promise<void> {
  if (!Number.isInteger(rule.years) || rule.years <= 0) throw Object.assign(new Error("근속 연수는 1 이상의 정수여야 합니다."), { status: 400 });
  await withDbWrite(async (db) => {
    await db.exec(
      `INSERT INTO longevity_reward_rules (years, leave_days, allowance_amount, is_active, note, updated_at)
       VALUES ($1, $2, $3, $4, $5, now()::text)
       ON CONFLICT (years) DO UPDATE SET leave_days = EXCLUDED.leave_days, allowance_amount = EXCLUDED.allowance_amount,
         is_active = EXCLUDED.is_active, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`,
      [rule.years, rule.leaveDays, Math.round(rule.allowanceAmount), rule.isActive ? 1 : 0, rule.note]
    );
  });
}

export async function deleteLongevityRule(years: number): Promise<void> {
  await withDbWrite(async (db) => {
    await db.exec(`DELETE FROM longevity_reward_rules WHERE years = $1`, [years]);
  });
}

/** 입사일 + N년 = 기념일(YYYY-MM-DD). 2/29 입사는 평년 2/28 로 당긴다. */
function anniversaryOf(hiredAt: string, years: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(hiredAt);
  if (!m) return null;
  const y = Number(m[1]) + years;
  const mo = Number(m[2]);
  let d = Number(m[3]);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > last) d = last;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 귀속월에 근속 만 N년(활성 규칙)에 도달하는 재직자 — employeeId → 도달 정보(같은 달 복수 규칙이면 큰 연수 우선). */
export async function longevityDueFor(payYear: number, payMonth: number, database?: PgDatabase): Promise<Map<string, LongevityDue>> {
  const db = database ?? await getDb();
  const rules = (await listLongevityRules(db)).filter((r) => r.isActive);
  const map = new Map<string, LongevityDue>();
  if (!rules.length) return map;
  const employees = rowsToObjects(
    await db.exec(`SELECT employee_id, name, hired_at FROM employee_profiles WHERE status = 'active' AND hired_at IS NOT NULL`)
  );
  const ym = `${payYear}-${String(payMonth).padStart(2, "0")}`;
  for (const e of employees) {
    const hiredAt = String(e.hired_at);
    for (const r of [...rules].sort((a, b) => b.years - a.years)) {
      const anniv = anniversaryOf(hiredAt, r.years);
      if (!anniv || !anniv.startsWith(ym)) continue;
      map.set(String(e.employee_id), {
        employeeId: String(e.employee_id),
        name: String(e.name),
        years: r.years,
        hiredAt,
        anniversary: anniv,
        leaveDays: r.leaveDays,
        amount: r.allowanceAmount,
      });
      break;
    }
  }
  return map;
}

export interface LongevityUpcoming extends LongevityDue {
  /** 특별휴가 부여 완료 여부(auto_longevity ref_key) */
  granted: boolean;
  /** 급여대장에 휴가비 라인이 있는지(귀속월 대장 · 확정 여부) */
  paid: "none" | "draft" | "confirmed";
}

/** 지난 monthsBack 개월 ~ 향후 monthsAhead 개월의 도달자(설정 화면 예정자 목록). */
export async function listLongevityUpcoming(monthsBack = 6, monthsAhead = 12): Promise<LongevityUpcoming[]> {
  const rules = (await listLongevityRules()).filter((r) => r.isActive);
  if (!rules.length) return [];
  const db = await getDb();
  const employees = rowsToObjects(
    await db.exec(`SELECT employee_id, name, hired_at FROM employee_profiles WHERE status = 'active' AND hired_at IS NOT NULL`)
  );
  const today = new Date(Date.now() + 9 * 3600 * 1000);
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthsBack, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + monthsAhead + 1, 0)).toISOString().slice(0, 10);
  const out: LongevityUpcoming[] = [];
  for (const e of employees) {
    const hiredAt = String(e.hired_at);
    for (const r of rules) {
      const anniv = anniversaryOf(hiredAt, r.years);
      if (!anniv || anniv < from || anniv > to) continue;
      out.push({
        employeeId: String(e.employee_id), name: String(e.name), years: r.years, hiredAt, anniversary: anniv,
        leaveDays: r.leaveDays, amount: r.allowanceAmount, granted: false, paid: "none",
      });
    }
  }
  if (!out.length) return out;
  const grants = rowsToObjects(
    await db.exec(`SELECT employee_id, ref_key FROM special_leave_ledger WHERE kind = 'longevity' AND source = 'auto_longevity'`)
  );
  const grantSet = new Set(grants.map((g) => `${g.employee_id}|${g.ref_key}`));
  const paidRows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, lg.pay_year, lg.pay_month, lg.status
         FROM payroll_entry_lines l JOIN payroll_entries e ON e.entry_id = l.entry_id
         JOIN payroll_ledgers lg ON lg.ledger_id = e.ledger_id
        WHERE l.item_id = 'longevity' AND l.amount > 0`
    )
  );
  const paidMap = new Map(paidRows.map((p) => [`${p.employee_id}|${p.pay_year}-${String(p.pay_month).padStart(2, "0")}`, String(p.status)]));
  for (const u of out) {
    u.granted = grantSet.has(`${u.employeeId}|longevity:${u.years}`);
    const st = paidMap.get(`${u.employeeId}|${u.anniversary.slice(0, 7)}`);
    u.paid = st === "confirmed" ? "confirmed" : st === "draft" ? "draft" : "none";
  }
  return out.sort((a, b) => a.anniversary.localeCompare(b.anniversary));
}

/**
 * 대장 확정 훅 — 대장의 longevity 라인 보유 직원에게 특별휴가 부여(멱등).
 * 라인은 있는데 도달 규칙이 없으면(수기 입력) 부여하지 않고 건너뛴다.
 */
export async function grantLongevityLeaveForLedger(ledgerId: string): Promise<{ granted: number }> {
  const db = await getDb();
  const lg = rowsToObjects(await db.exec(`SELECT pay_year, pay_month FROM payroll_ledgers WHERE ledger_id = $1`, [ledgerId]))[0];
  if (!lg) return { granted: 0 };
  const due = await longevityDueFor(Number(lg.pay_year), Number(lg.pay_month));
  const lines = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id FROM payroll_entry_lines l JOIN payroll_entries e ON e.entry_id = l.entry_id
        WHERE e.ledger_id = $1 AND l.item_id = 'longevity' AND l.amount > 0 AND e.employee_id IS NOT NULL`,
      [ledgerId]
    )
  );
  let granted = 0;
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    for (const row of lines) {
      const d = due.get(String(row.employee_id));
      if (!d || d.leaveDays <= 0) continue;
      const res = await txn.exec(
        `INSERT INTO special_leave_ledger
           (entry_id, employee_id, kind, entry_type, days, unit, effective_on, expires_on, note, source, ref_key, created_at)
         VALUES ($1, $2, 'longevity', 'grant', $3, 'day', $4, NULL, $5, 'auto_longevity', $6, $7)
         ON CONFLICT (employee_id, kind, ref_key) WHERE ref_key IS NOT NULL DO NOTHING
         RETURNING entry_id`,
        [
          "slv-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14),
          d.employeeId, d.leaveDays, d.anniversary,
          `장기근속 ${d.years}년 포상휴가(별표 9) — ${lg.pay_year}년 ${lg.pay_month}월 대장 확정 시 자동 부여`,
          `longevity:${d.years}`, now,
        ]
      );
      if (rowsToObjects(res).length > 0) granted += 1;
    }
  });
  return { granted };
}
