import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { BonusPeriod } from "@/lib/bonus/source";
import { getBonusSettings, listBonusTargets } from "@/lib/bonus/targets";
import { EXEC_RANK_CUTOFF, GRADE_WEIGHTS } from "@/lib/bonus/shared";
import { listHalfLaborCosts, type HalfLaborCost } from "@/lib/bonus/salary";

/**
 * 성과급 산정 엔진 + 지급 명세 조회 (docs/bonus-calculation-blueprint.md §6)
 * 산식(기존 산정방식 base):
 *   pool(c)  = applied(c) × 적용비율 × (1 − (지원/영업% + 임원% + 소속본부장%))
 *   bonus(i) = Σ_c pool(c) × 참여도(i,c) × 평점가중치   (grade 미부여 = C(×1.0) 취급)
 * 인건비 반영 산정(salary, §1.3 BS-P4 — 2026-08-31 사용자 확정):
 *   적용비율은 salary_apply_rate(미지정 시 apply_rate)를 쓰고, 개인별 참여 산정액에서
 *   본인 반기 인건비(급여대장의 통상임금 산입 항목 합계) × salary_multiplier 를 차감한다.
 *   차감은 참여분에만 적용(음수는 0) — 본부장 산정액·유관부서 수기 배분은 차감하지 않는다.
 *   본부장   = Σ_{c∈본부} applied(c) × 적용비율 × 본부장비율
 *     — 수령자 추정: 본부 대상 용역들의 관리자(role='관리자') 최빈 인물 → 없으면 부서 최고 직급 재직자
 *   유관부서/임원 = 수기 배분(bonus_manual_allocations)을 스냅샷으로 복사
 * 일괄산정은 반기 statements 를 전량 재생성한다(스냅샷).
 */

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function prevPeriod(p: BonusPeriod): { year: number; half: "H1" | "H2" } {
  return p.half === "H1" ? { year: p.year - 1, half: "H2" } : { year: p.year, half: "H1" };
}

export interface CalculateSummary {
  participants: number;
  deptHeads: number;
  supportAllocations: number;
  execAllocations: number;
  totalApplied: number;
  totalTarget: number;
  unassignedDeptContracts: number;
  /** 산정에 실제로 쓰인 방식 */
  calcMethod: "base" | "salary" | "profit";
  /** 인건비 반영 산정 — 차감 합계 */
  salaryDeducted: number;
  /** 인건비 반영 산정 — 급여대장에 반기 급여가 없어 차감하지 못한 인원 수 */
  salaryMissing: number;
}

