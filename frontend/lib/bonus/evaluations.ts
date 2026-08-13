import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { BonusPeriod } from "@/lib/bonus/source";
import { listBonusTargets, getBonusSettings } from "@/lib/bonus/targets";
import {
  GRADE_OPTIONS,
  type BonusEvalEntry,
  type BonusEvalRow,
} from "@/lib/bonus/shared";

/**
 * 성과급 산정 — 참여도·평점 보드 (docs/bonus-calculation-blueprint.md §5)
 * - 행 = 해당 반기 세금계산서 발행 용역(지급 대상 LIST 와 동일 모집단).
 * - 관리자(role='관리자')는 표시 전용, 참여도·평점(A~E)은 참여자에게만 부여.
 * - 저장 그릇 = service_evaluations (participation_pct + grade[151]; 기존 rating 0~5 는 사장).
 * - 절대평가 옵션 활성 시 등급별 상한(%) 초과는 저장 차단(사용자 확정).
 */

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export async function listBonusEvaluationBoard(p: BonusPeriod): Promise<BonusEvalRow[]> {
  const targets = await listBonusTargets(p);
  if (!targets.length) return [];
  const db = await getDb();
  const ids = targets.map((t) => t.contractId);

  const participantsResult = await db.exec(
    `SELECT sp.participation_id, sp.contract_id, sp.employee_id, sp.role_label,
            e.name AS employee_name, e.dept_id, p.position_name, p.rank_order
       FROM service_participants sp
       JOIN employee_profiles e ON e.employee_id = sp.employee_id
       LEFT JOIN positions p ON p.position_id = e.position_id
      WHERE sp.contract_id = ANY($1::text[])
      ORDER BY sp.contract_id, p.rank_order DESC NULLS LAST, e.name ASC`,
    [ids]
  );
  const evalsResult = await db.exec(
    `SELECT contract_id, employee_id, participation_pct, grade, finalized_at
       FROM service_evaluations
      WHERE contract_id = ANY($1::text[]) AND period_year = $2 AND period_half = $3`,
    [ids, p.year, p.half]
  );
  const changesResult = await db.exec(
    `SELECT DISTINCT contract_id, change_kind
       FROM service_participation_changes
      WHERE contract_id = ANY($1::text[])
        AND effective_on >= $2 AND effective_on <= $3`,
    [ids, p.from, p.to]
  );

  const evalByKey = new Map<string, { pct: number; grade: string | null; finalized: boolean }>();
  for (const row of rowsToObjects(evalsResult)) {
    evalByKey.set(`${row.contract_id}|${row.employee_id}`, {
      pct: Number(row.participation_pct ?? 0),
      grade: row.grade != null ? String(row.grade) : null,
      finalized: row.finalized_at != null,
    });
  }
  const changesByContract = new Map<string, string[]>();
  for (const row of rowsToObjects(changesResult)) {
    const cid = String(row.contract_id ?? "");
    const list = changesByContract.get(cid) ?? [];
    list.push(String(row.change_kind ?? ""));
    changesByContract.set(cid, list);
  }
  const participantsByContract = new Map<string, BonusEvalEntry[]>();
  let anyFinalized = new Set<string>();
  for (const row of rowsToObjects(participantsResult)) {
    const cid = String(row.contract_id ?? "");
    const employeeId = String(row.employee_id ?? "");
    const ev = evalByKey.get(`${cid}|${employeeId}`);
    if (ev?.finalized) anyFinalized.add(cid);
    const entry: BonusEvalEntry = {
      participationId: String(row.participation_id ?? ""),
      employeeId,
      employeeName: String(row.employee_name ?? ""),
      positionName: row.position_name != null ? String(row.position_name) : null,
      deptId: row.dept_id != null ? String(row.dept_id) : null,
      roleLabel: String(row.role_label ?? "실무"),
      participationPct: ev?.pct ?? 0,
      grade: ev?.grade ?? null,
    };
    const list = participantsByContract.get(cid) ?? [];
    list.push(entry);
    participantsByContract.set(cid, list);
  }

  return targets.map((t) => {
    const all = participantsByContract.get(t.contractId) ?? [];
    const manager = all.find((e) => e.roleLabel === "관리자") ?? null;
    const participants = all.filter((e) => e.roleLabel !== "관리자");
    return {
      contractId: t.contractId,
      contractTitle: t.contractTitle,
      counterpartyName: t.counterpartyName,
      contractDate: t.contractDate,
      category: t.category,
      owningDeptId: t.owningDeptId,
      owningDeptName: t.owningDeptName,
      appliedInPeriod: t.appliedInPeriod,
      manager,
      participants,
      changeKinds: changesByContract.get(t.contractId) ?? [],
      finalized: anyFinalized.has(t.contractId),
    };
  });
}

