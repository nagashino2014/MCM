import { getDb, rowsToObjects } from "@/lib/db";
import { hasGlobalScope, loadUserAccess } from "@/lib/auth/rbac";

/*
 * 수행인력 실적 — 인력별 수행 용역 이력(/staffing/records).
 * 계약 건별 수행인력(service_participants)을 사람 축으로 뒤집어 읽는다. 쓰기 없음.
 *
 * 수행기간 ≠ 계약기간: 시작일은 계약 시작·입사일·투입일 중 가장 늦은 날,
 * 종료일은 계약 종료(완료 건)·퇴사일·투입 종료일 중 가장 이른 날. 종료 근거가 없으면 진행 중.
 */

export const RECORD_PERMISSION = "staffing.record.view";

/** 화면·차트의 수행용역 종류(대분류) — 저장값(service_type)을 5종으로 묶는다. */
export const RECORD_CATEGORIES = ["통합허가", "화관법", "HAPs", "ESG 탄소중립", "기타"] as const;
export type RecordCategory = (typeof RECORD_CATEGORIES)[number];

export type RecordScope = { kind: "all" } | { kind: "dept"; deptIds: string[] } | { kind: "none" };

export interface StaffRecordRow {
  contractId: string;
  contractTitle: string;
  clientName: string;
  amount: number | null;
  category: RecordCategory;
  serviceSubtype: string;
  roleLabel: string;
  taskLabel: string;
  /** 수행기간(YYYY-MM-DD). periodTo=null 이면 진행 중. 산정 불가(시작 근거 없음·역전)면 둘 다 null. */
  periodFrom: string | null;
  periodTo: string | null;
  ongoing: boolean;
  periodDays: number | null;
  /** 참여도(%) — 성과급 반기 평가 입력값의 평균. 입력이 없으면 null. */
  participationPct: number | null;
}

export interface StaffRecordProfile {
  employeeId: string;
  name: string;
  positionName: string;
  deptId: string | null;
  deptName: string;
  status: "active" | "inactive";
  hiredAt: string | null;
  resignedAt: string | null;
  tenureMonths: number | null;
}

export interface SubtypeDuration {
  /** '통합허가-변경허가' 형태 */
  label: string;
  personAvgDays: number;
  personCount: number;
  companyAvgDays: number | null;
  companyCount: number;
}

export interface StaffRecordDetail {
  profile: StaffRecordProfile;
  rows: StaffRecordRow[];
  subtypeDurations: SubtypeDuration[];
}

const s = (v: unknown): string => (v == null ? "" : String(v).trim());

