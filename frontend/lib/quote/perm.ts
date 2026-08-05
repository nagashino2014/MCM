// 견적서 작성 권한 판정 — 2026-08-05 확정: 각 본부별 부서장 + 총괄 + 대표이사 + 영업관리본부 전체.
// 조직 데이터(employee_profiles→positions/departments) 기반 문자열 매칭. admin role 은 항상 허용.
// 직책·부서 명칭은 상수로 분리해 조직 개편 시 조정이 쉽도록 한다.

import { getDb, rowsToObjects } from "@/lib/db";

/** 직책명에 포함되면 작성 허용 (부서장급 이상) */
const ALLOWED_POSITION_KEYWORDS = ["대표이사", "총괄", "본부장", "부서장", "실장", "소장"];
/** 부서명에 포함되면 소속 전체 작성 허용 */
const ALLOWED_DEPT_KEYWORDS = ["영업관리"];

export async function canCreateQuote(userId: string, role: string): Promise<boolean> {
  if (role === "admin") return true;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT p.position_name, d.dept_name
         FROM users u
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
         LEFT JOIN positions p ON p.position_id = ep.position_id
         LEFT JOIN departments d ON d.dept_id = ep.dept_id
        WHERE u.user_id = $1`,
      [userId]
    )
  );
  const position = String(rows[0]?.position_name ?? "");
  const dept = String(rows[0]?.dept_name ?? "");
  if (ALLOWED_POSITION_KEYWORDS.some((k) => position.includes(k))) return true;
  if (ALLOWED_DEPT_KEYWORDS.some((k) => dept.includes(k))) return true;
  return false;
}