export async function calculateBonus(actorUserId: string, p: BonusPeriod): Promise<CalculateSummary> {
  const settings = await getBonusSettings(p.year, p.half);
  const targets = await listBonusTargets(p);
  const db = await getDb();
  // 인건비 반영 산정은 전용 적용비율(비율 조정 카드)을 쓴다 — 미지정이면 기존 적용비율.
  const method = settings.calcMethod;
  const rate = (method === "salary" ? (settings.salaryApplyRate ?? settings.applyRate) : settings.applyRate) / 100;
  const salaryMultiplier = method === "salary" ? settings.salaryMultiplier : 0;
  const laborCosts: Map<string, HalfLaborCost> =
    method === "salary" ? await listHalfLaborCosts(p) : new Map();
  const supportPct = settings.contribSupportPct / 100;
  const execPct = settings.contribExecPct / 100;

  const contractIds = targets.map((t) => t.contractId);
  const evals = contractIds.length
    ? rowsToObjects(
        await db.exec(
          `SELECT contract_id, employee_id, participation_pct, grade
             FROM service_evaluations
            WHERE contract_id = ANY($1::text[]) AND period_year = $2 AND period_half = $3`,
          [contractIds, p.year, p.half]
        )
      )
    : [];
  const managers = contractIds.length
    ? rowsToObjects(
        await db.exec(
          `SELECT sp.contract_id, sp.employee_id
             FROM service_participants sp
            WHERE sp.contract_id = ANY($1::text[]) AND sp.role_label = '관리자'`,
          [contractIds]
        )
      )
    : [];
  const evalsByContract = new Map<string, Array<{ employeeId: string; pct: number; grade: string | null }>>();
  for (const row of evals) {
    const cid = String(row.contract_id ?? "");
    const list = evalsByContract.get(cid) ?? [];
    list.push({
      employeeId: String(row.employee_id ?? ""),
      pct: Number(row.participation_pct ?? 0),
      grade: row.grade != null ? String(row.grade) : null,
    });
    evalsByContract.set(cid, list);
  }
  const managerByContract = new Map<string, string>();
  for (const row of managers) {
    managerByContract.set(String(row.contract_id ?? ""), String(row.employee_id ?? ""));
  }

  // 개인별 참여 산정 + 본부별 집계
  interface Line {
    contractId: string;
    contractTitle: string;
    applied: number;
    pct: number;
    grade: string | null;
    weight: number;
    amount: number;
  }
  const linesByEmployee = new Map<string, Line[]>();
  const deptGross = new Map<string, number>(); // Σ applied×rate (본부장 비율 적용 전)
  const deptManagerVotes = new Map<string, Map<string, number>>();
  let totalApplied = 0;
  let unassignedDeptContracts = 0;

  for (const t of targets) {
    totalApplied += t.appliedInPeriod;
    const deptId = t.owningDeptId;
    const deptHeadPct = deptId ? (settings.deptHeadRates[deptId] ?? 0) / 100 : 0;
    if (!deptId) unassignedDeptContracts += 1;
    if (deptId) {
      deptGross.set(deptId, (deptGross.get(deptId) ?? 0) + t.appliedInPeriod * rate);
      const mgr = managerByContract.get(t.contractId);
      if (mgr) {
        const votes = deptManagerVotes.get(deptId) ?? new Map<string, number>();
        votes.set(mgr, (votes.get(mgr) ?? 0) + 1);
        deptManagerVotes.set(deptId, votes);
      }
    }
    const pool = t.appliedInPeriod * rate * Math.max(0, 1 - (supportPct + execPct + deptHeadPct));
    for (const ev of evalsByContract.get(t.contractId) ?? []) {
      const weight = ev.grade ? (GRADE_WEIGHTS[ev.grade] ?? 1) : 1;
      const amount = pool * (ev.pct / 100) * weight;
      if (amount === 0 && ev.pct === 0) continue;
      const list = linesByEmployee.get(ev.employeeId) ?? [];
      list.push({
        contractId: t.contractId,
        contractTitle: t.contractTitle,
        applied: t.appliedInPeriod,
        pct: ev.pct,
        grade: ev.grade,
        weight,
        amount,
      });
      linesByEmployee.set(ev.employeeId, list);
    }
  }
  const totalTarget = totalApplied * rate;

  // 본부장 산정액 + 수령자 추정
  const deptHeadStatements: Array<{ deptId: string; employeeId: string; amount: number }> = [];
  for (const [deptId, gross] of deptGross) {
    const headRate = (settings.deptHeadRates[deptId] ?? 0) / 100;
    if (headRate <= 0) continue;
    const amount = gross * headRate;
    if (amount <= 0) continue;
    let headId: string | null = null;
    const votes = deptManagerVotes.get(deptId);
    if (votes && votes.size) {
      headId = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    } else {
      const fallback = rowsToObjects(
        await db.exec(
          `SELECT e.employee_id FROM employee_profiles e
             JOIN positions po ON po.position_id = e.position_id
            WHERE e.dept_id = $1 AND e.status = 'active'
            ORDER BY po.rank_order DESC NULLS LAST LIMIT 1`,
          [deptId]
        )
      );
      headId = fallback[0]?.employee_id ? String(fallback[0].employee_id) : null;
    }
    if (headId) deptHeadStatements.push({ deptId, employeeId: headId, amount });
  }

  // 유관부서/임원 수기 배분
  const allocations = rowsToObjects(
    await db.exec(
      `SELECT employee_id, bucket, amount FROM bonus_manual_allocations
        WHERE period_year = $1 AND period_half = $2`,
      [p.year, p.half]
    )
  );

  // 전기 성과급
  const prev = prevPeriod(p);
  const prevMap = new Map<string, number>();
  for (const row of rowsToObjects(
    await db.exec(
      `SELECT employee_id, total_amount FROM bonus_statements WHERE period_year = $1 AND period_half = $2`,
      [prev.year, prev.half]
    )
  )) {
    prevMap.set(String(row.employee_id ?? ""), Number(row.total_amount ?? 0));
  }

  const meta = {
    calcMethod: method,
    applyRate: method === "salary" ? (settings.salaryApplyRate ?? settings.applyRate) : settings.applyRate,
    salaryMultiplier: method === "salary" ? salaryMultiplier : undefined,
    contribSupportPct: settings.contribSupportPct,
    contribExecPct: settings.contribExecPct,
    deptHeadRates: settings.deptHeadRates,
    totalApplied,
    totalTarget,
    gradeDefaultWeight: 1,
    unassignedDeptContracts,
  };
  const now = new Date().toISOString();

  // 인물별 statements 병합(참여 + 본부장 겸직 가능 — 25H2 한도경 사례: 통합2 본부장 + 화학 본부장)
  interface SalaryDeductionMeta {
    /** 차감 전 참여 산정액 */
    gross: number;
    /** 반기 인건비(통상임금 산입 항목 합계) */
    salaryTotal: number;
    multiplier: number;
    /** 실제 차감액(참여 산정액을 넘지 않음) */
    deducted: number;
    /** 집계된 급여대장 월수 — 6 미만이면 급여 데이터 누락 가능 */
    months: number;
  }
  const totals = new Map<
    string,
    { bucket: string; amount: number; deptMeta?: Record<string, number>; salaryMeta?: SalaryDeductionMeta }
  >();
  let salaryDeducted = 0;
  let salaryMissing = 0;
  for (const [employeeId, lines] of linesByEmployee) {
    const gross = lines.reduce((a, b) => a + b.amount, 0);
    if (method !== "salary") {
      totals.set(employeeId, { bucket: "participant", amount: gross });
      continue;
    }
    const cost = laborCosts.get(employeeId);
    if (!cost) salaryMissing += 1;
    const salaryTotal = cost?.total ?? 0;
    const deducted = Math.min(gross, salaryTotal * salaryMultiplier);
    salaryDeducted += deducted;
    totals.set(employeeId, {
      bucket: "participant",
      amount: Math.max(0, gross - deducted),
      salaryMeta: { gross, salaryTotal, multiplier: salaryMultiplier, deducted, months: cost?.months ?? 0 },
    });
  }
  for (const dh of deptHeadStatements) {
    const cur = totals.get(dh.employeeId);
    if (cur) {
      cur.amount += dh.amount;
      cur.bucket = cur.bucket === "participant" ? "participant" : "dept_head";
      cur.deptMeta = { ...(cur.deptMeta ?? {}), [dh.deptId]: dh.amount };
    } else {
      totals.set(dh.employeeId, { bucket: "dept_head", amount: dh.amount, deptMeta: { [dh.deptId]: dh.amount } });
    }
  }
  for (const row of allocations) {
    const employeeId = String(row.employee_id ?? "");
    const amount = Number(row.amount ?? 0);
    if (amount <= 0) continue;
    const cur = totals.get(employeeId);
    if (cur) cur.amount += amount;
    else totals.set(employeeId, { bucket: String(row.bucket ?? "support"), amount });
  }

  await withDbWrite(async (db2) => {
    await db2.run(
      `DELETE FROM bonus_statement_lines WHERE statement_id IN
         (SELECT statement_id FROM bonus_statements WHERE period_year = $1 AND period_half = $2)`,
      [p.year, p.half]
    );
    await db2.run(`DELETE FROM bonus_statements WHERE period_year = $1 AND period_half = $2`, [p.year, p.half]);
    for (const [employeeId, t] of totals) {
      const statementId = id("bst");
      await db2.run(
        `INSERT INTO bonus_statements
           (statement_id, period_year, period_half, employee_id, bucket, total_amount,
            prev_amount, calc_method, meta_json, calculated_by, calculated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
        [
          statementId,
          p.year,
          p.half,
          employeeId,
          t.bucket,
          t.amount,
          prevMap.get(employeeId) ?? null,
          method,
          JSON.stringify({ ...meta, deptHeadAmounts: t.deptMeta ?? undefined, salaryDeduction: t.salaryMeta ?? undefined }),
          actorUserId,
          now,
        ]
      );
      for (const line of linesByEmployee.get(employeeId) ?? []) {
        await db2.run(
          `INSERT INTO bonus_statement_lines
             (line_id, statement_id, contract_id, contract_title, applied_amount, participation_pct, grade, grade_weight, amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id("bsl"), statementId, line.contractId, line.contractTitle, line.applied, line.pct, line.grade, line.weight, line.amount]
        );
      }
    }
  });

  return {
    participants: linesByEmployee.size,
    deptHeads: deptHeadStatements.length,
    supportAllocations: allocations.filter((a) => String(a.bucket) === "support").length,
    execAllocations: allocations.filter((a) => String(a.bucket) === "exec").length,
    totalApplied,
    totalTarget,
    unassignedDeptContracts,
    calcMethod: method,
    salaryDeducted,
    salaryMissing,
  };
}