export interface BonusEvalSaveEntry {
  contractId: string;
  employeeId: string;
  participationPct: number;
  grade: string | null;
}

/**
 * 참여도·등급 일괄 저장. 절대평가 옵션 활성 시 등급 분포 상한을 서버에서 강제(초과 → throw).
 * 분포 분모 = 반기 전체에서 grade 가 부여된 엔트리 수(요청 반영 후 상태로 시뮬레이션).
 */
export async function saveBonusEvaluations(
  actorUserId: string,
  p: BonusPeriod,
  entries: BonusEvalSaveEntry[]
): Promise<void> {
  const settings = await getBonusSettings(p.year, p.half);
  if (settings.absoluteGrading) {
    const db = await getDb();
    const existing = rowsToObjects(
      await db.exec(
        `SELECT contract_id, employee_id, grade FROM service_evaluations
          WHERE period_year = $1 AND period_half = $2 AND grade IS NOT NULL`,
        [p.year, p.half]
      )
    );
    const merged = new Map<string, string | null>();
    for (const row of existing) merged.set(`${row.contract_id}|${row.employee_id}`, String(row.grade));
    for (const e of entries) merged.set(`${e.contractId}|${e.employeeId}`, e.grade);
    const counts: Record<string, number> = {};
    let total = 0;
    for (const g of merged.values()) {
      if (!g) continue;
      counts[g] = (counts[g] ?? 0) + 1;
      total += 1;
    }
    if (total > 0) {
      const violations: string[] = [];
      for (const g of GRADE_OPTIONS) {
        const cap = settings.gradeCaps[g];
        if (cap == null || cap <= 0) continue;
        const share = ((counts[g] ?? 0) / total) * 100;
        if (share > cap + 1e-9) {
          violations.push(`${g} 등급 ${share.toFixed(1)}% > 상한 ${cap}%`);
        }
      }
      if (violations.length) {
        throw Object.assign(
          new Error(`절대평가 상한 초과로 저장할 수 없습니다: ${violations.join(", ")}`),
          { status: 400 }
        );
      }
    }
  }

  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    for (const e of entries) {
      if (!e.contractId || !e.employeeId) continue;
      await db.run(
        `INSERT INTO service_evaluations
           (evaluation_id, contract_id, employee_id, period_year, period_half,
            participation_pct, grade, rated_by, rated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (contract_id, employee_id, period_year, period_half) DO UPDATE SET
           participation_pct = EXCLUDED.participation_pct,
           grade = EXCLUDED.grade,
           rated_by = EXCLUDED.rated_by,
           rated_at = EXCLUDED.rated_at`,
        [
          id("se"),
          e.contractId,
          e.employeeId,
          p.year,
          p.half,
          Number(e.participationPct ?? 0),
          e.grade || null,
          actorUserId,
          now,
        ]
      );
    }
  });
}

/**
 * 참여자/관리자 지정. 관리자 지정 시:
 * - 기존 '관리자' 행은 교체(관리자 셀은 1명)
 * - 계약의 수행부서(owning_dept_id)가 비어 있으면 관리자 소속 본부로 자동 채움(2026-08-12 확정 방향)
 */
