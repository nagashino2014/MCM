/**
 * 사번(= 로그인 ID) 생성 코어. (PR-A2)
 * 형식 12자리: YYYYMMDD(입사일) + GG(성별: 남 01 / 여 02) + NN(넘버링).
 * 넘버링은 같은 (입사일 + 성별) 그룹 내에서만 의미를 가지며, 그룹이 1명이면 01.
 * 2명 이상이면 생년월일이 빠른(이른) 사람 순으로 01, 02, 03…
 *
 * 설계: docs/permission-rbac-redesign.md §7.5-2 / docs/account-org-unify-plan.md Step 2.
 */

import { PgDatabase, rowsToObjects, withDbWrite } from "../db";

export type Gender = "male" | "female";

export interface EmployeeNoParts {
  hiredAt: string; // 'YYYY-MM-DD'
  gender: Gender;
  seq: number; // 1-base
}

/** 입사일 문자열에서 YYYYMMDD 8자리만 추출. */
export function hiredYmd(hiredAt: string): string {
  return String(hiredAt ?? "").replace(/\D/g, "").slice(0, 8);
}

/** 성별 코드: 남 '01' / 여 '02'. */
export function genderCode(gender: Gender): string {
  return gender === "female" ? "02" : "01";
}

/** 사번 문자열 조립. (YYYYMMDD + GG + NN) */
export function buildEmployeeNo(parts: EmployeeNoParts): string {
  const ymd = hiredYmd(parts.hiredAt);
  if (ymd.length !== 8) throw new Error("INVALID_HIRED_AT");
  const gg = genderCode(parts.gender);
  const nn = String(parts.seq).padStart(2, "0");
  if (nn.length !== 2) throw new Error("SEQ_OVERFLOW");
  return ymd + gg + nn;
}

interface EmployeeNoSeed {
  employeeId: string;
  hiredAt: string | null;
  gender: Gender | null;
  birthDate: string | null;
}

/** 사번 발급에 필요한 필수 필드(입사일/성별/생년월일)를 로드. */
async function loadSeed(db: PgDatabase, employeeId: string): Promise<EmployeeNoSeed | null> {
  const rows = rowsToObjects(
    await db.exec(
      "SELECT employee_id, hired_at, gender, birth_date FROM employee_profiles WHERE employee_id = $1 LIMIT 1",
      [employeeId]
    )
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    employeeId: String(r.employee_id ?? ""),
    hiredAt: r.hired_at != null ? String(r.hired_at) : null,
    gender: r.gender != null ? (String(r.gender) as Gender) : null,
    birthDate: r.birth_date != null ? String(r.birth_date) : null,
  };
}

/**
 * (입사일, 성별) 그룹에서 본인의 NN(순번)을 계산한다. db 트랜잭션 내부에서 호출.
 * - 기준: 본인보다 생년월일이 이른(같으면 employee_id 사전순) 기존 발급자 수 + 1.
 * - 이미 점유된 순번이면 다음 빈 자리를 찾는다(순차 발급 견고성).
 * 일괄 발급을 생년월일 오름차순으로 호출하면 01,02,03… 이 정확히 채워진다.
 */
async function computeSeq(db: PgDatabase, seed: EmployeeNoSeed): Promise<number> {
  if (!seed.hiredAt || !seed.gender || !seed.birthDate) {
    throw new Error("MISSING_REQUIRED_FOR_NO");
  }
  const ymd = hiredYmd(seed.hiredAt);
  if (ymd.length !== 8) throw new Error("INVALID_HIRED_AT");

  // 같은 (입사일, 성별)에서 이미 사번을 가진 인원.
  const group = rowsToObjects(
    await db.exec(
      `SELECT employee_id, employee_no, birth_date
         FROM employee_profiles
        WHERE replace(hired_at, '-', '') = $1
          AND gender = $2
          AND employee_no IS NOT NULL
          AND employee_id <> $3`,
      [ymd, seed.gender, seed.employeeId]
    )
  );

  const occupied = new Set<number>();
  let earlier = 0;
  for (const g of group) {
    const no = String(g.employee_no ?? "");
    const seq = Number(no.slice(-2));
    if (Number.isFinite(seq) && seq > 0) occupied.add(seq);
    const gb = g.birth_date != null ? String(g.birth_date) : "";
    const gid = String(g.employee_id ?? "");
    // 본인보다 생년월일이 이르거나, 같으면 employee_id 사전순으로 앞.
    if (gb < seed.birthDate || (gb === seed.birthDate && gid < seed.employeeId)) {
      earlier += 1;
    }
  }

  let seq = earlier + 1;
  while (occupied.has(seq)) seq += 1;
  return seq;
}

/** db 트랜잭션 내부용: 사번 문자열을 계산만 한다(저장은 호출자). */
export async function computeEmployeeNo(db: PgDatabase, employeeId: string): Promise<string> {
  const seed = await loadSeed(db, employeeId);
  if (!seed) throw new Error("EMPLOYEE_NOT_FOUND");
  const seq = await computeSeq(db, seed);
  return buildEmployeeNo({ hiredAt: seed.hiredAt!, gender: seed.gender!, seq });
}

/** 단독 사용: 사번을 발급해 employee_profiles.employee_no 에 저장하고 반환. */
export async function issueEmployeeNo(employeeId: string): Promise<string> {
  return withDbWrite(async (db) => {
    const employeeNo = await computeEmployeeNo(db, employeeId);
    await db.run(
      "UPDATE employee_profiles SET employee_no = $1, updated_at = $2 WHERE employee_id = $3",
      [employeeNo, new Date().toISOString(), employeeId]
    );
    return employeeNo;
  });
}