export interface StatementOverviewRow {
  employeeId: string;
  employeeName: string;
  deptName: string | null;
  positionName: string | null;
  hiredAt: string | null;
  email: string | null;
  bucket: string;
  prevAmount: number | null;
  totalAmount: number;
  calculatedAt: string;
  lastSentAt: string | null;
  lastSendStatus: string | null;
}

export async function listStatementsOverview(p: BonusPeriod): Promise<StatementOverviewRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT s.employee_id, e.name AS employee_name, d.dept_name, po.position_name, e.hired_at, e.email,
            s.bucket, s.prev_amount, s.total_amount, s.calculated_at,
            ls.sent_at AS last_sent_at, ls.status AS last_send_status
       FROM bonus_statements s
       JOIN employee_profiles e ON e.employee_id = s.employee_id
       LEFT JOIN departments d ON d.dept_id = e.dept_id
       LEFT JOIN positions po ON po.position_id = e.position_id
       LEFT JOIN LATERAL (
         SELECT sent_at, status FROM bonus_statement_sends bs
          WHERE bs.period_year = s.period_year AND bs.period_half = s.period_half
            AND bs.employee_id = s.employee_id
          ORDER BY bs.sent_at DESC LIMIT 1
       ) ls ON TRUE
      WHERE s.period_year = $1 AND s.period_half = $2
      ORDER BY d.display_order NULLS LAST, po.rank_order DESC NULLS LAST, e.name`,
    [p.year, p.half]
  );
  return rowsToObjects(result).map((row) => ({
    employeeId: String(row.employee_id ?? ""),
    employeeName: String(row.employee_name ?? ""),
    deptName: row.dept_name != null ? String(row.dept_name) : null,
    positionName: row.position_name != null ? String(row.position_name) : null,
    hiredAt: row.hired_at != null ? String(row.hired_at) : null,
    email: row.email != null ? String(row.email) : null,
    bucket: String(row.bucket ?? "participant"),
    prevAmount: row.prev_amount != null ? Number(row.prev_amount) : null,
    totalAmount: Number(row.total_amount ?? 0),
    calculatedAt: String(row.calculated_at ?? ""),
    lastSentAt: row.last_sent_at != null ? String(row.last_sent_at) : null,
    lastSendStatus: row.last_send_status != null ? String(row.last_send_status) : null,
  }));
}

export interface StatementDetail {
  employeeId: string;
  bucket: string;
  totalAmount: number;
  prevAmount: number | null;
  meta: Record<string, unknown>;
  lines: Array<{
    contractId: string;
    contractTitle: string;
    counterpartyName: string | null;
    contractDate: string | null;
    appliedAmount: number;
    participationPct: number;
    grade: string | null;
    gradeWeight: number | null;
    amount: number;
  }>;
}

export async function getStatementDetail(p: BonusPeriod, employeeId: string): Promise<StatementDetail | null> {
  const db = await getDb();
  const head = rowsToObjects(
    await db.exec(
      `SELECT statement_id, bucket, total_amount, prev_amount, meta_json
         FROM bonus_statements
        WHERE period_year = $1 AND period_half = $2 AND employee_id = $3`,
      [p.year, p.half, employeeId]
    )
  )[0];
  if (!head) return null;
  const lines = rowsToObjects(
    await db.exec(
      `SELECT l.contract_id, COALESCE(l.contract_title, c.contract_title) AS contract_title,
              cp.company_name AS counterparty_name, c.contract_date,
              l.applied_amount, l.participation_pct, l.grade, l.grade_weight, l.amount
         FROM bonus_statement_lines l
         LEFT JOIN contracts c ON c.contract_id = l.contract_id
         LEFT JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
        WHERE l.statement_id = $1
        ORDER BY c.contract_date NULLS LAST, contract_title`,
      [String(head.statement_id)]
    )
  );
  let meta: Record<string, unknown> = {};
  try {
    meta = typeof head.meta_json === "string" ? JSON.parse(head.meta_json) : ((head.meta_json ?? {}) as Record<string, unknown>);
  } catch {
    meta = {};
  }
  return {
    employeeId,
    bucket: String(head.bucket ?? "participant"),
    totalAmount: Number(head.total_amount ?? 0),
    prevAmount: head.prev_amount != null ? Number(head.prev_amount) : null,
    meta,
    lines: lines.map((row) => ({
      contractId: String(row.contract_id ?? ""),
      contractTitle: String(row.contract_title ?? ""),
      counterpartyName: row.counterparty_name != null ? String(row.counterparty_name) : null,
      contractDate: row.contract_date != null ? String(row.contract_date) : null,
      appliedAmount: Number(row.applied_amount ?? 0),
      participationPct: Number(row.participation_pct ?? 0),
      grade: row.grade != null ? String(row.grade) : null,
      gradeWeight: row.grade_weight != null ? Number(row.grade_weight) : null,
      amount: Number(row.amount ?? 0),
    })),
  };
}

export interface AllocationBoard {
  totalTarget: number;
  supportQuota: number;
  execQuota: number;
  supportUsed: number;
  execUsed: number;
  deptHeads: Array<{ deptId: string; deptName: string; ratePct: number; amount: number; headName: string | null }>;
  people: Array<{
    employeeId: string;
    employeeName: string;
    deptName: string | null;
    positionName: string | null;
    bucket: "support" | "exec";
    amount: number;
  }>;
}

/**
 * 유관부서/인력 명세 보드.
 * - 임원 후보 = 총괄(exec) 재직자 + 타부서 임원 컷오프(rank_order >= 82) 재직자
 * - 영업/지원 후보 = 영업관리본부(sales-management) 재직자
 * - 본부장 = 산정 결과(dept_head 산정액) 표시 전용
 */
export async function getAllocationBoard(p: BonusPeriod): Promise<AllocationBoard> {
  const settings = await getBonusSettings(p.year, p.half);
  const targets = await listBonusTargets(p);
  const db = await getDb();
  // 산정 엔진과 같은 적용비율(인건비 반영 산정이면 전용 비율)로 할당액을 잡는다.
  const rate =
    (settings.calcMethod === "salary" ? (settings.salaryApplyRate ?? settings.applyRate) : settings.applyRate) / 100;
  const totalApplied = targets.reduce((a, t) => a + t.appliedInPeriod, 0);
  const totalTarget = totalApplied * rate;

  const deptGross = new Map<string, number>();
  for (const t of targets) {
    if (!t.owningDeptId) continue;
    deptGross.set(t.owningDeptId, (deptGross.get(t.owningDeptId) ?? 0) + t.appliedInPeriod * rate);
  }
  const deptHeadRows = rowsToObjects(
    await db.exec(
      `SELECT s.employee_id, e.name, s.meta_json FROM bonus_statements s
         JOIN employee_profiles e ON e.employee_id = s.employee_id
        WHERE s.period_year = $1 AND s.period_half = $2 AND s.meta_json ? 'deptHeadAmounts'`,
      [p.year, p.half]
    )
  );
  const headNameByDept = new Map<string, string>();
  for (const row of deptHeadRows) {
    try {
      const meta = typeof row.meta_json === "string" ? JSON.parse(row.meta_json) : row.meta_json;
      for (const deptId of Object.keys((meta?.deptHeadAmounts ?? {}) as Record<string, number>)) {
        headNameByDept.set(deptId, String(row.name ?? ""));
      }
    } catch {
      // meta 파싱 실패는 표시 생략
    }
  }
  const deptRows = rowsToObjects(
    await db.exec(`SELECT dept_id, dept_name FROM departments WHERE is_active = 1`)
  );
  const deptNames = new Map(deptRows.map((d) => [String(d.dept_id), String(d.dept_name)]));
  const deptHeads = [...deptGross.entries()]
    .map(([deptId, gross]) => {
      const ratePct = settings.deptHeadRates[deptId] ?? 0;
      return {
        deptId,
        deptName: deptNames.get(deptId) ?? deptId,
        ratePct,
        amount: gross * (ratePct / 100),
        headName: headNameByDept.get(deptId) ?? null,
      };
    })
    .filter((d) => d.ratePct > 0)
    .sort((a, b) => a.deptId.localeCompare(b.deptId));

  const people = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, d.dept_name, po.position_name, po.rank_order, e.dept_id
         FROM employee_profiles e
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions po ON po.position_id = e.position_id
        WHERE e.status = 'active'
          AND (e.dept_id IN ('exec', 'sales-management') OR COALESCE(po.rank_order, 0) >= $1)
        ORDER BY po.rank_order DESC NULLS LAST, e.name`,
      [EXEC_RANK_CUTOFF]
    )
  );
  const allocations = rowsToObjects(
    await db.exec(
      `SELECT employee_id, bucket, amount FROM bonus_manual_allocations
        WHERE period_year = $1 AND period_half = $2`,
      [p.year, p.half]
    )
  );
  const allocByEmployee = new Map(
    allocations.map((a) => [String(a.employee_id), { bucket: String(a.bucket), amount: Number(a.amount ?? 0) }])
  );

  const peopleRows = people.map((row) => {
    const employeeId = String(row.employee_id ?? "");
    const isSupport = String(row.dept_id ?? "") === "sales-management";
    const existing = allocByEmployee.get(employeeId);
    return {
      employeeId,
      employeeName: String(row.name ?? ""),
      deptName: row.dept_name != null ? String(row.dept_name) : null,
      positionName: row.position_name != null ? String(row.position_name) : null,
      bucket: (existing?.bucket as "support" | "exec") ?? (isSupport ? "support" : "exec"),
      amount: existing?.amount ?? 0,
    };
  });

  const supportUsed = peopleRows.filter((r) => r.bucket === "support").reduce((a, b) => a + b.amount, 0);
  const execUsed = peopleRows.filter((r) => r.bucket === "exec").reduce((a, b) => a + b.amount, 0);

  return {
    totalTarget,
    supportQuota: totalTarget * (settings.contribSupportPct / 100),
    execQuota: totalTarget * (settings.contribExecPct / 100),
    supportUsed,
    execUsed,
    deptHeads,
    people: peopleRows,
  };
}