/** 자유 텍스트 날짜 → 'YYYY-MM-DD'. '용역 완료시 까지' 같은 문구·불완전 날짜는 null. */
export function parseYmd(value: unknown): string | null {
  const m = s(value).match(/(\d{4})\D{0,2}(\d{1,2})\D{0,2}(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function todayYmd(): string {
  // 한국 업무일 기준(서버는 UTC) — 자정 전후 하루 어긋남 방지
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function maxDate(...values: (string | null)[]): string | null {
  const list = values.filter((v): v is string => Boolean(v));
  return list.length ? list.reduce((a, b) => (a > b ? a : b)) : null;
}

function minDate(...values: (string | null)[]): string | null {
  const list = values.filter((v): v is string => Boolean(v));
  return list.length ? list.reduce((a, b) => (a < b ? a : b)) : null;
}

export function toRecordCategory(serviceType: string): RecordCategory {
  const t = serviceType.replace(/\s+/g, "");
  if (t.includes("통합")) return "통합허가";
  if (t.includes("장외") || t.includes("화관법")) return "화관법";
  if (/haps/i.test(t)) return "HAPs";
  if (/esg/i.test(t) || t.includes("탄소")) return "ESG 탄소중립";
  return "기타";
}

export interface ParticipationSource {
  employeeId: string;
  contractId: string;
  contractTitle: string;
  clientName: string;
  amount: number | null;
  serviceType: string;
  serviceSubtype: string;
  roleLabels: string[];
  taskLabels: string[];
  participatedFrom: string | null;
  participatedTo: string | null;
  contractStart: string | null;
  contractEnd: string | null; // 완료·해지 건만 — 미완료 계약의 ended_at 은 '예정'일이라 쓰지 않는다
  hiredAt: string | null;
  resignedAt: string | null;
  leftOn: string | null; // 변동 이력상 마지막 변동이 '제외(leave)'일 때 그 발효일
}

/**
 * (직원, 계약) 단위 참여 원천 — employeeId 를 주면 그 직원만, 없으면 전사(세분류별 전사 평균용).
 * 한 직원이 한 계약에 역할 여러 개로 등록된 경우 1건으로 합친다(역할·업무는 병기, 기간은 최소~최대).
 */
async function loadParticipations(employeeId?: string): Promise<ParticipationSource[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT sp.employee_id, sp.contract_id, sp.role_label, sp.task_label,
              sp.participated_from, sp.participated_to,
              c.contract_title, c.service_type, c.service_subtype,
              c.started_at, c.contract_date, c.ended_at, c.permit_issued_at, c.contract_terminated_at,
              COALESCE(c.current_amount, c.contract_amount) AS amount,
              cp.company_name AS client_name,
              lm.invoice_done_date,
              e.hired_at, e.status, rs.resigned_at, lv.left_on
         FROM service_participants sp
         JOIN contracts c ON c.contract_id = sp.contract_id AND c.deleted_at IS NULL
         JOIN employee_profiles e ON e.employee_id = sp.employee_id
         LEFT JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
         LEFT JOIN (
           SELECT DISTINCT ON (contract_id) contract_id,
                  CASE WHEN COALESCE(invoice_issued, 0) = 1
                       THEN SUBSTRING(invoice_issued_at, 1, 10)
                       ELSE NULL END AS invoice_done_date
             FROM contract_payment_milestones
            ORDER BY contract_id, stage_order DESC
         ) lm ON lm.contract_id = c.contract_id
         LEFT JOIN (
           SELECT employee_id, MAX(event_date) AS resigned_at
             FROM employee_hr_events
            WHERE event_type = 'resignation'
            GROUP BY employee_id
         ) rs ON rs.employee_id = sp.employee_id
         LEFT JOIN (
           SELECT DISTINCT ON (contract_id, employee_id) contract_id, employee_id,
                  CASE WHEN change_kind = 'leave' THEN effective_on ELSE NULL END AS left_on
             FROM service_participation_changes
            WHERE change_kind IN ('join', 'leave')
            ORDER BY contract_id, employee_id, effective_on DESC, recorded_at DESC
         ) lv ON lv.contract_id = sp.contract_id AND lv.employee_id = sp.employee_id
        WHERE ($1::text IS NULL OR sp.employee_id = $1)`,
      [employeeId ?? null]
    )
  );

  const byKey = new Map<string, ParticipationSource>();
  for (const r of rows) {
    const key = `${s(r.employee_id)}|${s(r.contract_id)}`;
    const from = parseYmd(r.participated_from);
    const to = parseYmd(r.participated_to);
    const existing = byKey.get(key);
    if (existing) {
      if (s(r.role_label) && !existing.roleLabels.includes(s(r.role_label))) existing.roleLabels.push(s(r.role_label));
      if (s(r.task_label) && !existing.taskLabels.includes(s(r.task_label))) existing.taskLabels.push(s(r.task_label));
      existing.participatedFrom = minDate(existing.participatedFrom, from);
      // 한 역할이라도 종료일이 비어 있으면(진행 중) 전체를 진행 중으로 본다
      existing.participatedTo = existing.participatedTo && to ? maxDate(existing.participatedTo, to) : null;
      continue;
    }
    // 완료 판정은 수행인력 명단(roster.ts)과 동일: 허가일 또는 최종 대금지급단위 계산서 발행.
    const permit = parseYmd(r.permit_issued_at);
    const invoiceDone = parseYmd(r.invoice_done_date);
    const terminated = parseYmd(r.contract_terminated_at);
    const completed = Boolean(permit || invoiceDone);
    const contractEnd = terminated ?? (completed ? parseYmd(r.ended_at) ?? permit ?? invoiceDone : null);
    const amount = r.amount == null ? null : Number(r.amount);
    byKey.set(key, {
      employeeId: s(r.employee_id),
      contractId: s(r.contract_id),
      contractTitle: s(r.contract_title),
      clientName: s(r.client_name),
      amount: amount != null && Number.isFinite(amount) && amount > 0 ? amount : null,
      serviceType: s(r.service_type),
      serviceSubtype: s(r.service_subtype),
      roleLabels: s(r.role_label) ? [s(r.role_label)] : [],
      taskLabels: s(r.task_label) ? [s(r.task_label)] : [],
      participatedFrom: from,
      participatedTo: to,
      contractStart: parseYmd(r.started_at) ?? parseYmd(r.contract_date),
      contractEnd,
      hiredAt: parseYmd(r.hired_at),
      // 재입사자의 과거 퇴사 기록이 현재 수행기간을 끊지 않도록 퇴사 상태일 때만 적용
      resignedAt: s(r.status) === "inactive" ? parseYmd(r.resigned_at) : null,
      leftOn: parseYmd(r.left_on),
    });
  }
  return [...byKey.values()];
}

export function resolvePeriod(p: ParticipationSource, today: string): Pick<StaffRecordRow, "periodFrom" | "periodTo" | "ongoing" | "periodDays"> {
  const from = maxDate(p.contractStart, p.hiredAt, p.participatedFrom);
  const to = minDate(p.contractEnd, p.resignedAt, p.participatedTo, p.leftOn);
  if (!from) return { periodFrom: null, periodTo: null, ongoing: false, periodDays: null };
  const end = to ?? today;
  // 입사 전에 끝난 계약 등 근거 날짜가 역전되면 수행기간을 만들지 않는다(통계에서도 제외)
  if (end < from) return { periodFrom: null, periodTo: null, ongoing: false, periodDays: null };
  return { periodFrom: from, periodTo: to, ongoing: to == null, periodDays: daysBetween(from, end) };
}

const subtypeLabel = (category: RecordCategory, subtype: string): string => `${category}-${subtype || "미분류"}`;

/** 직원별 수행 용역 건수 — 트리 뱃지용. */
export async function loadRecordCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT sp.employee_id, COUNT(DISTINCT sp.contract_id)::int AS n
         FROM service_participants sp
         JOIN contracts c ON c.contract_id = sp.contract_id AND c.deleted_at IS NULL
        GROUP BY sp.employee_id`
    )
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[s(r.employee_id)] = Number(r.n) || 0;
  return out;
}

export async function loadRecordProfile(employeeId: string): Promise<StaffRecordProfile | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, e.dept_id, e.status, e.hired_at,
              p.position_name, d.dept_name,
              (SELECT MAX(event_date) FROM employee_hr_events h
                WHERE h.employee_id = e.employee_id AND h.event_type = 'resignation') AS resigned_at
         FROM employee_profiles e
         LEFT JOIN positions p ON p.position_id = e.position_id
         LEFT JOIN departments d ON d.dept_id = e.dept_id
        WHERE e.employee_id = $1`,
      [employeeId]
    )
  );
  const r = rows[0];
  if (!r) return null;
  const status = s(r.status) === "inactive" ? "inactive" : "active";
  const hiredAt = parseYmd(r.hired_at);
  const resignedAt = status === "inactive" ? parseYmd(r.resigned_at) : null;
  let tenureMonths: number | null = null;
  if (hiredAt) {
    const end = resignedAt ?? todayYmd();
    const months =
      (Number(end.slice(0, 4)) - Number(hiredAt.slice(0, 4))) * 12 +
      (Number(end.slice(5, 7)) - Number(hiredAt.slice(5, 7))) -
      (end.slice(8, 10) < hiredAt.slice(8, 10) ? 1 : 0);
    tenureMonths = months >= 0 ? months : null;
  }
  return {
    employeeId: s(r.employee_id),
    name: s(r.name),
    positionName: s(r.position_name),
    deptId: r.dept_id != null ? s(r.dept_id) : null,
    deptName: s(r.dept_name),
    status,
    hiredAt,
    resignedAt,
    tenureMonths,
  };
}

/** 인력 1명의 수행 용역 이력 + 세분류별 개인/전사 평균 수행기간. */
export async function loadStaffRecordDetail(employeeId: string): Promise<StaffRecordDetail | null> {
  const profile = await loadRecordProfile(employeeId);
  if (!profile) return null;
  const today = todayYmd();
  const all = await loadParticipations();
  const db = await getDb();
  const evalRows = rowsToObjects(
    await db.exec(
      // 0 은 미입력 기본값이라 평균에서 제외한다
      `SELECT contract_id, AVG(participation_pct) AS pct
         FROM service_evaluations
        WHERE employee_id = $1 AND participation_pct > 0
        GROUP BY contract_id`,
      [employeeId]
    )
  );
  const pctByContract = new Map(evalRows.map((r) => [s(r.contract_id), Number(r.pct)]));

  const company = new Map<string, { days: number; count: number }>();
  const rows: StaffRecordRow[] = [];
  for (const p of all) {
    const period = resolvePeriod(p, today);
    const category = toRecordCategory(p.serviceType);
    if (period.periodDays != null) {
      const label = subtypeLabel(category, p.serviceSubtype);
      const acc = company.get(label) ?? { days: 0, count: 0 };
      acc.days += period.periodDays;
      acc.count += 1;
      company.set(label, acc);
    }
    if (p.employeeId !== employeeId) continue;
    const pct = pctByContract.get(p.contractId);
    rows.push({
      contractId: p.contractId,
      contractTitle: p.contractTitle,
      clientName: p.clientName,
      amount: p.amount,
      category,
      serviceSubtype: p.serviceSubtype,
      roleLabel: p.roleLabels.join("·"),
      taskLabel: p.taskLabels.join(", "),
      ...period,
      participationPct: pct != null && Number.isFinite(pct) ? Math.round(pct * 10) / 10 : null,
    });
  }
  // 수행 시작일 오름차순(기간 미상은 뒤)
  rows.sort(
    (a, b) =>
      (a.periodFrom ?? "9999").localeCompare(b.periodFrom ?? "9999") ||
      a.contractTitle.localeCompare(b.contractTitle, "ko")
  );

  const person = new Map<string, { days: number; count: number }>();
  for (const r of rows) {
    if (r.periodDays == null) continue;
    const label = subtypeLabel(r.category, r.serviceSubtype);
    const acc = person.get(label) ?? { days: 0, count: 0 };
    acc.days += r.periodDays;
    acc.count += 1;
    person.set(label, acc);
  }
  const subtypeDurations: SubtypeDuration[] = [...person.entries()]
    .map(([label, v]) => {
      const c = company.get(label);
      return {
        label,
        personAvgDays: Math.round(v.days / v.count),
        personCount: v.count,
        companyAvgDays: c ? Math.round(c.days / c.count) : null,
        companyCount: c?.count ?? 0,
      };
    })
    .sort((a, b) => b.personCount - a.personCount || a.label.localeCompare(b.label, "ko"));

  return { profile, rows, subtypeDurations };
}

/**
 * 열람 범위 — 전사(scope all) / 부서(self_dept·specific_dept, 하위 부서 포함) / 없음.
 * 일반 직원은 grant 가 없어 none(본인 것도 조회 불가 — 2026-10-02 사용자 확정).
 */
export async function resolveRecordScope(userId: string): Promise<RecordScope> {
  if (await hasGlobalScope(userId, RECORD_PERMISSION)) return { kind: "all" };
  const access = await loadUserAccess(userId);
  const grants = access.grants.filter((g) => g.permissionKey === RECORD_PERMISSION);
  if (grants.some((g) => g.effect === "deny")) return { kind: "none" };
  const roots = new Set<string>();
  for (const g of grants) {
    if (g.effect !== "allow") continue;
    if (g.scopeKind === "self_dept" && access.deptId) roots.add(access.deptId);
    if (g.scopeKind === "specific_dept" && g.scopeDeptId) roots.add(g.scopeDeptId);
  }
  if (roots.size === 0) return { kind: "none" };

  const db = await getDb();
  const deptRows = rowsToObjects(await db.exec("SELECT dept_id, parent_dept_id FROM departments"));
  const deptIds = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of deptRows) {
      const id = s(d.dept_id);
      if (!deptIds.has(id) && d.parent_dept_id != null && deptIds.has(s(d.parent_dept_id))) {
        deptIds.add(id);
        grew = true;
      }
    }
  }
  return { kind: "dept", deptIds: [...deptIds] };
}

export function scopeAllowsDept(scope: RecordScope, deptId: string | null): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "dept") return deptId != null && scope.deptIds.includes(deptId);
  return false;
}
