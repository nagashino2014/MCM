/**
 * 직원 일람표 — 1명 1행으로 직급·연령·학력·경력·자격증·연봉을 모은다(2026-11-08 사용자 요청,
 * 원본 양식 '직원별 학력사항 및 자격증 보유 현황.xlsx').
 * 새 저장 칸은 없다: 인사카드(employee_profiles·educations·certifications·careers)와 근로계약(labor_contracts)을 읽기만 한다.
 */
import { getDb, rowsToObjects } from "@/lib/db";
import { CERTIFICATION_OPTIONS, envGradeLabel } from "@/lib/admin/employee-records";
import {
  ageOn,
  careerMonths,
  DEGREE_LABEL,
  finalEducation,
  orderCertificationNames,
  rosterMissing,
  type DegreeLevel,
  type EducationEntry,
} from "@/lib/admin/employee-roster-rules";

export interface EmployeeRosterRow {
  employeeId: string;
  name: string;
  status: "active" | "inactive";
  deptName: string | null;
  positionName: string | null;
  birthDate: string | null;
  age: number | null;
  hiredAt: string | null;
  resignedAt: string | null;
  /** 최종학력 */
  education: { degree: string; schoolName: string; major: string | null; graduationYear: string | null } | null;
  /** 경력 개월 수 — 당사·이전·합계 */
  careerCompanyMonths: number | null;
  careerPriorMonths: number;
  careerTotalMonths: number | null;
  /** 자격증명 → 취득일(합격일, 없으면 발급일; 둘 다 없으면 '') */
  certifications: Record<string, string>;
  engGrade: string | null;
  envGrade: string | null;
  /** 현행 근로계약 연봉 — 급여 열람 권한이 없으면 항상 null */
  annualSalary: number | null;
  salaryFrom: string | null;
  missing: string[];
}

export interface EmployeeRoster {
  asOf: string;
  salaryVisible: boolean;
  certificationNames: string[];
  rows: EmployeeRosterRow[];
}

const str = (v: unknown): string | null => (v == null || String(v).trim() === "" ? null : String(v).trim());