/** 유관부서/임원 수기 배분 저장 — 버킷 합계가 할당액을 초과하면 저장 차단(400). */
export async function saveAllocations(
  actorUserId: string,
  p: BonusPeriod,
  rows: Array<{ employeeId: string; bucket: "support" | "exec"; amount: number }>
): Promise<void> {
  const settings = await getBonusSettings(p.year, p.half);
  const targets = await listBonusTargets(p);
  const totalTarget = targets.reduce((a, t) => a + t.appliedInPeriod, 0) * (settings.applyRate / 100);
  const quota = {
    support: totalTarget * (settings.contribSupportPct / 100),
    exec: totalTarget * (settings.contribExecPct / 100),
  };
  for (const bucket of ["support", "exec"] as const) {
    const used = rows.filter((r) => r.bucket === bucket).reduce((a, b) => a + Number(b.amount ?? 0), 0);
    if (used > quota[bucket] + 1e-6) {
      throw Object.assign(
        new Error(
          `${bucket === "support" ? "영업/지원부서" : "임원"} 배분 합계 ${Math.round(used).toLocaleString()}원이 할당액 ${Math.round(quota[bucket]).toLocaleString()}원을 초과합니다.`
        ),
        { status: 400 }
      );
    }
  }
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM bonus_manual_allocations WHERE period_year = $1 AND period_half = $2`, [
      p.year,
      p.half,
    ]);
    for (const r of rows) {
      if (!r.employeeId || !(Number(r.amount) > 0)) continue;
      await db.run(
        `INSERT INTO bonus_manual_allocations
           (allocation_id, period_year, period_half, employee_id, bucket, amount, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id("bal"), p.year, p.half, r.employeeId, r.bucket, Number(r.amount), actorUserId, now]
      );
    }
  });
}