export async function setBonusParticipant(
  contractId: string,
  employeeId: string,
  roleLabel: string
): Promise<{ owningDeptFilled: string | null }> {
  const now = new Date().toISOString();
  let owningDeptFilled: string | null = null;
  await withDbWrite(async (db) => {
    if (roleLabel === "관리자") {
      await db.run(
        `DELETE FROM service_participants WHERE contract_id = $1 AND role_label = '관리자'`,
        [contractId]
      );
      const deptResult = await db.exec(
        `SELECT dept_id FROM employee_profiles WHERE employee_id = $1`,
        [employeeId]
      );
      const deptId = rowsToObjects(deptResult)[0]?.dept_id;
      if (deptId) {
        const updated = await db.exec(
          `UPDATE contracts SET owning_dept_id = $1, updated_at = $2
            WHERE contract_id = $3 AND owning_dept_id IS NULL
            RETURNING contract_id`,
          [String(deptId), now, contractId]
        );
        if (rowsToObjects(updated).length) owningDeptFilled = String(deptId);
      }
    }
    await db.run(
      `INSERT INTO service_participants
         (participation_id, contract_id, employee_id, role_label, source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'manual', $5, $5)
       ON CONFLICT (contract_id, employee_id, role_label) DO UPDATE SET
         source = 'manual', updated_at = EXCLUDED.updated_at`,
      [id("sp"), contractId, employeeId, roleLabel, now]
    );
  });
  return { owningDeptFilled };
}

export async function removeBonusParticipant(participationId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM service_participants WHERE participation_id = $1`, [participationId]);
  });
}

/**
 * 인력 변동 반영 참여도 자동 배분 제안 — 기간 가중(퇴사자=재직 기간분만, 승계자=본인 참여 기간분만).
 * service_participation_spans(반기 겹침 일수 × participation_pct)가 있으면 그것을,
 * 없으면 service_participants 의 참여 기간(participated_from/to) 겹침 일수로 가중한다.
 */
export async function suggestParticipation(
  contractId: string,
  p: BonusPeriod
): Promise<Array<{ employeeId: string; pct: number }>> {
  const db = await getDb();
  const from = new Date(`${p.from}T00:00:00Z`).getTime();
  const to = new Date(`${p.to}T00:00:00Z`).getTime();
  const DAY = 86400000;

  const overlapDays = (rawFrom: string | null, rawTo: string | null): number => {
    const f = rawFrom ? new Date(rawFrom.slice(0, 10) + "T00:00:00Z").getTime() : from;
    const t = rawTo ? new Date(rawTo.slice(0, 10) + "T00:00:00Z").getTime() : to;
    const s = Math.max(from, Number.isFinite(f) ? f : from);
    const e = Math.min(to, Number.isFinite(t) ? t : to);
    return Math.max(0, (e - s) / DAY + 1);
  };

  const weights = new Map<string, number>();
  const spans = rowsToObjects(
    await db.exec(
      `SELECT employee_id, role_label, span_from, span_to, participation_pct
         FROM service_participation_spans
        WHERE contract_id = $1 AND span_from <= $3 AND (span_to IS NULL OR span_to >= $2)`,
      [contractId, p.from, p.to]
    )
  );
  if (spans.length) {
    for (const s of spans) {
      if (String(s.role_label ?? "") === "관리자") continue;
      const w = overlapDays(s.span_from as string | null, s.span_to as string | null) *
        Math.max(Number(s.participation_pct ?? 0), 1);
      const key = String(s.employee_id ?? "");
      weights.set(key, (weights.get(key) ?? 0) + w);
    }
  } else {
    const parts = rowsToObjects(
      await db.exec(
        `SELECT employee_id, role_label, participated_from, participated_to
           FROM service_participants WHERE contract_id = $1`,
        [contractId]
      )
    );
    for (const s of parts) {
      if (String(s.role_label ?? "") === "관리자") continue;
      const w = overlapDays(s.participated_from as string | null, s.participated_to as string | null);
      const key = String(s.employee_id ?? "");
      weights.set(key, Math.max(weights.get(key) ?? 0, w));
    }
  }

  const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return [];
  const entries = [...weights.entries()].map(([employeeId, w]) => ({
    employeeId,
    pct: Math.round((w / totalWeight) * 100),
  }));
  // 반올림 오차 보정 — 합이 100 이 되도록 최대 항목에서 조정
  const diff = 100 - entries.reduce((a, b) => a + b.pct, 0);
  if (diff !== 0 && entries.length) {
    entries.sort((a, b) => b.pct - a.pct);
    entries[0].pct += diff;
  }
  return entries;
}