/** 오늘(한국 시간) YYYY-MM-DD */
function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function getEmployeeRoster(opts: { includeResigned: boolean; salaryVisible: boolean }): Promise<EmployeeRoster> {
  const db = await getDb();
  const asOf = todayKst();
  const statusFilter = opts.includeResigned ? "" : "WHERE e.status = 'active'";
  const profiles = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, e.status, e.birth_date, e.hired_at, e.eng_grade, e.env_grade, e.specialty_field,
              d.dept_name, p.position_name,
              (SELECT max(h.event_date) FROM employee_hr_events h
                WHERE h.employee_id = e.employee_id AND h.event_type = 'resignation') AS resigned_at
         FROM employee_profiles e
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
         ${statusFilter}
        ORDER BY e.status ASC, COALESCE(d.display_order, 999), p.rank_order DESC NULLS LAST, e.name ASC`
    )
  );
  const ids = profiles.map((r) => String(r.employee_id));
  if (!ids.length) return { asOf, salaryVisible: opts.salaryVisible, certificationNames: [], rows: [] };

  const [educations, certifications, careers, salaries] = await Promise.all([
    db.exec(
      `SELECT employee_id, degree_level, school_name, major, graduation_date
         FROM employee_educations WHERE employee_id = ANY($1::text[])`,
      [ids]
    ),
    db.exec(
      `SELECT employee_id, certification_name, passed_at, issued_at
         FROM employee_certifications WHERE employee_id = ANY($1::text[])
        ORDER BY display_order, certification_name`,
      [ids]
    ),
    db.exec(`SELECT employee_id, worked_from, worked_to FROM employee_careers WHERE employee_id = ANY($1::text[])`, [ids]),
    // 연봉은 급여 열람 권한이 있을 때만 읽는다. 현행 = 무효 제외·작성일 최신(급여 라운드와 같은 기준).
    opts.salaryVisible
      ? db.exec(
          `SELECT DISTINCT ON (employee_id) employee_id, annual_salary, effective_from, contract_date
             FROM labor_contracts
            WHERE employee_id = ANY($1::text[]) AND status <> 'void' AND annual_salary IS NOT NULL
            ORDER BY employee_id, contract_date DESC NULLS LAST, created_at DESC`,
          [ids]
        )
      : Promise.resolve(null),
  ]);

  const group = <T,>(rows: Record<string, unknown>[], map: (r: Record<string, unknown>) => T) => {
    const out = new Map<string, T[]>();
    for (const r of rows) {
      const key = String(r.employee_id);
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push(map(r));
    }
    return out;
  };
  const eduBy = group<EducationEntry>(rowsToObjects(educations), (r) => ({
    degreeLevel: (String(r.degree_level ?? "bachelor") as DegreeLevel),
    schoolName: String(r.school_name ?? ""),
    major: str(r.major),
    graduationDate: str(r.graduation_date),
  }));
  const certBy = group(rowsToObjects(certifications), (r) => ({
    name: String(r.certification_name ?? "").trim(),
    at: str(r.passed_at) ?? str(r.issued_at) ?? "",
  }));
  const careerBy = group(rowsToObjects(careers), (r) => ({ workedFrom: str(r.worked_from), workedTo: str(r.worked_to) }));
  const salaryBy = new Map(
    (salaries ? rowsToObjects(salaries) : []).map((r) => [
      String(r.employee_id),
      { amount: Number(r.annual_salary), from: str(r.effective_from) ?? str(r.contract_date) },
    ])
  );

  const certNames = new Set<string>();
  const rows: EmployeeRosterRow[] = profiles.map((r) => {
    const id = String(r.employee_id);
    const status = r.status === "inactive" ? "inactive" : "active";
    const resignedAt = status === "inactive" ? str(r.resigned_at) : null;
    const hiredAt = str(r.hired_at);
    const birthDate = str(r.birth_date);
    const edu = finalEducation(eduBy.get(id) ?? []);
    const months = careerMonths({ hiredAt, endAt: resignedAt ?? asOf, careers: careerBy.get(id) ?? [] });
    const certs: Record<string, string> = {};
    for (const c of certBy.get(id) ?? []) {
      if (!c.name) continue;
      certNames.add(c.name);
      if (!(c.name in certs) || (c.at && (!certs[c.name] || c.at < certs[c.name]))) certs[c.name] = c.at;
    }
    const salary = salaryBy.get(id) ?? null;
    const education = edu
      ? {
          degree: DEGREE_LABEL[edu.degreeLevel] ?? "",
          schoolName: edu.schoolName,
          major: edu.major,
          graduationYear: edu.graduationDate?.slice(0, 4) ?? null,
        }
      : null;
    const annualSalary = salary && Number.isFinite(salary.amount) ? salary.amount : null;
    return {
      employeeId: id,
      name: String(r.name ?? ""),
      status,
      deptName: str(r.dept_name),
      positionName: str(r.position_name),
      birthDate,
      age: ageOn(birthDate, asOf),
      hiredAt,
      resignedAt,
      education,
      careerCompanyMonths: months.company,
      careerPriorMonths: months.prior,
      careerTotalMonths: months.total,
      certifications: certs,
      engGrade: str(r.eng_grade),
      envGrade: str(envGradeLabel(str(r.env_grade), str(r.specialty_field))),
      annualSalary,
      salaryFrom: salary?.from ?? null,
      missing: rosterMissing({ birthDate, hiredAt, education, annualSalary, salaryVisible: opts.salaryVisible }),
    };
  });

  return {
    asOf,
    salaryVisible: opts.salaryVisible,
    certificationNames: orderCertificationNames(certNames, CERTIFICATION_OPTIONS),
    rows,
  };
}
